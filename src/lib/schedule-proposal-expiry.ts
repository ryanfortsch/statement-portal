/**
 * When a checkout proposal stops being a question.
 *
 * "Detected but not applied" on /turnovers/schedule lists the checkout
 * changes the thread miner, the Guesty-hold reader and the concierge bridge
 * were not sure enough to apply (checkout_adjustments, status 'proposed').
 * Nothing ever took one off the list except a human, so on 2026-10-17 it held
 * eight proposals about stays that ended on August 30, September 6, 13 and 14
 * and October 4, each still offering Apply. Once the guest has gone, the
 * checkout they asked about has happened one way or the other; the question
 * is over.
 *
 * The rule: a proposal whose stay has ended (its last possible checkout is
 * before today, Eastern) is dismissed with a note saying so. Dismissed, never
 * deleted: the fold on the schedule lists it with Restore. A restore stamps
 * restored_at and the sweep never touches that row again, the same
 * once-a-human-decided rule as the work board's organized_at.
 *
 * One rule, two callers: the schedule page runs the sweep on load and
 * /api/cron/expire-queues runs it nightly, so a list nobody opens still
 * drains.
 *
 * Import-free at runtime (type imports only) so `npm test` covers the rule.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type ProposalStay = {
  original_check_out: string;
  adjusted_check_out: string | null;
};

/** Booking statuses that mean a guest is (or was) actually in the house. The
 *  schedule's own STAY_STATUSES. */
const LIVE_STAY_STATUSES = ['confirmed', 'completed'];

/**
 * The last day the guest this proposal is about can still be in the house:
 * the latest of the checkout it was mined against, the date it proposes, and
 * what the booking row says now (Guesty may have caught up with a longer
 * extension since). YYYY-MM-DD strings compare as dates.
 */
export function proposalStayEnd(p: ProposalStay, liveCheckOut?: string | null): string {
  let end = p.original_check_out.slice(0, 10);
  for (const d of [p.adjusted_check_out, liveCheckOut]) {
    const day = d ? d.slice(0, 10) : '';
    if (day > end) end = day;
  }
  return end;
}

/**
 * A proposal is expired once its stay has ended: checkout day itself is still
 * live (a late checkout today is exactly the question), the day after is not.
 * `today` is the operating date in Eastern (src/lib/operating-date.ts).
 */
export function isProposalExpired(p: ProposalStay, today: string, liveCheckOut?: string | null): boolean {
  return proposalStayEnd(p, liveCheckOut) < today;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09-14" -> "Sep 14", with the year only when it is not this year's. */
export function shortDay(iso: string, today: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const label = `${MONTHS[m - 1]} ${d}`;
  return String(y) === today.slice(0, 4) ? label : `${label}, ${y}`;
}

/** The note an expired proposal carries in the fold. */
export function expiredProposalNote(stayEnd: string, today: string): string {
  return `Expired: stay ended ${shortDay(stayEnd, today)}`;
}

/** Who wrote a dismissal the sweep made (dismissed_by). */
export const PROPOSAL_EXPIRY_ACTOR = 'helm-expiry';

type Candidate = ProposalStay & { id: string; property_id: string; stay_check_in: string };

/**
 * Dismiss every waiting proposal whose stay has ended. Returns how many it
 * dismissed. Each write is guarded on the row still being 'proposed' and never
 * restored, so a tap that landed between the read and the write wins.
 */
export async function expireStaleProposals(
  supabase: SupabaseClient,
  today: string,
): Promise<{ expired: number }> {
  // Only a stay whose booked checkout is already behind us can have ended.
  // An extension or a live booking can only push the end LATER, so this is
  // the full candidate set, and the per-row check below settles each one.
  const { data, error } = await supabase
    .from('checkout_adjustments')
    .select('id, property_id, stay_check_in, original_check_out, adjusted_check_out')
    .eq('status', 'proposed')
    .is('restored_at', null)
    .lt('original_check_out', today)
    .limit(500);
  if (error) throw new Error(`expire proposals: ${error.message}`);
  const candidates = (data ?? []) as Candidate[];
  if (candidates.length === 0) return { expired: 0 };

  // What the booking says now, per stay. Keyed (property_id, check_in) like
  // every other stay lookup: bookings holds several rows per stay by design.
  const liveCheckOut = new Map<string, string>();
  const { data: stays, error: staysErr } = await supabase
    .from('bookings')
    .select('property_id, check_in, check_out')
    .in('property_id', [...new Set(candidates.map((c) => c.property_id))])
    .in('check_in', [...new Set(candidates.map((c) => c.stay_check_in))])
    .in('status', LIVE_STAY_STATUSES)
    .is('duplicate_of', null);
  // A failed read must not expire a stay Guesty extended: without the live
  // checkout, wait for the next pass.
  if (staysErr) throw new Error(`expire proposals (bookings): ${staysErr.message}`);
  for (const s of (stays ?? []) as Array<{ property_id: string; check_in: string; check_out: string }>) {
    const key = `${s.property_id}|${s.check_in.slice(0, 10)}`;
    const prior = liveCheckOut.get(key);
    const day = s.check_out.slice(0, 10);
    if (!prior || day > prior) liveCheckOut.set(key, day);
  }

  let expired = 0;
  const now = new Date().toISOString();
  for (const c of candidates) {
    const live = liveCheckOut.get(`${c.property_id}|${c.stay_check_in.slice(0, 10)}`) ?? null;
    if (!isProposalExpired(c, today, live)) continue;
    const { data: hit } = await supabase
      .from('checkout_adjustments')
      .update({
        status: 'dismissed',
        dismissed_at: now,
        dismissed_by: PROPOSAL_EXPIRY_ACTOR,
        dismissed_note: expiredProposalNote(proposalStayEnd(c, live), today),
        updated_at: now,
      })
      .eq('id', c.id)
      .eq('status', 'proposed')
      .is('restored_at', null)
      .select('id');
    if (hit && hit.length > 0) expired += 1;
  }
  return { expired };
}
