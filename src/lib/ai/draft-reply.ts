/**
 * AI reply drafter for the daily brief.
 *
 * Given an email Dotti needs to reply to, draft a reply in her voice
 * that she can review, edit, and send. The draft is a starting point,
 * not a final word: when the email asks something the model can't
 * actually answer (a number, a date, a decision), it leaves a short
 * [bracketed placeholder] rather than inventing facts.
 */

import { generateObject } from 'ai';
import { z } from 'zod';

const ReplyDraftSchema = z.object({
  body: z
    .string()
    .describe(
      'The reply body, plain text. Greeting line, 1-3 short paragraphs, sign-off "Dotti". No subject line. No quoted original. Where a fact is needed that you do not have, write a [bracketed placeholder] Dotti will fill in.',
    ),
  confidence: z
    .enum(['ready', 'needs_input'])
    .describe(
      '"ready" when the draft is complete and sendable as-is. "needs_input" when it contains a [placeholder] or makes an assumption Dotti must verify.',
    ),
});

export type ReplyDraft = z.infer<typeof ReplyDraftSchema>;

const SYSTEM_PROMPT = `You draft email replies for Dotti, who runs operations at Rising Tide STR, a vacation rental management company in Gloucester MA. She handles owner statements, owner communication, prospect deal coordination, and vendor / cleaner logistics.

Write the way Dotti writes:
  - Warm but direct and concise. No corporate filler.
  - NEVER use em dashes. Use a regular dash, a comma, or a period.
  - Short paragraphs. Get to the point in the first line.
  - Sign off with just "Dotti" on its own line.

Rules:
  - Draft a reply that actually moves the thread forward — answer the question, confirm the next step, or propose one.
  - You do NOT have access to statement numbers, exact dates, account balances, or internal decisions. When the reply needs one, write a clear [bracketed placeholder] like [confirm the April payout amount] or [pick a time]. Never invent a figure or commitment.
  - Don't over-promise. If the sender asks for something that needs Ryan's or an owner's sign-off, say Dotti will check and follow up.
  - No greeting fluff beyond a simple "Hi <first name>,".
  - This is a draft Dotti will read before sending. Make it 90% done, not a vague stub.`;

export type DraftReplyInput = {
  fromName: string | null;
  fromEmail: string | null;
  subject: string;
  body: string;
};

export async function draftReply(email: DraftReplyInput): Promise<ReplyDraft | null> {
  try {
    const { object } = await generateObject({
      model: 'anthropic/claude-sonnet-4.5',
      schema: ReplyDraftSchema,
      system: SYSTEM_PROMPT,
      prompt: `Draft Dotti's reply to this email.

From: ${email.fromName ?? ''} <${email.fromEmail ?? ''}>
Subject: ${email.subject}

--- email body ---
${email.body.slice(0, 4000)}
--- end ---`,
    });
    // Belt-and-suspenders on the em-dash rule.
    return { ...object, body: object.body.replace(/\s*—\s*/g, ', ') };
  } catch (err) {
    console.error('[draft-reply]', err);
    return null;
  }
}
