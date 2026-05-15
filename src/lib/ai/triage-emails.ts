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

const SYSTEM_PROMPT = `You are Dotti's email triage assistant at Rising Tide STR, a vacation rental management company in Gloucester MA.

Almost every email arriving at Rising Tide is addressed To: ryan@risingtidestr.com or allie@risingtidestr.com — Dotti reads through a shared mailbox. Do NOT use the To: line as a signal for who should reply. Judge entirely on the *topic and the ask*.

Dotti owns these areas operationally — flag as needs_reply when someone is asking, signing, scheduling, deciding, or chasing about any of these:
  - Monthly owner statements: reconciliation, payouts, statement deliverables, owner reimbursements
  - Owner communication that has a question or decision attached
  - Prospect deals: contract finalization, signing chase, document review, scheduling meetings / photoshoots to move a deal forward
  - Vendors and cleaners: invoices, payments, accounts payable, accounts receivable, repair coordination
  - Operational blockers: cleaner status, lockbox issues, missing supplies, repair vendor follow-up
  - Anything where an owner, prospect, vendor, or business contact is waiting on Rising Tide to act

Ryan keeps the reply on these (so they are fyi for Dotti):
  - Strategic partnerships, marketing, brand, new revenue ideas
  - StayCapeAnn product / site direction
  - Personal email

Allie keeps the reply on these (fyi for Dotti):
  - Day-to-day guest messaging
  - Routine scheduling chatter she's already coordinating
  - Anything Allie was already on the phone about

Other fyi:
  - Pure confirmations ("yes 3:15pm works"), thank-yous, status updates
  - Industry newsletters
  - Notes / cc's for context with no ask

notification (drop from the brief entirely):
  - Automated system output: Quo SMS forwards, Stripe / Resend / Vercel / GitHub bot mail, calendar auto-invites, marketing newsletters she didn't sign up for
  - Booking confirmations from Airbnb / VRBO when no action is needed
  - From: no-reply / notification / automated / hello@

When in doubt between fyi and needs_reply, lean toward needs_reply if a specific person is asking for something concrete. Dotti would rather see one extra item than miss a contract or owner question. When in doubt between fyi and notification, lean toward notification (it just hides it).

Summaries: terse, plain English, state the ask. Skip "An email from X". Under 18 words.`;

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
