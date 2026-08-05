/**
 * Stale-reservation cancel reconcile -- Phase 2 of the cancelled-reservation
 * leak fix.
 *
 * Guesty's /v1/reservations list feed stops returning a reservation the
 * moment it leaves `confirmed` -- both cancels and ordinary
 * checked-in/checked-out transitions -- and ignoreStatusFilter does not
 * bring them back (proven no-op, see memory guesty-sync-pagination-debt).
 * So a cancelled booking's Helm row freezes at "confirmed" with a stale
 * synced_at, forever: it keeps counting toward Revenue occupancy, the
 * next month's booked revenue, and the turnover pipeline. Live proof:
 * HMZSQDQR23 (36 Granite) cancelled ~Jun 22, still "confirmed" on Aug 5
 * while Guesty's calendar sold the open dates.
 *
 * After each successful feed pull, this pass takes the rows the pull
 * SHOULD have refreshed but didn't (synced_at still lagging, checkout
 * within the lookback or later) and verifies each against the live API
 * with the per-code confirmationCode filter -- the one detection verified
 * to return canceled rows on this account (see lib/cancel-check.ts).
 * Live-cancelled rows flip in guesty_reservations AND their matching
 * bookings rows (mark-don't-delete, same shape as ical-sync; a cancelled
 * non-aggregate row is a trusted cancel for dedupeAllBookings). Anything
 * else just gets its true status + synced_at stamped so it isn't
 * re-probed for a while.
 *
 * Bounded by design: future check-ins (the rows that can silently distort
 * money views) re-probe hourly; past check-ins (mostly harmless
 * checked-in/checked-out status lag) every 12h; a hard per-run cap keeps
 * the sequential per-code calls rate-limit polite. Unknown probe results
 * (429/network) change nothing and retry next run.
 */
import { supabaseAdmin } from './supabase-admin';
import { checkLiveGuestyStatus, isCancelledStatus } from './cancel-check';

const RECONCILE_CAP_PER_RUN = 25;
const RECONCILE_FUTURE_RECHECK_MS = 60 * 60 * 1000; // 1h
const RECONCILE_PAST_RECHECK_MS = 12 * 60 * 60 * 1000; // 12h
const RECONCILE_LOOKBACK_DAYS = 7;

type StaleReservationRow = {
  guesty_reservation_id: string;
  property_id: string | null;
  confirmation_code: string | null;
  check_in: string | null;
  check_out: string | null;
  status: string | null;
  synced_at: string | null;
};

export type ReconcileResult = {
  checked: number;
  flipped_cancelled: number;
  cancelled_codes: string[];
  refreshed: number;
  /** Stale rows beyond this run's cap; they heal on subsequent runs. */
  backlog: number;
};

export async function reconcileStaleReservations(): Promise<ReconcileResult> {
  const sb = supabaseAdmin;
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const lookback = new Date(now - RECONCILE_LOOKBACK_DAYS * 86400_000).toISOString().slice(0, 10);
  const futureStaleBefore = new Date(now - RECONCILE_FUTURE_RECHECK_MS).toISOString();
  const pastStaleBefore = new Date(now - RECONCILE_PAST_RECHECK_MS).toISOString();

  const { data, error } = await sb
    .from('guesty_reservations')
    .select('guesty_reservation_id, property_id, confirmation_code, check_in, check_out, status, synced_at')
    .gte('check_out', lookback)
    .not('confirmation_code', 'is', null)
    .not('status', 'in', '(canceled,cancelled,declined,expired,inquiry)')
    .lt('synced_at', futureStaleBefore)
    .order('synced_at', { ascending: true })
    .limit(200);
  if (error) throw new Error(`stale-reservation query failed: ${error.message}`);

  const candidates = ((data ?? []) as StaleReservationRow[]).filter((r) => {
    if (!r.check_in || !r.check_out || !r.confirmation_code) return false;
    if (r.check_in > today) return true; // future stay: hourly threshold already applied in the query
    return !r.synced_at || r.synced_at < pastStaleBefore; // in-progress/past stay: 12h
  });

  // Future check-ins first (cancel candidates), then oldest sync first.
  candidates.sort((a, b) => {
    const aFuture = a.check_in! > today ? 0 : 1;
    const bFuture = b.check_in! > today ? 0 : 1;
    if (aFuture !== bFuture) return aFuture - bFuture;
    return (a.synced_at ?? '').localeCompare(b.synced_at ?? '');
  });

  const suspects = candidates.slice(0, RECONCILE_CAP_PER_RUN);
  if (suspects.length === 0) {
    return { checked: 0, flipped_cancelled: 0, cancelled_codes: [], refreshed: 0, backlog: 0 };
  }

  const live = await checkLiveGuestyStatus(suspects.map((r) => r.confirmation_code!));

  let flipped = 0;
  let refreshed = 0;
  const cancelledCodes: string[] = [];
  const nowIso = new Date().toISOString();

  for (const row of suspects) {
    const liveStatus = live.get(row.confirmation_code!);
    // Unknown (rate-limited / auth / network): leave untouched, retry next run.
    if (!liveStatus) continue;

    const newlyCancelled = isCancelledStatus(liveStatus) && !isCancelledStatus(row.status);

    if (newlyCancelled && row.property_id && row.check_in && row.check_out) {
      // Flip bookings BEFORE guesty_reservations: if this write fails, the
      // reservation row stays stale and the whole pair retries on a later
      // probe, so the two tables can't drift apart permanently.
      const { error: bkErr } = await sb
        .from('bookings')
        .update({ status: 'cancelled', cancelled_at: nowIso })
        .eq('property_id', row.property_id)
        .eq('check_in', row.check_in)
        .eq('check_out', row.check_out)
        .neq('status', 'cancelled');
      if (bkErr) {
        console.error(`reconcile: bookings cancel failed for ${row.confirmation_code}: ${bkErr.message}`);
        continue;
      }
    }

    const { error: upErr } = await sb
      .from('guesty_reservations')
      .update({ status: liveStatus, synced_at: nowIso })
      .eq('guesty_reservation_id', row.guesty_reservation_id);
    if (upErr) {
      console.error(`reconcile: status update failed for ${row.confirmation_code}: ${upErr.message}`);
      continue;
    }

    if (newlyCancelled) {
      flipped += 1;
      cancelledCodes.push(row.confirmation_code!);
    } else {
      refreshed += 1;
    }
  }

  return {
    checked: suspects.length,
    flipped_cancelled: flipped,
    cancelled_codes: cancelledCodes,
    refreshed,
    backlog: candidates.length - suspects.length,
  };
}
