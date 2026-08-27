-- MassTaxConnect room occupancy certificates, from Allie 2026-08-27.
--
-- Five properties were filing (or should have been) with no certificate
-- recorded in Helm. The remittance sheet prints the cert next to the dollar
-- amount so the accountant knows what to file under, and these five printed
-- "NO CERT ON FILE" on the July sheet.
--
-- 17 Beach's value matches the one already in src/lib/properties.ts (added
-- 2026-05-29); only the DB row was missing it, and loadTaxCerts reads the DB.
--
-- 53 Rocky Neck Downstairs is given the SAME certificate as the main house.
-- That is what Allie sent, and it is plausible for two units at one street
-- address on one registration -- but it means the two properties' occupancy
-- tax is filed under one cert, so the accountant sends two amounts against
-- one certificate number. Flagged to Dotti 2026-08-27.
--
-- Still uncovered after this: 79 Main (a Community Impact Fee property at
-- 14.7% that owed $851.07 for July), 3 Locust, 225 Washington, 3 Windward,
-- 4 Middle.

update public.properties set tax_cert_id = 'C0555322520', updated_at = now() where id = '36_granite';
update public.properties set tax_cert_id = 'C0584601070', updated_at = now() where id = '16_waterman';
update public.properties set tax_cert_id = 'C0585051070', updated_at = now() where id = '17_beach_rd';
update public.properties set tax_cert_id = 'C0554181070', updated_at = now() where id = '53_rocky_neck_2';
update public.properties set tax_cert_id = 'C0510251070', updated_at = now() where id = '84_thatcher';
