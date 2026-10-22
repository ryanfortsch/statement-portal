-- ============================================================================
-- 4 Middle's two units go on Zillow for winter leases (Dotti, 2026-10-22):
-- North Unit $2,600, Middle Road Unit $2,000, January 5 to April 30, 2027,
-- owner's yes given. Data only.
--
-- 1. The units' Airbnb calendars now open April too, so their lease window in
--    listing_links runs to May 1 again (it was cut to April 1 on 2026-10-21
--    while April was blocked by hand, which would have read as a lease).
-- 2. lease_listings rows so their Zillow leads are vetted and screened. Zillow
--    lists them as units of 4 Middle Rd: #1 the North Unit, #2 the Middle Road
--    Unit. The label is what a renter reads in the screening message.
-- ============================================================================

update public.listing_links
   set lease_window_end = date '2027-05-01', updated_at = now()
 where group_key = '4_middle' and role = 'unit';

insert into public.lease_listings (zillow_address, property_id, label, monthly_rent, lease_start, lease_end) values
  ('4 middle rd #1', '4_middle_main', 'the North Unit at 4 Middle Road', 2600, date '2027-01-05', date '2027-04-30'),
  ('4 middle rd #2', '4_middle_unit', 'the Middle Road Unit at 4 Middle Road', 2000, date '2027-01-05', date '2027-04-30')
on conflict (zillow_address) do nothing;
