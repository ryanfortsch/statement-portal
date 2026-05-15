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

const SYSTEM_PROMPT = `You are Dotti's email assistant at Rising Tide STR, a vacation rental management company in Gloucester MA. Dotti runs operations: monthly owner statements, owner communications, vendor coordination, and prospect deals.

Dotti's email address is dotti@risingtidestr.com. The other team members at her company are ryan@risingtidestr.com (owner) and allie@risingtidestr.com. Each email line includes who it was sent to so you can tell whether Dotti is the primary recipient or just on cc / a shared inbox.

Classify each email so Dotti sees only what needs her in the morning brief:

needs_reply
  - Dotti is on the To: line (primary recipient) AND the sender wants a decision, an answer, or is waiting on her
  - Or Dotti is the only person on the team copied at all
  - Examples: "Can you send me the April statement?", "Are you free Thursday?", "We need your signature on this"

fyi
  - The email is addressed To: ryan@ or To: allie@ (or a shared inbox the team uses) and Dotti is just cc'd or seeing it through a shared label — Ryan / Allie owns the reply by default
  - Human correspondence that's informational, no action expected
  - Confirmations, thank-yous, status updates
  - Industry newsletters she actively reads
  - A coworker cc'ing her on context

notification
  - Automated system output: Quo (OpenPhone) SMS forwards, Stripe / Resend / Vercel / GitHub bot mails, calendar invites that auto-fire, marketing newsletters she didn't subscribe to
  - Booking confirmations from Airbnb / VRBO when no action is needed
  - Anything where "from" is no-reply / notification / automated / hello@

When in doubt between fyi and needs_reply, choose fyi. Cost of a missed reply is lower than the cost of a noisy brief — and team members covered on To: usually handle their own threads.

Be terse in summaries. Skip "An email from X" — Dotti can see the sender. State the ask or the content directly.`;

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
