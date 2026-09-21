-- Direct Airbnb iCal rows: carry the confirmation code the feed already gave us.
--
-- Airbnb's per-listing .ics redacts the guest (SUMMARY "Reserved", no name)
-- but its DESCRIPTION links the reservation:
--
--   Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMEFDNMS4Z
--   Phone Number (Last 4 Digits): 4905
--
-- ical-sync stored that text in bookings.raw_description and left
-- external_confirmation_code null, so the direct-feed row for a stay carried
-- no identity and booking-dedupe could only place it by dates. That is the
-- gap behind #1568 at 20 Hammond: Lauren Foy's cancelled HMWM9T9STJ and Ashley
-- Dobransky's same-dates rebooking HMEFDNMS4Z fused across the two nameless
-- rows. The companion code change parses the code on import
-- (src/lib/ical.ts airbnbConfirmationCode); this fills in the rows already on
-- file so the dedupe's first pass joins them by code for good.
--
-- Only rows with NO code are touched. Rows that already carry one were
-- enriched by the dedupe pass from a coded twin and are left alone. One of
-- them (73 Rocky Neck, 2026-08-15..16, bookings.id 0d5a1838-4fef-4556-a165-
-- d0112442450f) carries GY-YUgLRYdR while its own description says
-- HM4RT3HFW8: the pre-#1568 fused cluster pooled the guest's direct-booking
-- code onto her Airbnb row. Both reservations are past and cancelled; it is
-- reported, not rewritten here.
--
-- Idempotent: a second run matches zero rows. Apply AFTER the companion code
-- is deployed. The old sync wrote external_confirmation_code = null on every
-- row still on the feed, so applied first it would be undone within the
-- half-hour for every live stay.
--
--   supabase db query --linked --file supabase/migrations/20260921130000_airbnb_ical_confirmation_code_backfill.sql
--
-- Before (2026-09-21): 43 direct Airbnb rows with a link and no code, each
-- with a same-code, same-dates twin at the same property. Guest names are
-- not touched: the feed has none.

with fixed as (
  update public.bookings b
     set external_confirmation_code =
           upper(substring(b.raw_description from 'airbnb\.com/hosting/reservations/details/([A-Za-z0-9]+)'))
   where b.external_confirmation_code is null
     and b.raw_description ~ 'airbnb\.com/hosting/reservations/details/[A-Za-z0-9]+'
  returning b.id, b.property_id, b.external_confirmation_code
)
select count(*)::int as backfilled,
       count(distinct external_confirmation_code)::int as distinct_codes,
       count(distinct property_id)::int as properties
  from fixed;
