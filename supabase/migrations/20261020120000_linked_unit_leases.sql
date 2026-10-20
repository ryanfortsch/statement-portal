-- ============================================================================
-- Linked units: lease windows, and 7 Sumac and 4 Middle split like 17 Beach.
--
-- 1. listing_links.lease_window_start / _end (end exclusive): the nights a
--    unit is offered for a winter lease. Inside them a hand block of 28+
--    nights on the unit's Airbnb feed is read as a lease and closes the whole
--    house (leaseHolds in src/lib/listing-links-core.ts). Outside them a block
--    is just a block: 17 Beach's units are blocked May to October on purpose.
--    Every winter lease starts Tue Jan 5, 2027 and runs through Apr 30.
--
-- 2. 7 Sumac (Montagnino) and 4 Middle (Rosenstein): the whole house stays on
--    Guesty; each gets a main-house unit and a back unit as Helm-run,
--    Airbnb-only homes of their own (owner, fee and bank copied from the
--    house). The Airbnb listings do not exist yet: channel rows carry no
--    listing id or feed until the operator pastes them, and each unit imports
--    its Helm closures feed (/api/channels/ical/linked/<export_token>) on its
--    new Airbnb listing. Never on /book (bookings-write-core OTA_ONLY_HOMES).
--
-- Additive; one-shot data.
-- ============================================================================

alter table public.listing_links
  add column if not exists lease_window_start date,
  add column if not exists lease_window_end date;

update public.listing_links
   set lease_window_start = date '2027-01-05', lease_window_end = date '2027-05-01', updated_at = now()
 where group_key = '17_beach' and role = 'unit' and lease_window_start is null;

insert into public.properties (
  id, name, nickname, title, address, city, type_of_unit, latitude, longitude, timezone,
  is_active, is_rising_tide_owned, kind, region, calendar_authority, guesty_listing_id, activated_at,
  owner_last, owner_full, owner_greeting, owner_emails, owners, management_fee_pct, bank_last4, tax_cert_id,
  listing_match, invoice_match, default_checkout_time, default_checkin_time, trash_day, source
)
select v.id, v.name, v.nickname, null, v.address, p.city, v.type_of_unit, p.latitude, p.longitude, 'America/New_York',
       true, false, 'managed', p.region, 'helm', null, now(),
       p.owner_last, p.owner_full, p.owner_greeting, p.owner_emails, p.owners, p.management_fee_pct, p.bank_last4, p.tax_cert_id,
       v.listing_match, '{}', '10:00', '15:00', p.trash_day, v.source
  from public.properties p
  join (values
    ('7_sumac',  '7_sumac_main',  '7 Sumac Main House',   'Main House',  '7 Sumac Lane (Main House)',  'House',     '7 sumac main house',   'split_from_7_sumac_2026-10-20'),
    ('7_sumac',  '7_sumac_back',  '7 Sumac Back Unit',    'Back Unit',   '7 Sumac Lane (Back Unit)',   'Apartment', '7 sumac back unit',    'split_from_7_sumac_2026-10-20'),
    ('4_middle', '4_middle_main', '4 Middle Main House',  'Main House',  '4 Middle Road (Main House)', 'House',     '4 middle main house',  'split_from_4_middle_2026-10-20'),
    ('4_middle', '4_middle_unit', '4 Middle Second Unit', 'Second Unit', '4 Middle Road (Second Unit)','Apartment', '4 middle second unit', 'split_from_4_middle_2026-10-20')
  ) as v(parent, id, name, nickname, address, type_of_unit, listing_match, source) on v.parent = p.id
on conflict (id) do nothing;

insert into public.property_access (property_id)
values ('7_sumac_main'), ('7_sumac_back'), ('4_middle_main'), ('4_middle_unit')
on conflict (property_id) do nothing;

insert into public.channel_listings (
  property_id, channel, external_listing_id, external_listing_url, display_name,
  ical_import_url, ical_import_enabled, is_active, rates_managed_by
) values
  ('7_sumac_main',  'airbnb', null, null, '7 Sumac Main House',   null, false, true, 'ota_ui'),
  ('7_sumac_back',  'airbnb', null, null, '7 Sumac Back Unit',    null, false, true, 'ota_ui'),
  ('4_middle_main', 'airbnb', null, null, '4 Middle Main House',  null, false, true, 'ota_ui'),
  ('4_middle_unit', 'airbnb', null, null, '4 Middle Second Unit', null, false, true, 'ota_ui')
on conflict (property_id, channel) do nothing;

insert into public.listing_links (group_key, member_key, label, role, property_id, guesty_listing_id, export_token, active, lease_window_start, lease_window_end)
select g.group_key, g.member_key, g.label, g.role, g.property_id, g.guesty_listing_id,
       case when g.role = 'unit' then encode(gen_random_bytes(18), 'hex') end,
       true,
       case when g.role = 'unit' then date '2027-01-05' end,
       case when g.role = 'unit' then date '2027-05-01' end
  from (values
    ('7_sumac',  'whole', '7 Sumac (whole house)',    'whole', '7_sumac',       (select guesty_listing_id from public.properties where id = '7_sumac')),
    ('7_sumac',  'main',  '7 Sumac Main House (unit)', 'unit',  '7_sumac_main',  null),
    ('7_sumac',  'back',  '7 Sumac Back Unit (unit)',  'unit',  '7_sumac_back',  null),
    ('4_middle', 'whole', '4 Middle (whole house)',    'whole', '4_middle',      (select guesty_listing_id from public.properties where id = '4_middle')),
    ('4_middle', 'main',  '4 Middle Main House (unit)', 'unit', '4_middle_main', null),
    ('4_middle', 'unit',  '4 Middle Second Unit (unit)', 'unit', '4_middle_unit', null)
  ) as g(group_key, member_key, label, role, property_id, guesty_listing_id)
on conflict (group_key, member_key) do nothing;

notify pgrst, 'reload schema';
