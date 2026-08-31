-- Two Docusign-era 2025 contracts Dotti dug up on 2026-08-31, closing the
-- last two "never papered" gaps on operating homes. Both were filed into
-- Drive (Helm Records / Contracts / 2025) via /api/contracts/upload-pdf
-- before this seed, so the drive ids below are live.
--
-- 53 Rocky Neck caveat, preserved in notes: the contract writes the
-- address as "53R Rocky Neck Avenue" (Condominium) and the owner as
-- "Smith Cove Landing LLC" signed by Dennis Senecal, Manager - a
-- DIFFERENT entity/signer than the 2026 Downstairs contract ("Smith Cove
-- LLC", Simon Prudenzi). Registered to the main house (53_rocky_neck),
-- the only 53 RN unit without paper; confirm the "53R" designation with
-- Allie.

insert into property_contracts
  (property_id, owner_party, executed_on, term_start, term_end, renewal_type,
   notice_days_initial, notice_days_renewal, fee_pct, min_availability,
   sale_notice_days, sale_reputation_fee, special_terms, signed_via, status,
   drive_file_id, drive_url, doc_title, notes)
select * from (values
  ('53_rocky_neck', 'Smith Cove Landing LLC (Dennis Senecal, Manager)',
   date '2025-07-31', date '2025-06-30', date '2025-12-31', 'auto_renew',
   60, 60, 25::numeric, '270 days during the term',
   185, 5000::numeric,
   '{}'::text[],
   'docusign', 'active',
   '1qqAQHB295v-clJOi6PTU6oWn_H-fchfZ',
   'https://drive.google.com/file/d/1qqAQHB295v-clJOi6PTU6oWn_H-fchfZ/view',
   '53 Rocky Neck - Smith Cove Landing LLC - Executed 2025-07-31.pdf',
   'Auto-renewed for 2026. Contract says "53R Rocky Neck Avenue" (Condominium), owner Smith Cove Landing LLC per Dennis Senecal - different entity/signer than the 2026 Downstairs contract. Confirm the 53R designation covers the main house.'),

  ('73_rocky_neck', 'Matthew Moynahan',
   date '2025-06-05', date '2025-06-04', date '2025-12-31', 'auto_renew',
   60, 60, 25, '270 days during the term',
   185, 5000,
   '{}'::text[],
   'docusign', 'active',
   '16bFE0KunMjqFSQneN_I2dmwlezTwLsre',
   'https://drive.google.com/file/d/16bFE0KunMjqFSQneN_I2dmwlezTwLsre/view',
   '73 Rocky Neck - Matt Moynahan - Executed 2025-06-05.pdf',
   'Auto-renewed for 2026.')
) as seed(property_id, owner_party, executed_on, term_start, term_end, renewal_type,
          notice_days_initial, notice_days_renewal, fee_pct, min_availability,
          sale_notice_days, sale_reputation_fee, special_terms, signed_via, status,
          drive_file_id, drive_url, doc_title, notes)
where not exists (
  select 1 from property_contracts
  where property_id = seed.property_id and status = 'active'
);
