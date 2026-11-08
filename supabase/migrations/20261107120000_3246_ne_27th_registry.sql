-- ============================================================================
-- 3246 NE 27th Terrace: the registry row.
--
-- One-shot data, no DDL. Rising Tide owns this home outright (Goose of
-- Astoria LLC, the same holding entity as 3 Locust; see LLC_ENTITIES in
-- src/lib/books.ts), so, like 3 Locust and 65 Calderwood,
-- is_rising_tide_owned = true, management_fee_pct = 0 and no owner statement
-- is ever produced.
--
-- Why now. The Money pages (Revenue, Forecast) list every active row in
-- `properties`, and 3 Locust and 65 Calderwood both sit there as Rising Tide
-- homes with a dash for the fee. This home never had a row: its Guesty stays
-- have synced into guesty_reservations under '3246_ne_27th' all along (the
-- listing needle floor in /api/sync-guesty), but with no registry row the
-- revenue snapshot had nothing to join them to, the calendar-days feed
-- skipped the home on every run, and the bookings copy was refused by the FK.
-- Dotti asked for it on the Money page on 2026-11-07.
--
-- Scope. region = 'lighthouse_point_fl' (seeded by 20260926200000_helm_pms_
-- plumbing) keeps it out of every Cape Ann crew surface (turnover rail,
-- cleaner digest, Field packets, inspections roster, the A-1 schedule) from
-- the first second the row exists; src/lib/property-scope.ts is the gate.
-- calendar_authority stays 'guesty': Guesty runs this home and Helm mirrors.
--
-- Deliberately null:
--   guesty_listing_id   /api/sync-guesty stamps it fill-empty on the next run
--                       (single-listing homes only; this is one).
--   activated_at        null, as on every home that predates the registry, so
--                       Revenue counts its history back to the data horizon
--                       instead of clipping at today. 65 Calderwood stamped
--                       now() and so reads nothing before 2026-09-26.
--   latitude/longitude  not needed by any money surface; fill from Guesty on
--                       the property page if the map ever wants them.
--   trash_day           Florida; no Gloucester cart rule applies and civic.ts
--                       answers nothing for a non-Gloucester city.
--   default_checkout_time  fill-empty from the Guesty listing by the sync.
--   title               the guest-facing Guesty title; set on the property
--                       page rather than guessed here.
--
-- Every insert is ON CONFLICT DO NOTHING, so a re-run never clobbers what the
-- operator has since edited.
-- ============================================================================

insert into public.properties (
  id, name, nickname, title, address, city, type_of_unit, timezone,
  is_active, is_rising_tide_owned, kind, region, calendar_authority, guesty_listing_id, activated_at,
  owner_last, owner_full, owner_greeting, owner_emails, owners, management_fee_pct, bank_last4, tax_cert_id,
  listing_match, invoice_match, trash_day, source
) values (
  '3246_ne_27th', '3246 NE 27th', 'Lighthouse Point', null,
  '3246 NE 27th Terrace', 'Lighthouse Point, FL', 'House', 'America/New_York',
  true, true, 'managed', 'lighthouse_point_fl', 'guesty', null, null,
  'Goose of Astoria LLC', 'Goose of Astoria LLC', 'Ryan', '{}', '[]'::jsonb, 0, null, null,
  '3246 ne 27th', '{}', null, 'registry_2026-11-07'
) on conflict (id) do nothing;

notify pgrst, 'reload schema';
