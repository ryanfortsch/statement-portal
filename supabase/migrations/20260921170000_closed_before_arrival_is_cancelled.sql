-- Catch-up for the rule in src/lib/guesty-legacy-status.ts: a Guesty
-- reservation `closed` while its check-in is still ahead is a cancellation,
-- not a retired stay. The bookings backfill applies this on every run from
-- now on; this applies it once to the rows already on file, so the
-- double-booking list and the cleaner schedule are right today rather than
-- after the nightly run. On 2026-09-21 that is seven guesty_legacy rows, all
-- Booking.com "Guest to be announced" placeholders (six at 3 Locust, one at
-- 73 Rocky Neck, booked 2025-08 to 2026-07), each overlapping another guest's
-- confirmed stay.
--
-- Apply AFTER the deploy. The planner that relinks duplicate_of on the next
-- channels-sync must already know that an unnamed record's cancel is not a
-- trusted cancel (isUnnamedRecord in src/lib/booking-dedupe.ts); the old
-- planner would have hidden Gary Heathcote's 2027-06-01 stay under its
-- cancelled placeholder.
--
-- Idempotent. Rows already cancelled are untouched. cancelled_at stays null,
-- as the backfill's own status patch leaves it.
update public.bookings b
set status = 'cancelled'
from public.guesty_reservations g
where b.source = 'guesty_legacy'
  and b.external_booking_id = g.guesty_reservation_id
  and g.status = 'closed'
  and b.status <> 'cancelled'
  and g.check_in > (now() at time zone 'America/New_York')::date;
