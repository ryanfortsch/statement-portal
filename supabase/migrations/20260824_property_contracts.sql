-- Property contracts: the per-property management-agreement registry. One row
-- per signed contract (renewals are new rows; the old row flips to
-- 'superseded'), so the fleet's terms — fee, term dates, renewal mechanics,
-- notice windows, negotiated clauses — are queryable instead of living only
-- inside PDFs in the Drive Contracts folder.
--
-- The Projections signing flow keeps its own contract_* columns (that's the
-- e-sign pipeline); this table is the canonical WHAT-DID-WE-AGREE-TO record
-- across the whole fleet, including the pre-Projections Docusign/paper era.
-- fee_pct here is informational: statement math stays on
-- properties.management_fee_pct, and the Contracts page flags any mismatch.
--
-- RLS-locked deny-by-default like the other owner-financial tables: fee and
-- deal terms are reachable only through the service-role client.

create table if not exists property_contracts (
  id uuid primary key default gen_random_uuid(),
  -- Loose text reference to properties.id (no FK: fleet rows churn and a
  -- contract record must outlive a deactivated property row).
  property_id text not null,
  -- The owner party exactly as written on the contract (person or LLC).
  owner_party text not null,
  -- Countersign / made-and-entered date. Null when the copy on file is
  -- undated (see notes).
  executed_on date,
  term_start date,
  -- The written end of the CURRENT term as stated in the document. For
  -- auto-renew contracts the live term end is derived in code by rolling
  -- Dec-31 terms forward — this column stays what the paper says.
  term_end date not null,
  renewal_type text not null check (renewal_type in ('auto_renew', 'mutual_agreement', 'fixed')),
  -- Non-renewal notice (days before term end), for the initial term and —
  -- when the contract steps it up after the first renewal — for later terms.
  notice_days_initial integer,
  notice_days_renewal integer,
  -- Headline commission percentage as contracted. Informational only.
  fee_pct numeric,
  -- Conditional fee mechanics (e.g. 3 Windward's 18/19% performance ladder).
  fee_notes text,
  min_availability text,
  -- Sale-of-property protection: required notice days + fixed reputation fee.
  sale_notice_days integer,
  sale_reputation_fee numeric,
  -- Negotiated / non-standard clauses, one line each.
  special_terms text[] not null default '{}',
  signed_via text not null default 'external' check (signed_via in ('helm', 'docusign', 'external')),
  status text not null default 'active' check (status in ('active', 'expired', 'superseded')),
  drive_file_id text,
  drive_url text,
  doc_title text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one live contract per property.
create unique index if not exists property_contracts_active_key
  on property_contracts (property_id) where status = 'active';
create index if not exists property_contracts_property_idx on property_contracts (property_id);

alter table property_contracts enable row level security;
-- No policies on purpose: deny-by-default, service-role only.

-- Seed: the full Drive Contracts corpus (2024/2025/2026 folders), extracted
-- from the signed PDFs on 2026-08-24. Guarded so re-running is a no-op.
insert into property_contracts
  (property_id, owner_party, executed_on, term_start, term_end, renewal_type,
   notice_days_initial, notice_days_renewal, fee_pct, fee_notes, min_availability,
   sale_notice_days, sale_reputation_fee, special_terms, signed_via, status,
   drive_file_id, drive_url, doc_title, notes)
select * from (values
  -- ── 2024 generation ──
  ('4_brier_neck', 'Jane Armstrong', date '2024-06-02', date '2024-06-02', date '2024-12-31',
   'fixed', null::integer, null::integer, 20::numeric, null, null,
   null::integer, null::numeric,
   array['Trust account for rental funds', 'Security camera + keypad install covered by initial deposit']::text[],
   'external', 'superseded',
   '1sEYQ-KIXBaHI7tsN5wiYQi1Pu3BphgRi', 'https://drive.google.com/file/d/1sEYQ-KIXBaHI7tsN5wiYQi1Pu3BphgRi/view',
   '4 Brier Neck - Rising Tide Management Contract - Jane Armstrong vff.pdf',
   'Original 7-month launch contract; replaced by the 2025 agreement.'),

  ('30_woodward', 'Stephanie McWethy', date '2024-07-21', date '2024-09-01', date '2025-12-31',
   'fixed', null, null, 25, null, null,
   null, null,
   array['Owner has online visibility into the bank account']::text[],
   'docusign', 'expired',
   '1iQsthd5635XobcYgbOekNKrFllOsCrfR', 'https://drive.google.com/file/d/1iQsthd5635XobcYgbOekNKrFllOsCrfR/view',
   '30 Woodward - Rising Tide Management Contract - Stephanie McWethy vF.pdf',
   'Fixed term ended 2025-12-31 with no renewal clause. No newer agreement on file.'),

  -- ── 2025 generation ──
  ('4_brier_neck', 'Jane Armstrong', date '2025-02-11', date '2025-02-11', date '2025-12-31',
   'auto_renew', 60, 60, 20, null,
   'Ten weeks during May-September, stays of 7+ nights; shorter or off-window requests discussed with owner',
   185, 5000,
   array['No rate discounting to drive occupancy without owner approval', 'RT covers routine maintenance and guest-damage recovery']::text[],
   'docusign', 'active',
   '15mimK6hp_pINNQvzLJxGbEi1GwXTdxyK', 'https://drive.google.com/file/d/15mimK6hp_pINNQvzLJxGbEi1GwXTdxyK/view',
   '4 Brier Neck - Rising Tide Management Contract - Jane Armstrong 2025.docx.pdf',
   'Auto-renewed for 2026 (no non-renewal notice given).'),

  ('20_enon', 'Kathleen Snyder', date '2025-01-06', date '2025-01-06', date '2025-12-31',
   'fixed', null, null, 25, null, '270 days during the term',
   185, 5000,
   array['Manager payment 30+ days late = material breach, owner may terminate immediately']::text[],
   'docusign', 'expired',
   '1JMzipcWDyDaW_rMf0LaXCWo_CezTFhCc', 'https://drive.google.com/file/d/1JMzipcWDyDaW_rMf0LaXCWo_CezTFhCc/view',
   '20 Enon - Rising Tide Management Contract - Kathleen Snyder vF.pdf',
   'Fixed term ended 2025-12-31 with no renewal clause. No newer agreement on file.'),

  ('20_hammond', 'Mark and Danielle Ramsey', date '2025-08-05', date '2025-08-05', date '2025-12-31',
   'auto_renew', 60, 60, 25, null, '270 days during the term',
   185, 5000,
   array['Owner pays one-time onboarding costs (deep clean, photography)']::text[],
   'docusign', 'active',
   '1MbIkyzGZBEWyybu0rBlMKfet5q2kmuEj', 'https://drive.google.com/file/d/1MbIkyzGZBEWyybu0rBlMKfet5q2kmuEj/view',
   '20 Hammond - Complete_with_Docusign_Rising_Tide_Managemen.pdf',
   'Auto-renewed for 2026 (no non-renewal notice given).'),

  ('21_horton', 'Claudia Kittredge', date '2025-01-28', date '2025-01-28', date '2025-12-31',
   'auto_renew', 60, 60, 22, null, '270 days during the term',
   185, 5000,
   '{}'::text[],
   'docusign', 'active',
   '12p6zpdAwO1rx5A7SnHTVEw96r-tUliHF', 'https://drive.google.com/file/d/12p6zpdAwO1rx5A7SnHTVEw96r-tUliHF/view',
   '21 Horton - Rising Tide Management Contract - Claudia Kittredge vF (1).pdf',
   'Auto-renewed for 2026 (no non-renewal notice given).'),

  -- ── 2026 generation ──
  ('3_south_st', 'Marci and Paul Bailey', null, null, date '2026-12-31',
   'mutual_agreement', null, null, 25, null, '270 days during the term',
   185, 3000,
   array['Renewal requires good-faith discussion + mutual WRITTEN agreement (no auto-renew)', 'Reduced $3,000 reputation fee in sale clause', 'RT remits occupancy/lodging taxes']::text[],
   'external', 'active',
   '1WzI_SEGnJRo7If24gytp49ipbnRtoGEi', 'https://drive.google.com/file/d/1WzI_SEGnJRo7If24gytp49ipbnRtoGEi/view',
   '3 South - Rising Tide Management Contract v2 (1).pdf',
   'Copy on file has blank commencement/signature dates - confirm a fully signed copy exists. Covers the duplex as 3B South Street.'),

  ('17_beach_rd', 'Elizabeth Nolan', date '2025-09-24', date '2025-09-24', date '2026-12-31',
   'auto_renew', 120, 120, 22, null, '270 days during the term',
   185, 5000,
   array['RT remits occupancy/lodging taxes']::text[],
   'external', 'active',
   '1LDkLx_oOl6ceZepcv_3YHe8qKyvi8NbC', 'https://drive.google.com/file/d/1LDkLx_oOl6ceZepcv_3YHe8qKyvi8NbC/view',
   '17 Beach - Rising Tide Management Contract - Nolan.pdf', null),

  ('79_main', 'Carol Ann Vorias', date '2026-04-12', date '2026-04-11', date '2026-12-31',
   'auto_renew', 120, 120, 25, null, '270 days during the term',
   185, 5000,
   '{}'::text[],
   'docusign', 'active',
   '1NvLPEOheP_J-Vu30sq8W84UdvZfs4YRC', 'https://drive.google.com/file/d/1NvLPEOheP_J-Vu30sq8W84UdvZfs4YRC/view',
   '79 Main Rising_Tide_Management_Contract_-_79_Main.pdf', null),

  ('3_windward', 'Matt Moynahan', date '2026-07-13', date '2026-07-01', date '2027-12-31',
   'auto_renew', 90, 90, 18,
   '19% in a renewal year only if prior-year Owner Net Rental Income (gross less mgmt fee and cleaning) reached $220,000; re-tested annually, else stays 18%',
   '270 days during the term',
   90, 5000,
   array['18-month initial term (Jul 2026 - Dec 2027)', 'Sale notice is 90 days (not the standard 185)', 'Mutual indemnification (RT indemnifies owner for management activities)', 'Gross income spans ALL channels including direct bookings']::text[],
   'helm', 'active',
   '1pGSNZS0WrLXa5r299_LdYnFWJPmSsvVx', 'https://drive.google.com/file/d/1pGSNZS0WrLXa5r299_LdYnFWJPmSsvVx/view',
   '3 Windward Pt - Matt Moynahan, Laila Rocha - Executed 2026-07-13.pdf', null),

  ('53_rocky_neck_2', 'Simon Prudenzi, Smith Cove LLC', date '2026-07-07', date '2026-06-17', date '2027-12-31',
   'auto_renew', 120, 120, 25, null, '270 days during the term',
   185, 5000,
   array['18-month initial term (Jun 2026 - Dec 2027)', 'Gross income spans ALL channels including direct bookings']::text[],
   'helm', 'active',
   '1bVFquz9lhc6Y0DENvb5zUJ9zkDMINH_-', 'https://drive.google.com/file/d/1bVFquz9lhc6Y0DENvb5zUJ9zkDMINH_-/view',
   '53 Rocky Neck, Downstairs - Simon Prudenzi, Smith Cove LLC - Executed 2026-07-07.pdf',
   'Covers the Downstairs unit only; the main 53 Rocky Neck house has no contract on file.'),

  ('4_middle', 'Alex Rosenstein', date '2026-06-29', date '2026-07-01', date '2027-12-31',
   'auto_renew', 120, 120, 25, null, '270 days during the term',
   185, 5000,
   array['18-month initial term (Jul 2026 - Dec 2027)', 'Gross income spans ALL channels including direct bookings']::text[],
   'helm', 'active',
   '1rFRSNaGrcTaFC3NItlXiD4rbnMJx5NSz', 'https://drive.google.com/file/d/1rFRSNaGrcTaFC3NItlXiD4rbnMJx5NSz/view',
   '4 Middle Road - Alex Rosenstein, Laura Rosenstein - Executed 2026-06-29.pdf', null),

  ('19_rackliffe', 'Josh Silverman', date '2026-06-07', date '2026-06-07', date '2026-12-31',
   'auto_renew', 120, 120, 25, null, '270 days during the term',
   185, 5000,
   array['Gross income spans ALL channels including direct bookings']::text[],
   'helm', 'active',
   '19k4mvZ9B7_dRq99Axx54Y7WZ4IiHytg5', 'https://drive.google.com/file/d/19k4mvZ9B7_dRq99Axx54Y7WZ4IiHytg5/view',
   '19 Rackliffe St - Josh Silverman, Maretta Silverman - Executed 2026-06-07.pdf',
   'Commencement date blank on the document; term start recorded as the countersign date.'),

  ('16_waterman', 'Lisa Gruber, Dali Holdings, LLC', date '2026-05-22', date '2026-05-21', date '2026-12-31',
   'auto_renew', 60, 120, 25, null,
   'Available Jun 1 - Nov 1 each year; Gloucester STR ordinance caps rented days at 120/yr and RT manages the calendar to that cap',
   185, 5000,
   array['Notice steps up: 60 days for CY2026, 120 days thereafter', 'Owner Net Rental Income defined; cleaning operates as a pass-through (guest fee in, turnover charge out)']::text[],
   'helm', 'active',
   '13HRM-JSi_xP46Zb-joFETBN7WlduZPBl', 'https://drive.google.com/file/d/13HRM-JSi_xP46Zb-joFETBN7WlduZPBl/view',
   '16 Waterman Rd - Lisa Gruber, Dali Holdings, LLC - Executed 2026-05-22.pdf', null),

  ('36_granite', 'John Gavin, 14 Brimball Ave, LLC', date '2026-05-19', date '2026-05-19', date '2026-12-31',
   'auto_renew', 60, 90, 25, null, '270 days during the term',
   185, 5000,
   array['Notice steps up: 60 days for CY2026, 90 days thereafter', 'ACH disbursement by the 15th for prior-month receipts', 'Itemized monthly statement spec (per-booking gross, fees, commission, expenses, net)', 'Prior WRITTEN owner approval before any extraordinary fee or large repair (24h notify carve-out for emergencies)', 'RT liable for damage from its own/vendor negligence (incl. cleaners)', 'RT must carry CGL $1M/$2M; reciprocal additional-interest on both policies', 'Owner-initiated cancellation: 50% of gross per cancelled confirmed booking + $5,000 liquidated damages, casualty/force-majeure carve-outs']::text[],
   'helm', 'active',
   '1BXUByR1VKnn4xMI6SXmxi0VrO2eAFq8P', 'https://drive.google.com/file/d/1BXUByR1VKnn4xMI6SXmxi0VrO2eAFq8P/view',
   '36 Granite St - John Gavin, 14 Brimball Ave, LLC - Executed 2026-05-19.pdf',
   'Most heavily negotiated contract in the fleet - honor the approval + disbursement mechanics.'),

  ('84_thatcher', 'Julie Lopes', date '2026-05-18', date '2026-05-15', date '2026-12-31',
   'auto_renew', 60, 120, 25, null, '270 days during the term',
   185, 5000,
   array['Notice steps up: 60 days for CY2026, 120 days thereafter']::text[],
   'helm', 'active',
   '1LDAIvfQuP2gIZ8-b3xn-PI0XD2JizL2y', 'https://drive.google.com/file/d/1LDAIvfQuP2gIZ8-b3xn-PI0XD2JizL2y/view',
   '84 Thatcher Road - Julie Lopes - Executed 2026-05-18.pdf', null)
) as seed(property_id, owner_party, executed_on, term_start, term_end, renewal_type,
          notice_days_initial, notice_days_renewal, fee_pct, fee_notes, min_availability,
          sale_notice_days, sale_reputation_fee, special_terms, signed_via, status,
          drive_file_id, drive_url, doc_title, notes)
where not exists (select 1 from property_contracts);
