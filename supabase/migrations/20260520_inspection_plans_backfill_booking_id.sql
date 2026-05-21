-- One-time data migration: repoint existing inspection_plans onto canonical
-- bookings ids, as part of the Operations cutover from guesty_reservations to
-- the Helm-native bookings table.
--
-- Legacy plans were keyed by the Guesty reservation id. That id now lives on
-- the corresponding guesty_legacy booking's external_booking_id. We resolve
-- each legacy plan to the canonical booking for that stay (following
-- duplicate_of when the guesty_legacy row was deduped against an iCal import)
-- and set both booking_id and guesty_reservation_id to the canonical id, so
-- the Operations read (which now matches on booking.id) finds them.
--
-- Idempotent: only touches rows where booking_id is still null. A no-op on any
-- environment whose bookings table has no matching external_booking_id.

update public.inspection_plans p
set booking_id = coalesce(b.duplicate_of, b.id),
    guesty_reservation_id = coalesce(b.duplicate_of, b.id)::text
from public.bookings b
where b.external_booking_id = p.guesty_reservation_id
  and p.booking_id is null;
