-- ============================================================================
-- 65 Calderwood: the registry row and the Helm-native seed rows.
--
-- One-shot data, no DDL. Apply only AFTER 20260926200000_helm_pms_plumbing
-- is live and the step-1 code (src/lib/property-scope.ts) is deployed, so
-- region = 'bridgeport_ct' keeps this home out of every Cape Ann surface
-- (turnovers, cleaner digest, Field, inspections, A-1 schedule) from the
-- first second the row exists. Every insert is ON CONFLICT DO NOTHING, so a
-- re-run never clobbers what the operator has since edited.
--
-- Address note. Guesty has the listing at Calderwood Court 65, Bridgeport CT
-- 06605-3421 (lat 41.1533573, lng -73.2219381), and that is what the registry
-- carries: the guest-facing, tax-filing address is Bridgeport. src/lib/books.ts
-- still labels the LLC '65 Calderwood Lane, Fairfield CT' and is deliberately
-- left alone here: Black Rock is a Bridgeport neighborhood on the Fairfield
-- town line, so the two spellings describe the same house and the books label
-- is the bookkeeping entity's mailing description, not the property address.
--
-- The scope column is `region` (public.regions), never `market`:
-- properties.market already means the AirDNA comp market.
--
-- Content, rooms, photos and the 395 seeded rate days are written by
-- scripts/seed_calderwood.mts from the Guesty export, not by SQL, because
-- photos have to be copied to Vercel Blob first.
-- ============================================================================

-- ── The registry row ──────────────────────────────────────────────────────
-- Rising Tide owns this home outright (Goose of Calderwood LLC), so, like
-- 3 Locust, is_rising_tide_owned = true, management_fee_pct = 0 and no owner
-- statement is ever produced. calendar_authority stays 'guesty' until the
-- operator flips it on /channels (flip_calendar_authority): Guesty runs the
-- calendar in shadow mode while Helm fills its own tables.
insert into public.properties (
  id, name, nickname, title, address, city, type_of_unit, latitude, longitude, timezone,
  is_active, is_rising_tide_owned, kind, region, calendar_authority, guesty_listing_id, activated_at,
  owner_last, owner_full, owner_greeting, owner_emails, owners, management_fee_pct, bank_last4, tax_cert_id,
  listing_match, invoice_match, bedrooms, bathrooms, square_feet,
  default_checkout_time, default_checkin_time, trash_day, has_pack_n_play, has_high_chair, source
) values (
  '65_calderwood', '65 Calderwood', 'Black Rock Harbor', 'Stay at Black Rock Harbor',
  '65 Calderwood Court', 'Bridgeport, CT', 'House', 41.1533573, -73.2219381, 'America/New_York',
  true, true, 'managed', 'bridgeport_ct', 'guesty', '66797ba7f51d72001388bc29', now(),
  'Goose of Calderwood LLC', 'Goose of Calderwood LLC', 'Ryan', '{}', '[]'::jsonb, 0, '8203', null,
  '65 calderwood', '{}', 3, 2, 1300,
  '11:00', '15:00', 'Friday', true, true, 'guesty_seed_2026-09-25'
) on conflict (id) do nothing;

-- ── Access row: EMPTY on purpose ──────────────────────────────────────────
-- Door codes, gate codes and wifi are entered by the operator on the property
-- page. Nothing from the Guesty export (which carries a lockCode) is seeded,
-- here or in the script.
insert into public.property_access (property_id)
values ('65_calderwood')
on conflict (property_id) do nothing;

-- ── Rate plan ─────────────────────────────────────────────────────────────
-- From the Guesty listing on 2026-09-25: base 350, weekend 350 (Fri/Sat),
-- 4 guests included, 35/extra guest/night, 300 cleaning, 200 security deposit,
-- weekly and monthly factors 1.0 (0% discount), min 3 / max 91 nights,
-- 24h advance notice, 365-day window, no turnover buffer, guest check-in
-- 16:00 (properties.default_checkin_time 15:00 is the CLEANER guidance),
-- checkout 11:00, sleeps 6. direct_markup_pct is 0 explicitly: the +6% Markup
-- line on Airbnb folios is Guesty's channel markup, not a direct price, and a
-- Helm direct quote must not silently add it.
insert into public.property_rate_plans (
  property_id, currency, base_nightly_cents, weekend_nightly_cents, weekend_days,
  guests_included, extra_guest_cents_per_night, cleaning_fee_cents, security_deposit_cents,
  weekly_discount_pct, monthly_discount_pct, direct_markup_pct,
  min_nights_default, max_nights, advance_notice_hours, booking_window_days, turnover_buffer_days,
  checkin_time, checkout_time, max_occupancy, pets_allowed, quiet_hours, cancellation_policy_key, cancellation_terms, updated_by
) values (
  '65_calderwood', 'USD', 35000, 35000, '{5,6}',
  4, 3500, 30000, 20000,
  0, 0, 0,
  3, 91, 24, 365, 0,
  '16:00', '11:00', 6, false, '23:00-07:00', 'custom',
  'Cancellations made more than 30 days before check-in are eligible for a 50% refund. Cancellations made within 30 days of the check-in date are non-refundable. No-shows are not eligible for any refund.',
  'seed:guesty-2026-09-25'
) on conflict (property_id) do nothing;

-- ── Tax config (CT) ───────────────────────────────────────────────────────
-- Quote-side jurisdiction only. src/lib/occupancy-tax.ts stays the MA
-- statement authority and is not touched. Guesty: STATE_TAX 15% PER_STAY on
-- AF + CF, LOS conditional override at 30 nights, airbnb2 DO_NOT_SYNC.
insert into public.property_tax_config (
  property_id, jurisdiction, state_rate, local_rate, cif_rate, applies_to, long_stay_exempt_over_nights, collected_by_channels, notes, updated_by
) values (
  '65_calderwood', 'CT', 0.1500, 0, 0, '{accommodation,cleaning}', 30, '{airbnb}',
  'CT room occupancy tax 15% on accommodation + cleaning; Guesty STATE_TAX with LOS override at 30 nights, DO_NOT_SYNC to Airbnb (Airbnb collects and remits). Confirm with the accountant before the first direct sale.',
  'seed:guesty-2026-09-25'
) on conflict (property_id) do nothing;

-- ── Channel rows ──────────────────────────────────────────────────────────
-- Four channels, NO feed URLs: ical_import_url is pasted by the operator on
-- /channels/listings (runbook step 3) and ical_import_enabled stays false
-- until then. No channel = 'guesty' aggregate row is created for this home:
-- its direct OTA feeds are the only source, so a direct-feed block is a real
-- OTA-side hold and never a Guesty echo. Google Vacation Rentals is skipped
-- (nothing to import). Booking.com is a hotel + room pair: hotel 11763446,
-- room 1176344601 in external_room_id.
insert into public.channel_listings (
  property_id, channel, external_listing_id, external_listing_url, external_room_id,
  display_name, ical_import_url, ical_import_enabled, is_active, rates_managed_by
) values
  ('65_calderwood', 'airbnb',      '895455360892927934', 'https://www.airbnb.com/rooms/895455360892927934', null, 'Stay at Black Rock Harbor', null, false, true, 'pricelabs'),
  ('65_calderwood', 'vrbo',        '3434670', 'https://www.vrbo.com/3434670', null, 'Stay at Black Rock Harbor', null, false, true, 'pricelabs'),
  ('65_calderwood', 'booking_com', '11763446', 'https://booking.com/hotel/us/charming-beachside-home.en.html', '1176344601', 'Charming Beachside Home', null, false, true, 'ota_ui'),
  ('65_calderwood', 'direct',      null, null, null, 'Helm direct', null, false, true, 'helm')
on conflict (property_id, channel) do nothing;

notify pgrst, 'reload schema';
