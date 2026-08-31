/**
 * Dedupe helper for the Guesty reservation upsert.
 *
 * Its own module, and deliberately import-free, so the rule can be exercised
 * directly by scripts/guesty_reservation_dedupe_check.mjs without dragging in
 * the Supabase client or the `@/` path alias.
 */

/**
 * Collapse rows sharing a guesty_reservation_id, last occurrence winning.
 *
 * Postgres refuses an INSERT .. ON CONFLICT DO UPDATE whose batch touches the
 * same conflict target twice ("ON CONFLICT DO UPDATE command cannot affect row
 * a second time"), and it refuses the WHOLE statement, so a single duplicate
 * discards every row in the pull.
 *
 * The Guesty list feed produces duplicates on its own. Pagination is
 * skip/limit over an ordering the API never promises to hold stable, so a
 * reservation that shifts position between two page fetches comes back on
 * both. That is not an error condition and must not be treated as one: it is
 * the same reservation twice, and the later copy is the fresher read.
 *
 * This bit for real. The sync failed 39 consecutive times between 2026-08-25
 * and 2026-08-31, and because the reservations step is the gate on the
 * cancel-reconcile and bookings-backfill steps, those silently stopped too.
 * Nothing surfaced it: recordSyncFailure leaves last_synced_at pointing at the
 * last SUCCESS, so every dashboard kept serving six-day-old bookings while
 * looking healthy.
 */
export function dedupeByReservationId<T extends { guesty_reservation_id?: string | null }>(
  rows: T[],
): T[] {
  const byId = new Map<string, T>();
  const out: T[] = [];
  for (const r of rows) {
    const id = r.guesty_reservation_id;
    if (!id) { out.push(r); continue; } // no conflict target, cannot collide
    byId.set(id, r); // last wins: the freshest read of the same reservation
  }
  return [...out, ...byId.values()];
}
