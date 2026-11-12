-- Guesty's guest-facing arrival time, kept per listing (2026-11-11).
--
-- A guest's check-in time has one store per home: the Helm rate plan
-- (property_rate_plans.checkin_time) on a Helm-run home, and the Guesty
-- listing (defaultCheckInTime) on a Guesty-run one. Helm kept only the
-- first, so the guest app and the stay link had no arrival hour for any
-- Guesty-run home (21 Horton's "Getting here" said "Parking & directions"
-- instead of "Check-in 4:00 PM"). A rate plan cannot be made just to hold
-- the hour: it needs a nightly price, and PriceLabs owns price.
--
-- /api/sync-guesty writes this column from each listing it maps, every
-- run, so Guesty stays the one store and an edit there reaches the guest
-- app the next night. Never properties.default_checkin_time: that is the
-- cleaner deadline (15:00), a different value on purpose.
--
-- An existing table (map rows, service role): no new grant is needed.
alter table public.guesty_listings
  add column if not exists checkin_time text
  check (checkin_time is null or checkin_time ~ '^[0-2][0-9]:[0-5][0-9]$');

comment on column public.guesty_listings.checkin_time is
  'Guesty''s guest-facing arrival time for the listing (defaultCheckInTime, HH:MM), written by /api/sync-guesty each run. The guest app reads it when the home has no Helm rate plan. Never the cleaner deadline (properties.default_checkin_time).';
