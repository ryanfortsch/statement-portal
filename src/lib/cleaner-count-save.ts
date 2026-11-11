import { z } from 'zod';
import { enrichCleanerGuestCounts, resolveCleanerCountTargets, type CleanerCountContext } from './cleaner-guest-counts.ts';

const saveRow = z.object({
  booking_id: z.uuid(), guesty_reservation_id: z.string().regex(/^[a-f0-9]{24}$/),
  confirmation_code: z.string().regex(/^[A-Za-z0-9_-]+$/).max(160),
  check_in: z.iso.date(), check_out: z.iso.date(),
  source: z.enum(['ical_import', 'guesty_legacy']), status: z.enum(['confirmed', 'completed']),
  last_seen_at: z.string().datetime({ offset: true }).nullable(),
  num_guests: z.number().int().min(1).max(100),
}).strict();
export type CleanerCountSaveRow = z.infer<typeof saveRow>;

/** Owner-initiated backfill of missing counts only. The caller supplies no
 * booking IDs or counts: both come from the current canonical/source reads.
 * Existing counts remain operator-owned; this is not continuous Guesty sync. */
export async function saveMissingCleanerCounts(before: CleanerCountContext, deps: {
  readReservation: (id: string) => Promise<unknown>;
  reloadContext: () => Promise<CleanerCountContext>;
  commit: (rows: CleanerCountSaveRow[], checkedAt: string) => Promise<number>;
  now?: () => Date;
}): Promise<number> {
  const targets = resolveCleanerCountTargets(before);
  if (!targets.length) return 0;
  const verified = await enrichCleanerGuestCounts(before, deps);
  const checkedAt = verified.guestCountCheck?.checkedAt;
  if (verified.guestCountCheck?.status !== 'verified' || !checkedAt) throw Error('Counts unavailable');
  const rows = targets.map(target => {
    const booking = before.bookings.find(b => b.check_in === target.checkIn && b.check_out === target.checkOut)!;
    const stay = verified.stays.find(s => s.checkIn === target.checkIn && s.checkOut === target.checkOut);
    if (booking.num_guests !== null || stay?.guestCountSource !== 'guesty') throw Error('Counts unavailable');
    return saveRow.parse({ booking_id: booking.id, guesty_reservation_id: target.id,
      confirmation_code: target.code, check_in: target.checkIn, check_out: target.checkOut,
      source: booking.source, status: booking.status, last_seen_at: booking.last_seen_at, num_guests: stay.guests });
  });
  if (new Set(rows.map(r => r.booking_id)).size !== rows.length) throw Error('Counts unavailable');
  const saved = await deps.commit(rows, checkedAt);
  if (saved !== rows.length) throw Error('Save result unavailable');
  return saved;
}
