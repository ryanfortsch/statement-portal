-- Twelve April 2026 stays parked on 3 Windward that never happened there.
--
-- Before #1456 the platform-CSV path inside /api/ingest walked a FLEET-WIDE
-- Guesty export and stamped the statement's own property onto every row it
-- saw. The 2026-09-01 rebuild of the 3 Windward August statement wrote these
-- twelve into guesty_reservations (source csv-fallback, listing_id null) and
-- bookings, with April dates at a home Rising Tide did not manage until
-- August. The 2026-09-02 repair moved the rows that had a statement row to
-- arbitrate them; these twelve had none, because none was ever billed.
--
-- The arbiter is the export itself. platform-csvs/2026-08/
-- 1788199746443-551621_2026-08-31_13_29_29.csv names the listing for every
-- code below, and two independent witnesses agree: property_calendar_days
-- shows 3 Locust booked 04-01..04-24, 30 Woodward unavailable 04-01..04-28 and
-- 20 Enon unavailable from 04-07 (the McWethy and Snyder rows are owner
-- stays, $0), and the reviews table already files Liu, Kretz, Murray,
-- Savage and Monaco under 65 Calderwood / 3246 NE 27th.
--
--   HMQQXZESRP  Mya Lucas        03-31..04-25  3 Locust
--   GY-Sn6ZCGKk Stephanie McWethy 04-01..04-29  30 Woodward (owner)
--   GY-hyvunrQ9 Kathleen Snyder  04-07..04-14  20 Enon (owner)
--   GY-SkHJj7s5 Kathleen Snyder  04-14..04-22  20 Enon (owner)
--   HMN5JCPBNE  Sharon Frey      04-15..04-19  53 Rocky Neck
--   HM5Z3WXTB5  Daniel Enriquez  04-03..04-05  3246 NE 27th
--   HMX88TD2EZ  Shawn Bank       04-05..04-15  3246 NE 27th
--   HMX4A8F8NF  Annmarie Monaco  04-17..04-19  3246 NE 27th
--   HMCSBMAC2P  Jeffrey Liu      04-03..04-07  65 Calderwood
--   HMKDCTNPTT  Dawn Kretz       04-10..04-12  65 Calderwood
--   HM2RZSFA9B  Ray Murray       04-16..04-20  65 Calderwood
--   HMNAKRQFHE  Sarah Savage     04-29..05-01  65 Calderwood
--
-- 65 Calderwood and 3246 NE 27th are separately owned and, per Dotti, stay
-- out of the properties registry. bookings.property_id is a foreign key to
-- properties, so those seven rows cannot be re-pointed and are deleted
-- (booking_finance cascades). guesty_reservations carries no such key and
-- keeps a row per stay pointing at the right id, as the 09-02 repair did.
--
-- Every touched row (12 bookings, 12 booking_finance, 12 guesty_reservations)
-- was snapshotted as row_to_json before this ran. The three August stays and
-- the later ones on 3 Windward are untouched, as is its statement.
--
-- Applied to production 2026-09-06 with `supabase db query --linked --file`.

begin;

update guesty_reservations g
set property_id = v.pid
from (values
  ('HMQQXZESRP', '3_locust'),
  ('GY-Sn6ZCGKk', '30_woodward'),
  ('GY-hyvunrQ9', '20_enon'),
  ('GY-SkHJj7s5', '20_enon'),
  ('HMN5JCPBNE', '53_rocky_neck'),
  ('HM5Z3WXTB5', '3246_ne_27th'),
  ('HMX88TD2EZ', '3246_ne_27th'),
  ('HMX4A8F8NF', '3246_ne_27th'),
  ('HMCSBMAC2P', '65_calderwood'),
  ('HMKDCTNPTT', '65_calderwood'),
  ('HM2RZSFA9B', '65_calderwood'),
  ('HMNAKRQFHE', '65_calderwood')
) as v(code, pid)
where g.confirmation_code = v.code
  and g.property_id is distinct from v.pid;

update bookings b
set property_id = v.pid, updated_at = now()
from (values
  ('HMQQXZESRP', '3_locust'),
  ('GY-Sn6ZCGKk', '30_woodward'),
  ('GY-hyvunrQ9', '20_enon'),
  ('GY-SkHJj7s5', '20_enon'),
  ('HMN5JCPBNE', '53_rocky_neck')
) as v(code, pid)
where b.external_confirmation_code = v.code
  and b.property_id = '3_windward';

delete from bookings b
where b.property_id = '3_windward'
  and b.external_confirmation_code in (
    'HM5Z3WXTB5', 'HMX88TD2EZ', 'HMX4A8F8NF',
    'HMCSBMAC2P', 'HMKDCTNPTT', 'HM2RZSFA9B', 'HMNAKRQFHE'
  );

do $$
declare n int;
begin
  select count(*) into n from bookings where property_id = '3_windward' and check_out < '2026-06-01';
  if n <> 0 then raise exception 'bookings: % pre-June rows still on 3_windward', n; end if;
  select count(*) into n from guesty_reservations where property_id = '3_windward' and check_out < '2026-06-01';
  if n <> 0 then raise exception 'guesty_reservations: % pre-June rows still on 3_windward', n; end if;
  select count(*) into n from bookings where property_id = '3_windward';
  if n <> 6 then raise exception 'bookings: expected the 6 real 3_windward rows to remain, found %', n; end if;
  select count(*) into n from bookings
    where external_confirmation_code in ('HMQQXZESRP', 'GY-Sn6ZCGKk', 'GY-hyvunrQ9', 'GY-SkHJj7s5', 'HMN5JCPBNE')
      and property_id in ('3_locust', '30_woodward', '20_enon', '53_rocky_neck');
  if n <> 5 then raise exception 'bookings: expected 5 re-pointed rows, found %', n; end if;
end $$;

commit;
