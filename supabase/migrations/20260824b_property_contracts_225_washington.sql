-- 225 Washington was signed + countersigned through the Helm pipeline on
-- 2026-06-24 (projection 766156ad-03b2-41c6-b5f1-2c5d4e86fc26) but its PDF
-- was never archived to the Drive Contracts folder, so the 20260824 corpus
-- seed missed it. Standard template, no overrides or custom clauses.
-- drive_url is stamped separately once the archive-contract backfill runs.

insert into property_contracts
  (property_id, owner_party, executed_on, term_start, term_end, renewal_type,
   notice_days_initial, notice_days_renewal, fee_pct, min_availability,
   sale_notice_days, sale_reputation_fee, special_terms, signed_via, status, notes)
select
  '225_washington', 'Matthew Babson, Mad Dog Realty, LLC', date '2026-06-24',
  date '2026-06-23', date '2027-12-31', 'auto_renew',
  120, 120, 25, '270 days during the term',
  185, 5000,
  array['18-month initial term (Jun 2026 - Dec 2027)', 'Gross income spans ALL channels including direct bookings']::text[],
  'helm', 'active',
  'Registered from the Helm signing pipeline (projection 766156ad); standard template, no redlines.'
where not exists (
  select 1 from property_contracts
  where property_id = '225_washington' and status = 'active'
);
