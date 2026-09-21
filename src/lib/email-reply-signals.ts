/**
 * Pure reply-detection over the two cross-thread signals the daily brief
 * collects: the latest Gmail Sent timestamp per recipient address, and the
 * latest outbound contact_touches timestamp per contact email (Quo SMS,
 * phone, a manual log, or stay-concierge's owner-messaging send).
 *
 * The same-thread check (a Rising Tide message after the inbound on the
 * Gmail thread) needs a network call and lives in daily-brief.ts. This
 * module has no imports so it can be unit-tested without a Supabase env.
 */

export type ReplySignals = {
  /** recipient email (lowercase) → ms of the most recent Gmail Sent message to them */
  recentSentTo: Map<string, number>;
  /** contact email (lowercase) → ms of the most recent outbound contact touch */
  recentTouchTo: Map<string, number>;
};

/** How a needs_reply email was retired. Stored in email_triage.handled_via. */
export type HandledVia = 'reply_thread' | 'reply_sent' | 'contact_touch' | 'operator';

/**
 * Which cross-thread signal (if any) shows we answered this sender after
 * the inbound arrived. Returns null when neither signal fires; the caller
 * then falls back to the same-thread check.
 */
export function replySignalFor(
  signals: ReplySignals,
  fromEmail: string | null | undefined,
  receivedAt: string,
): Extract<HandledVia, 'reply_sent' | 'contact_touch'> | null {
  if (!fromEmail) return null;
  const inboundMs = new Date(receivedAt).getTime();
  if (!Number.isFinite(inboundMs)) return null;
  const lower = fromEmail.trim().toLowerCase();
  const lastSent = signals.recentSentTo.get(lower);
  if (lastSent && lastSent > inboundMs) return 'reply_sent';
  const lastTouch = signals.recentTouchTo.get(lower);
  if (lastTouch && lastTouch > inboundMs) return 'contact_touch';
  return null;
}
