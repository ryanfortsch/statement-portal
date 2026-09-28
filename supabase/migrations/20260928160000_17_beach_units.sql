-- ============================================================================
-- 17 Beach Road's two units as homes of their own, so their Airbnb bookings
-- are recorded as stays (calendars, Today, the turnover schedule).
--
--   17_beach_front  "Good Harbor Beach House", the main house (front unit)
--   17_beach_back   "Good Harbor Beach - Guest House", the attached suite
--
-- Both are Airbnb only, off Guesty (the front unit's Guesty listing was
-- deleted 2026-09-28), and Helm-run: their stays come from each unit's own
-- Airbnb export feed, pasted on the channel row by the operator (the feed
-- URLs carry private tokens and are not in this file). 17_beach_rd stays the
-- whole house on Guesty; listing_links keeps the three from selling the same
-- nights. Owner, fee and bank are 17 Beach's (the Nolans). Never on /book
-- (bookings-write-core OTA_ONLY_HOMES). Additive; one-shot data.
-- ============================================================================

insert into public.properties (
  id, name, nickname, title, address, city, type_of_unit, latitude, longitude, timezone,
  is_active, is_rising_tide_owned, kind, region, calendar_authority, guesty_listing_id, activated_at,
  owner_last, owner_full, owner_greeting, owner_emails, owners, management_fee_pct, bank_last4, tax_cert_id,
  listing_match, invoice_match, default_checkout_time, default_checkin_time, trash_day, source
)
select v.id, v.name, v.nickname, v.title, v.address, p.city, v.type_of_unit, p.latitude, p.longitude, 'America/New_York',
       true, false, 'managed', 'cape_ann', 'helm', null, now(),
       p.owner_last, p.owner_full, p.owner_greeting, p.owner_emails, p.owners, p.management_fee_pct, p.bank_last4, p.tax_cert_id,
       v.listing_match, '{}', '10:00', '15:00', p.trash_day, 'split_from_17_beach_rd_2026-09-28'
  from public.properties p
  cross join (values
    ('17_beach_front', '17 Beach Front Unit', 'Front Unit', 'Good Harbor Beach House', '17 Beach Road (Front Unit)', 'House', '17 beach front unit'),
    ('17_beach_back', '17 Beach Guest House', 'Guest House', 'Good Harbor Beach - Guest House', '17 Beach Road (Guest House)', 'Apartment', '17 beach guest house')
  ) as v(id, name, nickname, title, address, type_of_unit, listing_match)
 where p.id = '17_beach_rd'
on conflict (id) do nothing;

insert into public.property_access (property_id)
values ('17_beach_front'), ('17_beach_back')
on conflict (property_id) do nothing;

-- The Airbnb channel rows; the operator pastes each unit's export feed URL.
insert into public.channel_listings (
  property_id, channel, external_listing_id, external_listing_url, display_name,
  ical_import_url, ical_import_enabled, is_active, rates_managed_by
) values
  ('17_beach_front', 'airbnb', '1600199579054946669', 'https://www.airbnb.com/rooms/1600199579054946669', 'Good Harbor Beach House', null, false, true, 'ota_ui'),
  ('17_beach_back', 'airbnb', '1600199261450230737', 'https://www.airbnb.com/rooms/1600199261450230737', 'Good Harbor Beach - Guest House', null, false, true, 'ota_ui')
on conflict (property_id, channel) do nothing;

-- listing_links members point at their homes.
update public.listing_links set property_id = '17_beach_front' where group_key = '17_beach' and member_key = 'front';
update public.listing_links set property_id = '17_beach_back' where group_key = '17_beach' and member_key = 'back';

notify pgrst, 'reload schema';
