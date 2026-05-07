-- Channels Phase 1.5 follow-ups.
--
-- 1. Per-property iCal export token. Lets Airbnb / VRBO / Booking.com
--    pull a master availability feed FROM Helm (in addition to us
--    pulling FROM each of them). This is the second half of the
--    channel-manager loop and is what prevents double-bookings when
--    a stay lands on one channel — the others see it blocked within
--    their next pull window.
--
-- 2. Index on bookings.external_booking_id so the Guesty backfill
--    upsert is idempotent without scanning the table.

alter table public.properties
  add column if not exists ical_export_token uuid unique default gen_random_uuid();

-- Backfill any properties that pre-date this column (the default only
-- applies to new inserts, so existing rows would otherwise be null).
update public.properties
  set ical_export_token = gen_random_uuid()
  where ical_export_token is null;

-- Make sure every property has one going forward.
alter table public.properties
  alter column ical_export_token set not null;

create index if not exists idx_bookings_external_booking_id
  on public.bookings(external_booking_id)
  where external_booking_id is not null;
