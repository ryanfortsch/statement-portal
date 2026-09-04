/**
 * Cancel `bookings` rows for reservations that are not real stays.
 *
 * Phase 3 of the cancelled-reservation leak. Phase 2
 * (reservation-reconcile) probes the live Guesty API per confirmation code
 * and flips a row when the API says `canceled`. That is necessary but not
 * sufficient: Guesty also retires a reservation as **`closed`**, and a
 * closed reservation may or may not have happened. Proven empirically on
 * 2026-09-01 across all 14 closed reservations on this account: 12 had
 * every night `booked` in the calendar (real stays), 2 had every night
 * `available` (never happened). Treating `closed` as cancelled would have
 * cancelled twelve live bookings.
 *
 * So `closed` is not the signal. Agreement between two independent
 * sources is:
 *
 *   1. The CALENDAR mirror, synced from Guesty separately, reports every
 *      night of the stay as `available` -- Guesty is selling those dates,
 *      so nobody is in the house.
 *   2. The RESERVATION record, already probed against the live API by
 *      phase 2, is in some non-live state (canceled / closed / declined /
 *      expired).
 *
 * Either alone is not enough. Calendar-only would have cancelled the two
 * 3 Locust 2027 pre-release placeholders, which are deliberate rows whose
 * dates Guesty has not opened yet. Reservation-status-only cancels real
 * stays, as above.
 *
 * Live case that motivated it: Had Deane, 53 Rocky Neck Downstairs,
 * 08-30 -> 09-01. Booked and cancelled on 08-31; the row stayed
 * `confirmed`, and on 09-01 the automatic evening digest sent the cleaners
 * to an empty house. `bookings` is read by the turnover rail, Field
 * packets and revenue as well, which is why this fixes the record rather
 * than only the cleaner schedule's reading of it.
 *
 * Mark, don't delete: the row is flipped to `cancelled` with cancelled_at
 * stamped, exactly as ical-sync and phase 2 do, so a cancelled
 * non-aggregate row remains a trusted cancel for dedupeAllBookings.
 */

import { supabaseAdmin } from './supabase-admin';
import { selectAllPaged } from './paged-select';

/** Mirror rows older than this cannot overrule a confirmed booking: we
 *  could not tell "cancelled" from "not synced lately". */
const MIRROR_FRESH_HOURS = 36;

/** Reservation states that mean the stay is not live. `confirmed` is the
 *  only live one; an absent record is NOT evidence (direct/SCA bookings
 *  legitimately have none). */
const NON_LIVE_STATUSES = new Set(['canceled', 'cancelled', 'closed', 'declined', 'expired']);

/**
 * Refuse to act on more than this in one run. If the calendar mirror ever
 * syncs empty or wrong, unanimity becomes trivially true fleet-wide and
 * this pass would cancel the whole book of business. Same instinct as
 * ical-sync's empty-feed guard: a suspiciously large cancel is a bug
 * signal, not a mandate.
 */
const MAX_CANCELS_PER_RUN = 5;

/** Only look at stays that are current or recent. An old row being wrong
 *  hurts nobody today, and the mirror does not retain distant history. */
const LOOKBACK_DAYS = 14;

/** The other half of "current or recent". Without it the candidate set ran
 *  to the far future and the calendar read below spanned a year. */
const FORWARD_DAYS = 60;

export type GhostBookingResult = {
  examined: number;
  cancelled: number;
  /** Calendar says empty but the reservation record does not corroborate:
   *  deliberately left alone, reported so it is never a silent skip. */
  uncorroborated: number;
  /** True when the cap tripped and NOTHING was cancelled. */
  refusedTooMany: boolean;
  details: Array<{ propertyId: string; checkIn: string; checkOut: string; guest: string; guestyStatus: string }>;
  errors: string[];
};

type CandidateRow = {
  id: string;
  property_id: string;
  check_in: string;
  check_out: string;
  guest_name: string | null;
  external_confirmation_code: string | null;
  first_seen_at: string | null;
};

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function nightsOf(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  let d = checkIn;
  for (let i = 0; i < 400 && d < checkOut; i++) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

export async function cancelGhostBookings(
  opts?: { dryRun?: boolean },
): Promise<GhostBookingResult> {
  const result: GhostBookingResult = {
    examined: 0,
    cancelled: 0,
    uncorroborated: 0,
    refusedTooMany: false,
    details: [],
    errors: [],
  };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const from = addDays(today, -LOOKBACK_DAYS);

  // Bounded at BOTH ends. The docblock has always said "current or recent",
  // but with no upper bound every future booking widened the calendar read
  // below, including the 3 Locust 2027 pre-release placeholders, which
  // stretched one select across roughly a year times the whole fleet.
  const until = addDays(today, FORWARD_DAYS);
  const { data: candRows, error: candErr } = await supabaseAdmin
    .from('bookings')
    .select('id, property_id, check_in, check_out, guest_name, external_confirmation_code, first_seen_at')
    .eq('status', 'confirmed')
    .is('duplicate_of', null)
    .gte('check_out', from)
    .lte('check_out', until);
  if (candErr) {
    result.errors.push(`bookings: ${candErr.message}`);
    return result;
  }
  const candidates = (candRows ?? []) as CandidateRow[];
  result.examined = candidates.length;
  if (candidates.length === 0) return result;

  // ── signal 1: the calendar mirror ──────────────────────────────────
  const allNights = candidates.flatMap((c) => nightsOf(c.check_in, c.check_out));
  if (allNights.length === 0) return result;
  const propertyIds = [...new Set(candidates.map((c) => c.property_id))];
  const nightsFrom = allNights.reduce((a, b) => (a < b ? a : b));
  const nightsTo = allNights.reduce((a, b) => (a > b ? a : b));
  // PAGED. A bare select stops at PostgREST's silent 1000-row cap, and the
  // missing cells read as "no mirror row", which makes a candidate look
  // uncorroborated and quietly drops it. The pass then reports a clean run
  // having examined almost nothing. Ordered by (property_id, date) because
  // range() is an OFFSET window and an unstable sort overlaps or skips.
  let calRows: Array<{ property_id: string; date: string; status: string; synced_at: string | null }>;
  try {
    calRows = await selectAllPaged((fromIdx, toIdx) =>
      supabaseAdmin
        .from('property_calendar_days')
        .select('property_id, date, status, synced_at')
        .in('property_id', propertyIds)
        .gte('date', nightsFrom)
        .lte('date', nightsTo)
        .order('property_id', { ascending: true })
        .order('date', { ascending: true })
        .range(fromIdx, toIdx),
    );
  } catch (err) {
    result.errors.push(`calendar: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }
  const { data: listingRows, error: listingErr } = await supabaseAdmin
    .from('guesty_listings')
    .select('property_id')
    .in('property_id', propertyIds);
  if (listingErr) {
    result.errors.push(`guesty_listings: ${listingErr.message}`);
    return result;
  }
  // A multi-listing property's mirror is merged ('available' if ANY
  // listing is open), so it cannot prove a stay is absent. Exempt, same
  // as the read-side guard in checkout-schedule.ts.
  const listingCount = new Map<string, number>();
  for (const r of (listingRows ?? []) as Array<{ property_id: string | null }>) {
    if (r.property_id) listingCount.set(r.property_id, (listingCount.get(r.property_id) ?? 0) + 1);
  }
  const freshCutoff = Date.now() - MIRROR_FRESH_HOURS * 3600_000;
  const cal = new Map<string, { status: string; syncedMs: number }>();
  for (const r of calRows) {
    const ms = r.synced_at ? Date.parse(r.synced_at) : NaN;
    cal.set(`${r.property_id}|${r.date}`, { status: (r.status || '').toLowerCase(), syncedMs: ms });
  }

  const calendarSaysEmpty = candidates.filter((c) => {
    if ((listingCount.get(c.property_id) ?? 0) > 1) return false;
    const nights = nightsOf(c.check_in, c.check_out);
    if (nights.length === 0) return false;
    // The mirror must postdate the booking: rows synced before Helm first
    // saw the booking say nothing about it. Unknown first_seen_at = keep.
    const seenMs = c.first_seen_at ? Date.parse(c.first_seen_at) : NaN;
    if (!Number.isFinite(seenMs)) return false;
    return nights.every((n) => {
      const cell = cal.get(`${c.property_id}|${n}`);
      if (!cell || !Number.isFinite(cell.syncedMs)) return false;
      return cell.syncedMs >= freshCutoff && cell.syncedMs > seenMs && cell.status === 'available';
    });
  });
  if (calendarSaysEmpty.length === 0) return result;

  // ── signal 2: the reservation record, already API-probed ───────────
  const codes = calendarSaysEmpty.map((c) => c.external_confirmation_code).filter((c): c is string => !!c);
  const resStatus = new Map<string, string>();
  if (codes.length > 0) {
    const { data: resRows } = await supabaseAdmin
      .from('guesty_reservations')
      .select('confirmation_code, status')
      .in('confirmation_code', codes);
    for (const r of (resRows ?? []) as Array<{ confirmation_code: string; status: string | null }>) {
      resStatus.set(r.confirmation_code, (r.status || '').toLowerCase());
    }
  }

  const confirmed: Array<CandidateRow & { guestyStatus: string }> = [];
  for (const c of calendarSaysEmpty) {
    const st = c.external_confirmation_code ? resStatus.get(c.external_confirmation_code) : undefined;
    if (st && NON_LIVE_STATUSES.has(st)) confirmed.push({ ...c, guestyStatus: st });
    else result.uncorroborated += 1;
  }
  if (confirmed.length === 0) return result;

  if (confirmed.length > MAX_CANCELS_PER_RUN) {
    // Do nothing at all. A run this large means the mirror is wrong, not
    // that the business evaporated.
    result.refusedTooMany = true;
    result.errors.push(
      `refused: ${confirmed.length} candidates exceeds the ${MAX_CANCELS_PER_RUN}-per-run cap; calendar mirror is suspect`,
    );
    return result;
  }

  for (const c of confirmed) {
    result.details.push({
      propertyId: c.property_id,
      checkIn: c.check_in,
      checkOut: c.check_out,
      guest: c.guest_name || '(no name)',
      guestyStatus: c.guestyStatus,
    });
    if (opts?.dryRun) continue;
    const { error } = await supabaseAdmin
      .from('bookings')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', c.id)
      .eq('status', 'confirmed');
    if (error) result.errors.push(`cancel ${c.property_id} ${c.check_in}: ${error.message}`);
    else result.cancelled += 1;
  }
  return result;
}
