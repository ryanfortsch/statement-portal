/**
 * When a direct inquiry stops being a question.
 *
 * /channels opened on "Direct inquiries · 214 pending" on 2026-10-17, each
 * row with Confirm and Decline. An inquiry asks for nights; once its check-in
 * date has passed there is nothing left to confirm, and most of the 214 were
 * requests for dates already behind us. Nothing ever closed one.
 *
 * The rule: an inquiry whose check-in is before today (Eastern) is expired.
 *
 * - Read side, every inquiry: the pending count and the list are the open
 *   ones only; expired ones sit under a fold on /channels with a link to the
 *   record. That covers the inquiries a feed brought in (the Guesty backfill
 *   holds most of them): their status is the feed's to write, and the
 *   nightly backfill would set a closed one straight back to 'inquiry'.
 * - Write side, Helm's own inquiries only (the /book form and hand-entered
 *   requests): the nightly /api/cron/expire-queues closes each through the
 *   locked writer as cancelled with cancel_reason 'expired'. No email goes
 *   to anyone; helm_cancel_booking sends nothing. The record and its change
 *   log stay.
 *
 * Import-free at runtime (type imports only) so `npm test` covers the rule.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** cancel_reason on an inquiry the sweep closed. */
export const EXPIRED_INQUIRY_REASON = 'expired';

/** Who the locked writer records as closing it. */
export const INQUIRY_EXPIRY_ACTOR = 'helm-expiry';

/**
 * Sources whose status Helm writes. A row from a feed (guesty_legacy,
 * ical_import, email_parse) is the feed's to close: closing it here would be
 * undone by the next sync and logged again every night.
 */
export const HELM_OWNED_INQUIRY_SOURCES = ['direct_booking', 'manual'] as const;

export type InquiryLike = {
  status: string;
  check_in: string;
  cancel_reason?: string | null;
};

/** An inquiry still waiting whose check-in date has passed. */
export function isInquiryExpired(b: InquiryLike, today: string): boolean {
  return b.status === 'inquiry' && b.check_in.slice(0, 10) < today;
}

/** An inquiry still waiting for a decision: asks for nights not yet past. */
export function isInquiryOpen(b: InquiryLike, today: string): boolean {
  return b.status === 'inquiry' && b.check_in.slice(0, 10) >= today;
}

/** A Helm-owned inquiry the sweep already closed. */
export function isExpiredClosure(b: InquiryLike): boolean {
  return b.status === 'cancelled' && b.cancel_reason === EXPIRED_INQUIRY_REASON;
}

/** May the nightly sweep close this inquiry itself? */
export function mayCloseInquiry(b: { source: string }): boolean {
  return (HELM_OWNED_INQUIRY_SOURCES as readonly string[]).includes(b.source);
}

/**
 * The PostgREST `or` filter for the fold: inquiries past their check-in that
 * a feed still calls 'inquiry', and Helm's own the sweep closed. Shared by
 * the list and its count so the fold's number is the fold's rows.
 */
export function expiredInquiriesOrFilter(today: string): string {
  return `and(status.eq.inquiry,check_in.lt.${today}),and(status.eq.cancelled,cancel_reason.eq.${EXPIRED_INQUIRY_REASON})`;
}

/** How the fold labels a row. */
export function expiredInquiryNote(b: InquiryLike): string {
  return isExpiredClosure(b) ? 'Closed: check-in passed' : 'Check-in passed';
}

/**
 * Close every Helm-owned inquiry whose check-in has passed. `close` is the
 * locked writer (the cron passes cancelBooking with reason 'expired'). One
 * failure never stops the rest; capped per run so a backlog drains over a
 * few nights instead of timing out.
 */
export async function expireStaleInquiries(
  supabase: SupabaseClient,
  today: string,
  close: (id: string) => Promise<unknown>,
  limit = 100,
): Promise<{ closed: number; failed: number }> {
  const { data, error } = await supabase
    .from('bookings')
    .select('id, source, status, check_in')
    .eq('status', 'inquiry')
    .lt('check_in', today)
    .in('source', [...HELM_OWNED_INQUIRY_SOURCES])
    .is('duplicate_of', null)
    .order('check_in', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`expire inquiries: ${error.message}`);
  let closed = 0;
  let failed = 0;
  for (const row of (data ?? []) as Array<{ id: string; source: string; status: string; check_in: string }>) {
    if (!isInquiryExpired(row, today) || !mayCloseInquiry(row)) continue;
    try {
      // helm_cancel_booking cancels whatever it is handed. Re-read right
      // before the write so a Confirm that landed since the list was read
      // is never cancelled as if it were still a stale request.
      const { data: now, error: nowErr } = await supabase
        .from('bookings')
        .select('id, source, status, check_in')
        .eq('id', row.id)
        .maybeSingle();
      if (nowErr) throw nowErr;
      if (!now || !isInquiryExpired(now as InquiryLike, today)) continue;
      await close(row.id);
      closed += 1;
    } catch {
      failed += 1;
    }
  }
  return { closed, failed };
}
