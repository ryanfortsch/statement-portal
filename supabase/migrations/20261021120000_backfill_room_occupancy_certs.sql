-- ============================================================================
-- Massachusetts Room Occupancy certificates onto every home that lacked one
-- (Dotti, 2026-10-21). Source: each Guesty listing's license number
-- (license.licenseNumber), read 2026-10-21; the 15 homes Helm already had all
-- matched Guesty. Fill-empty only: a home with a certificate is never touched.
--
--   3_locust        C0368941070
--   3_windward      C0596481070
--   4_middle        C0600752520  (and its two units, the same house)
--   7_sumac         C0605041070
--   79_main         C0589642520
--   225_washington  C0526381070  was filed as str_registration_id, which is
--                   the town's STR permit; Guesty and the C0 format say it is
--                   the state certificate, so it moves to tax_cert_id.
-- ============================================================================

begin;
update public.properties p
   set tax_cert_id = v.cert
  from (values
    ('3_locust',       'C0368941070'),
    ('3_windward',     'C0596481070'),
    ('4_middle',       'C0600752520'),
    ('4_middle_main',  'C0600752520'),
    ('4_middle_unit',  'C0600752520'),
    ('7_sumac',        'C0605041070'),
    ('79_main',        'C0589642520'),
    ('225_washington', 'C0526381070')
  ) as v(id, cert)
 where p.id = v.id and p.tax_cert_id is null;

update public.properties
   set str_registration_id = null
 where id = '225_washington' and str_registration_id = 'C0526381070' and tax_cert_id = 'C0526381070';
commit;
