/**
 * The rules behind a campaign send: what it needs before it can go, the count
 * the operator confirmed, and when a send that never finished counts as
 * stopped. Pure, no imports, so the page, the actions and the tests share one
 * copy.
 *
 * A send is two steps since 2026-10-18 (audit, report 10: the red "Send to N"
 * button sat mid-form, pre-armed, one tap from the whole list). "Review and
 * send" saves the form and opens a panel naming the audience, the live count,
 * the subject and the from address; only that panel's button sends, and it
 * carries the count the operator saw. `sendCampaign` refuses a post whose
 * count does not match the list right now, which also turns an old tab's
 * one-tap button into a trip back to the review.
 */

/**
 * A `sending` row with no activity for this long is stopped, not slow. The
 * send loop runs inside one server action, and a Vercel function is cut off
 * at 300 seconds; ten minutes leaves room for a slow Resend without letting
 * an owner reset a send that is still going.
 */
export const CAMPAIGN_STUCK_MS = 10 * 60_000;

/** What the saved draft still lacks before it can be sent, in plain words. */
export function campaignSendMissing(
  c: { subject: string | null; body_text: string | null; segment_id: string | null },
  recipientCount: number,
): string[] {
  const missing: string[] = [];
  if (!c.subject?.trim()) missing.push('a subject');
  if (!c.body_text?.trim()) missing.push('a body');
  if (!c.segment_id) missing.push('an audience');
  else if (recipientCount <= 0) missing.push('at least one recipient in the audience');
  return missing;
}

/** The count posted from the review panel must be the count the send would use. */
export function confirmedCountMatches(posted: FormDataEntryValue | null, liveCount: number): boolean {
  if (typeof posted !== 'string' || !/^\d+$/.test(posted.trim())) return false;
  return liveCount > 0 && Number(posted.trim()) === liveCount;
}

/** Whether a `sending` campaign has stopped: nothing since `lastActivityIso` for CAMPAIGN_STUCK_MS. */
export function campaignSendStopped(lastActivityIso: string | null, now: Date = new Date()): boolean {
  if (!lastActivityIso) return true;
  const t = Date.parse(lastActivityIso);
  if (!Number.isFinite(t)) return true;
  return now.getTime() - t >= CAMPAIGN_STUCK_MS;
}

/** "Stay Cape Ann <hello@staycapeann.com>", the from line the guest sees. */
export function campaignFromLine(fromName: string | null, fromEmail: string | null, defaults: { name: string; email: string }): string {
  return `${fromName?.trim() || defaults.name} <${fromEmail?.trim() || defaults.email}>`;
}

/** "1 recipient", "410 recipients". */
export function recipientsLabel(n: number): string {
  return `${n} recipient${n === 1 ? '' : 's'}`;
}
