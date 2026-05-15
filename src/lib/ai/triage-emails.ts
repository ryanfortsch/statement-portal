/**
 * Email triage for the daily brief.
 *
 * Given a batch of unread inbox emails, classify each one:
 *   - `needs_reply`  — Dotti is being asked a question, owes a
 *                      decision, or someone is waiting on her input.
 *   - `fyi`          — Real human/business email but no action
 *                      required (receipts, confirmations, newsletters
 *                      she reads, FYI cc's).
 *   - `notification` — Automated system noise (Quo SMS forwards,
 *                      Stripe receipts, GitHub bot notifications,
 *                      build failures, etc.). Excluded from the brief.
 *
 * Returns one record per input id. If the LLM call fails, we fall
 * back to treating everything as `fyi` so the page still renders.
 */

import { generateObject } from 'ai';
import { z } from 'zod';

export type TriageCategory = 'needs_reply' | 'fyi' | 'notification';

const TriageItemSchema = z.object({
  id: z.string().describe('The Gmail message id passed in.'),
  category: z
    .enum(['needs_reply', 'fyi', 'notification'])
    .describe(
      'needs_reply when the sender wants a decision, an answer, or is waiting on Dotti specifically. fyi when it is real correspondence but no action is required. notification for automated machine output.',
    ),
  summary: z
    .string()
    .describe(
      'One short sentence in plain English. For needs_reply: what they are asking. For fyi: what the email contains. Skip filler like "An email from X about". Under 18 words.',
    ),
});

const TriageBatchSchema = z.object({
  items: z.array(TriageItemSchema),
});

const SYSTEM_PROMPT = `You are Dotti's email assistant at Rising Tide STR, a vacation rental management company in Gloucester MA.

The team is small. Most emails are addressed To: ryan@risingtidestr.com (Ryan, the owner) or To: allie@risingtidestr.com (Allie, operations). Dotti rarely gets emails addressed directly to her — she sees them through a shared mailbox or as a cc / Delivered-To recipient. Don't use the To: line as a hard signal of who should reply. Use the *topic*.

Dotti's responsibilities (she should reply or take action, even if the email is addressed to Ryan or Allie):
  - Monthly owner statements: ingestion, reconciliation, payouts, owner-facing statement deliverables
  - Owner communication: statement questions, owner reimbursements, owner reporting
  - Prospect deals: contract finalization, signing chase, document review, scheduling photoshoots / meetings to close
  - Vendor / cleaner coordination and invoicing (Cape Ann Elite, repair vendors), payments, AR / AP
  - Anything operational that blocks turnovers (cleaner status, lockbox, supplies, repairs)

Ryan handles (NOT Dotti, even if Dotti is cc'd):
  - Strategic / partnership decisions, marketing, new revenue ideas, brand
  - Site / product direction (StayCapeAnn etc.)
  - Personal email to ryan@

Allie handles (NOT Dotti):
  - Day-to-day cleaning scheduling chatter, guest messages, on-the-ground operations Allie owns
  - Routine vendor confirmations she's already coordinating

Classification:

needs_reply
  - Topic is in Dotti's wheelhouse above AND someone is asking, deciding, signing, scheduling, or chasing
  - "Where's the April statement?", "We're ready to sign the contract", "Need your wire for the deposit", "Bethany asking to meet about her management contract"

fyi
  - Real human correspondence about a topic that's not Dotti's wheelhouse (Ryan or Allie's domain)
  - Confirmations, thank-yous, status updates, FYI cc's
  - Industry newsletters
  - Anything where Allie or Ryan is clearly already actively handling it and Dotti is on cc for context

notification
  - Automated system output: Quo (OpenPhone) SMS forwards, Stripe / Resend / Vercel / GitHub bot mails, calendar invites that auto-fire, marketing newsletters she didn't subscribe to
  - Booking confirmations from Airbnb / VRBO when no action is needed
  - Anything where "from" is no-reply / notification / automated / hello@

When in doubt, bias toward fyi. Cost of a missed reply is lower than the cost of a noisy brief — and Dotti will check the FYI list anyway.

Be terse in summaries. Skip "An email from X" — Dotti can see the sender. State the ask or the content directly. Under 18 words.`;

export type TriageInput = {
  id: string;
  fromName: string | null;
  fromEmail: string | null;
  toEmails: string[];
  ccEmails: string[];
  subject: string;
  snippet: string;
};

export type TriageResult = {
  id: string;
  category: TriageCategory;
  summary: string;
};

export async function triageEmails(emails: TriageInput[]): Promise<TriageResult[]> {
  if (!emails.length) return [];

  const lines = emails.map((e, i) => {
    const sender = [e.fromName, e.fromEmail ? `<${e.fromEmail}>` : null].filter(Boolean).join(' ');
    const to = e.toEmails.length ? e.toEmails.join(', ') : '(none)';
    const cc = e.ccEmails.length ? e.ccEmails.join(', ') : '(none)';
    return `${i + 1}. id=${e.id}\n   from: ${sender || 'unknown'}\n   to: ${to}\n   cc: ${cc}\n   subject: ${e.subject}\n   preview: ${e.snippet.slice(0, 280)}`;
  });

  try {
    const { object } = await generateObject({
      model: 'anthropic/claude-haiku-4.5',
      schema: TriageBatchSchema,
      system: SYSTEM_PROMPT,
      prompt: `Triage these ${emails.length} unread emails. Return one entry per email, preserving the ids.\n\n${lines.join('\n\n')}`,
    });
    const byId = new Map<string, TriageResult>();
    for (const item of object.items) {
      byId.set(item.id, item);
    }
    return emails.map(e => byId.get(e.id) ?? { id: e.id, category: 'fyi' as TriageCategory, summary: '' });
  } catch (err) {
    console.error('[triage-emails]', err);
    return emails.map(e => ({ id: e.id, category: 'fyi' as TriageCategory, summary: '' }));
  }
}
