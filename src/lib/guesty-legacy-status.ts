/**
 * Guesty reservation status -> `bookings` status, for the guesty_legacy
 * backfill (guesty-backfill.ts). Import-free at runtime so `npm test`
 * covers the one rule that depends on a date.
 *
 * `declined` and `expired` are recognised explicitly: both mean the stay
 * never happened, and an old catch-all mirrored them into bookings as
 * `confirmed`, which is a checkout the cleaner schedule then sends someone
 * to.
 *
 * `closed` is Guesty retiring a reservation RECORD, and on this account it
 * has meant four things: a real stay after checkout (12 of the 14 closed
 * reservations on 2026-09-01), an altered Airbnb booking's superseded code
 * (Robin Tellier, 21 Horton, two closed codes beside the confirmed one), a
 * Booking.com "Guest to be announced" placeholder superseded by the named
 * record (20 Hammond 2026-09-02, two beside Carola Raggl's), and a booking
 * that fell through (Had Deane, 53 Rocky Neck Downstairs). Only the first is
 * a stay, and it is behind us: a record closed while its check-in is still
 * ahead cannot have been retired after happening. So closed BEFORE ARRIVAL
 * is cancelled. Seven such rows sat `confirmed` on 2026-09-21, six Booking.com
 * placeholders at 3 Locust and one at 73 Rocky Neck, booked 2025-08 to
 * 2026-07, each overlapping a different guest's confirmed stay that Guesty
 * could not have sold if the record held the nights. They were five of the
 * double-booking list and four phantom checkouts on the cleaner schedule.
 * Closed on or after the check-in date keeps falling through: history is not
 * rewritten from a status we cannot read either way.
 *
 * An unrecognised or absent status returns null, meaning "Guesty did not
 * tell us". A new row still defaults to confirmed on null, because a stay
 * we know nothing about is more safely cleaned than skipped, but an
 * EXISTING row is left alone; see the status patch in the backfill's
 * mirror loop.
 */

import type { BookingStatus } from '@/lib/channels-types';

export function mapGuestyStatus(
  raw: string | null,
  stay: {
    /** YYYY-MM-DD, the reservation's check-in. */
    checkIn: string;
    /** YYYY-MM-DD, property-local. */
    today: string;
  },
): BookingStatus | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s.includes('cancel') || s.includes('declined') || s.includes('expired')) return 'cancelled';
  if (s.includes('inquiry')) return 'inquiry';
  if (s.includes('pending')) return 'pending';
  if (s.includes('completed')) return 'completed';
  if (s.includes('confirmed') || s.includes('reserved')) return 'confirmed';
  if (s.includes('closed')) return stay.checkIn > stay.today ? 'cancelled' : null;
  return null;
}
