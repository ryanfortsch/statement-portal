/**
 * Core AI draft generator. Pulled out of the route handler so server
 * actions and future chat surfaces can call it directly without a
 * self-HTTP hop and cookie forwarding gymnastics.
 *
 * The route at /api/guests/campaigns/draft is now a thin wrapper around
 * this function for any external caller that wants it.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { composeSystemPrompt, type CampaignTone } from './brand-voice';
import { loadDraftContext, formatContextBlock } from './campaign-context';

export const DraftedCampaignSchema = z.object({
  subject: z.string().describe(
    'Email subject line. 30 to 60 characters. Specific not promotional. No emoji, no exclamation, no ALL CAPS.'
  ),
  preheader: z.string().describe(
    'Inbox preview text shown next to the subject. 60 to 110 characters. Complements the subject without repeating it.'
  ),
  body: z.string().describe(
    'Markdown body using only this supported subset: # H1, ## H2, ### H3, **bold**, *italic*, [text](url), - bullets, > blockquote, --- rule, blank-line paragraphs. NEVER an em dash. Under 200 words.'
  ),
  rationale: z.string().describe(
    'One short sentence explaining the angle for the operator. Not visible to recipients.'
  ),
});

export type DraftedCampaign = z.infer<typeof DraftedCampaignSchema>;

export async function draftCampaign(args: {
  brief: string;
  tone: CampaignTone;
  segmentId: string | null;
}): Promise<DraftedCampaign> {
  const ctx = await loadDraftContext({ segmentId: args.segmentId });
  const dynamicContext = formatContextBlock(ctx);
  const system = composeSystemPrompt({ tone: args.tone, dynamicContext });

  const { object } = await generateObject({
    model: 'anthropic/claude-sonnet-4.5',
    schema: DraftedCampaignSchema,
    system,
    prompt: `Operator brief:\n\n${args.brief}\n\nDraft a campaign that follows the brand voice rules and the chosen tone. If the brief is vague, make a reasonable specific choice and surface it in the rationale.`,
  });

  // Belt-and-suspenders: scrub any em dashes the model slipped through.
  return {
    subject: stripEmDashes(object.subject),
    preheader: stripEmDashes(object.preheader),
    body: stripEmDashes(object.body),
    rationale: stripEmDashes(object.rationale),
  };
}

/** Replace em dashes with a sentence break or comma depending on context. */
function stripEmDashes(s: string): string {
  if (!s) return s;
  return s
    .replace(/\s+—\s+([A-Z])/g, '. $1')
    .replace(/\s+—\s+/g, ', ')
    .replace(/—/g, ', ');
}
