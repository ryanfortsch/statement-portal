-- LLC Accounting ("Books"): the ledger tables, never created in production.
--
-- /books/<entity> was built in May-June 2026 (phases 1a-1b: Chase CSV
-- upload, AI categorizer, review) against supabase-schema-books.sql, a
-- root-level file that was never run, so every ledger page has said "Setup
-- pending" since. The CPA needs a 2026 P&L for each LLC (2026-10-19), and
-- /books/<entity>/pnl builds it from these tables.
--
-- This is that file as a migration, with three changes:
--   - Sales Tax Payable, Customer Prepayments and Heat Loan are type
--     'liability' (the root file had them as other_expense, which would
--     put a sales-tax remittance or a loan payment on the P&L).
--   - The chart is upserted, not deleted and re-inserted.
--   - RLS on, service role only, like every new table (the anon key is
--     public). Every reader and writer is a server route or server page
--     using the service-role key.
--
-- The seed rows are generated from src/lib/books.ts (LLC_ENTITIES,
-- LLC_ACCOUNTS, CHART_OF_ACCOUNTS), which stays the authority the app
-- reads; books-ledger-migration.test.ts fails if the two drift.
--
-- Additive: five new tables and their seed. Nothing existing is touched.

create table if not exists public.llc_entities (
  id          text primary key,
  name        text not null,
  short       text not null,
  kind        text not null check (kind in ('management', 'holding')),
  ein         text,
  notes       text,
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);

-- One row per bank or card account an entity uploads from.
create table if not exists public.llc_accounts (
  id           uuid primary key default gen_random_uuid(),
  entity_id    text not null references public.llc_entities(id),
  kind         text not null check (kind in ('bank', 'credit_card')),
  institution  text,
  last4        text,
  label        text,
  -- A Rising Tide per-property trust account's home.
  property_id  text,
  -- Hidden from the upload picker, never deleted (its rows stay).
  inactive     boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists idx_llc_accounts_entity on public.llc_accounts(entity_id);
create unique index if not exists uniq_llc_accounts_last4
  on public.llc_accounts(entity_id, kind, last4) where last4 is not null;

-- Which homes an entity owns (labels only; some are not Helm properties).
create table if not exists public.llc_property_links (
  id             uuid primary key default gen_random_uuid(),
  entity_id      text not null references public.llc_entities(id),
  property_id    text not null,
  property_label text,
  unique (entity_id, property_id)
);

-- The chart of accounts. entity_id null = shared by all three entities.
-- parent_key names another row's key. Ledger rows reference a category by
-- key, not by this table's id.
create table if not exists public.chart_of_accounts (
  id            uuid primary key default gen_random_uuid(),
  entity_id     text references public.llc_entities(id),
  key           text not null,
  parent_key    text,
  name          text not null,
  type          text not null check (type in ('income', 'cogs', 'expense', 'other_income', 'other_expense', 'equity', 'liability')),
  tax_hint      text,
  -- Owner trust money on Rising Tide's books: shown, never in net income.
  pass_through  boolean not null default false,
  sort          int not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
-- A plain unique on (entity_id, key) treats every null entity_id as
-- distinct, so shared keys go through coalesce.
create unique index if not exists uniq_chart_of_accounts_scope_key
  on public.chart_of_accounts ((coalesce(entity_id, '')), key);

-- The ledger: one row per bank or card transaction.
create table if not exists public.ledger_transactions (
  id              uuid primary key default gen_random_uuid(),
  entity_id       text not null references public.llc_entities(id),
  account_id      uuid references public.llc_accounts(id),
  txn_date        date not null,
  description     text not null,
  -- Signed dollars: positive is money in, negative is money out.
  amount          numeric(14,2) not null,
  -- The operator's confirmed category. Wins over the AI's proposal.
  category_key    text,
  ai_category_key text,
  ai_confidence   text check (ai_confidence in ('high', 'medium', 'low')),
  ai_reasoning    text,
  reviewed        boolean not null default false,
  reviewed_at     timestamptz,
  -- 'chase_bank_csv' | 'chase_cc_csv'
  source          text,
  -- Posting date, Chase's own category and type, the original CSV row.
  raw             jsonb,
  -- chase-csv.ts computeDedupeHash: a re-upload inserts nothing new.
  dedupe_hash     text unique,
  created_at      timestamptz not null default now()
);
create index if not exists idx_ledger_entity_date on public.ledger_transactions(entity_id, txn_date);
create index if not exists idx_ledger_reviewed on public.ledger_transactions(entity_id, reviewed);

alter table public.llc_entities enable row level security;
alter table public.llc_accounts enable row level security;
alter table public.llc_property_links enable row level security;
alter table public.chart_of_accounts enable row level security;
alter table public.ledger_transactions enable row level security;
revoke all on public.llc_entities, public.llc_accounts, public.llc_property_links,
  public.chart_of_accounts, public.ledger_transactions from anon, authenticated;
grant all on public.llc_entities, public.llc_accounts, public.llc_property_links,
  public.chart_of_accounts, public.ledger_transactions to service_role;

comment on table public.ledger_transactions is
  'LLC Accounting ledger: one Chase bank or card transaction per row, categorized against chart_of_accounts by key. Written by /api/books/ingest, categorize and review; read by /books/<entity> and its P&L.';

-- ── Seed (generated from src/lib/books.ts) ───────────────────────────

insert into public.llc_entities (id, name, short, kind, sort) values
  ('rising_tide', 'Rising Tide STR LLC', 'Rising Tide', 'management', 0),
  ('goose_astoria', 'Goose of Astoria LLC', 'Goose of Astoria', 'holding', 1),
  ('goose_calderwood', 'Goose of Calderwood LLC', 'Goose of Calderwood', 'holding', 2)
on conflict (id) do update set
  name = excluded.name, short = excluded.short, kind = excluded.kind, sort = excluded.sort;

insert into public.llc_property_links (entity_id, property_id, property_label) values
  ('goose_astoria', '3246_ne_27th', '3246 NE 27th Terrace, Lighthouse Point FL'),
  ('goose_astoria', '3_locust', '3 Locust Lane, Gloucester MA'),
  ('goose_calderwood', '65_calderwood', '65 Calderwood Lane, Fairfield CT')
on conflict (entity_id, property_id) do update set property_label = excluded.property_label;

insert into public.llc_accounts (entity_id, kind, institution, last4, label, property_id) values
  ('rising_tide', 'bank', 'Chase', '5621', '17 Beach', '17_beach_rd'),
  ('rising_tide', 'bank', 'Chase', '5622', '3 South (Bailey)', '3_south_st'),
  ('rising_tide', 'bank', 'Chase', '9910', '53 Rocky Neck (Senecal)', '53_rocky_neck'),
  ('rising_tide', 'bank', 'Chase', '7876', '4 Brier Neck (Armstrong)', '4_brier_neck'),
  ('rising_tide', 'bank', 'Chase', '1323', '21 Horton (Kittredge)', '21_horton'),
  ('rising_tide', 'bank', 'Chase', '8221', '30 Woodward (McWethy)', '30_woodward'),
  ('rising_tide', 'bank', 'Chase', '3227', '73 Rocky Neck (Moynahan)', '73_rocky_neck'),
  ('rising_tide', 'bank', 'Chase', '9969', '20 Hammond (Ramsey)', '20_hammond'),
  ('rising_tide', 'bank', 'Chase', '1307', '20 Enon (Snyder)', '20_enon'),
  ('rising_tide', 'bank', 'Chase', '5130', 'Rising Tide Main (operating)', null),
  ('rising_tide', 'bank', 'Chase', '5623', 'Business Complete CHK', null),
  ('rising_tide', 'bank', 'Chase', '9928', 'Tax Account (MA occupancy remittance)', null),
  ('rising_tide', 'credit_card', 'Chase', '3878', 'A. OBrien Credit Card', null),
  ('goose_astoria', 'bank', 'Chase', '6966', 'Business Complete CHK', null),
  ('goose_astoria', 'credit_card', 'Chase', '4972', 'A. OBrien Credit Card', null),
  ('goose_astoria', 'credit_card', 'Chase', '0037', 'R. Fortsch Credit Card', null),
  ('goose_calderwood', 'bank', 'Chase', '8203', 'Business Complete CHK', null),
  ('goose_calderwood', 'credit_card', 'Chase', '9750', 'A. OBrien Credit Card', null)
on conflict (entity_id, kind, last4) where last4 is not null do update set
  institution = excluded.institution, label = excluded.label, property_id = excluded.property_id;

insert into public.chart_of_accounts (entity_id, key, parent_key, name, type, tax_hint, pass_through, sort) values
  ('rising_tide', 'property_management_income', null, 'Property Management Income', 'income', 'Mgmt fees earned on client portfolio', false, 10),
  ('rising_tide', 'interior_design_income', null, 'Interior Design Income', 'income', null, false, 20),
  ('rising_tide', 'refunds_to_customers', null, 'Refunds to Customers', 'income', 'Contra-income (negative)', false, 30),
  (null, 'rental_income', null, 'Rental Income', 'income', 'Schedule E line 3', false, 40),
  ('rising_tide', 'rental_income_brier_neck', 'rental_income', 'Armstrong / Brier Neck Rental Income', 'income', null, false, 41),
  ('rising_tide', 'rental_chargebacks', 'rental_income', 'Chargebacks', 'income', null, false, 42),
  ('goose_calderwood', 'str_income', null, 'STR Income', 'income', null, false, 50),
  (null, 'cleaning_fares_income', null, 'Cleaning Fares', 'income', 'Cleaning fees collected from guests', false, 60),
  ('goose_astoria', 'services_legacy', null, 'Services (legacy)', 'income', 'Pre-2025 income account; superseded by Rental Income + Cleaning Fares + per-channel fees from 2025-01 onward', false, 70),
  ('goose_astoria', 'services_undelivered_refund', null, 'Services Undelivered Refund', 'income', 'Guest refund contra', false, 71),
  (null, 'cogs', null, 'Cost of Goods Sold', 'cogs', null, false, 80),
  (null, 'cogs_supplies_materials', 'cogs', 'Supplies & Materials', 'cogs', null, false, 81),
  (null, 'advertising_marketing', null, 'Advertising & Marketing', 'expense', 'Schedule E line 1', false, 100),
  (null, 'listing_fees', 'advertising_marketing', 'Listing Fees', 'expense', null, false, 101),
  (null, 'photography', 'advertising_marketing', 'Photography', 'expense', null, false, 102),
  ('rising_tide', 'social_media', 'advertising_marketing', 'Social Media', 'expense', 'Facebook/Google Ads', false, 103),
  ('rising_tide', 'web_email_marketing', 'advertising_marketing', 'Web / Email Marketing', 'expense', null, false, 104),
  (null, 'photographer_for_listing', 'advertising_marketing', 'Photographer for Listing', 'expense', null, false, 105),
  (null, 'business_licenses', null, 'Business Licenses', 'expense', 'CT SOS, MA filings', false, 110),
  (null, 'cleaning_operating', null, 'Cleaning (Operating)', 'expense', 'Ops-side cleaning -- NOT Property Cleaning (pass-through)', false, 120),
  (null, 'contract_labor', null, 'Contract Labor', 'expense', null, false, 130),
  ('rising_tide', 'filing_fees', null, 'Filing Fees', 'expense', null, false, 140),
  (null, 'general_business', null, 'General Business Expenses', 'expense', null, false, 150),
  (null, 'bank_service_charges', 'general_business', 'Bank Fees & Service Charges', 'expense', null, false, 151),
  (null, 'memberships_subscriptions', 'general_business', 'Memberships & Subscriptions', 'expense', 'PriceLabs, Furnished Finder, etc.', false, 152),
  (null, 'host_channel_fees', null, 'Host Channel Fees', 'expense', 'Goose entities: channel commissions on rental income', false, 160),
  (null, 'host_channel_airbnb', 'host_channel_fees', 'Airbnb Fees', 'expense', null, false, 161),
  (null, 'host_channel_booking', 'host_channel_fees', 'Booking.com Fees', 'expense', null, false, 162),
  (null, 'host_channel_guesty', 'host_channel_fees', 'Guesty Fees', 'expense', null, false, 163),
  (null, 'host_channel_stripe', 'host_channel_fees', 'Stripe Fees', 'expense', null, false, 164),
  (null, 'host_channel_vrbo', 'host_channel_fees', 'VRBO Fees', 'expense', null, false, 165),
  (null, 'insurance', null, 'Insurance', 'expense', 'Schedule E line 9', false, 170),
  (null, 'insurance_business', 'insurance', 'Business Insurance', 'expense', null, false, 171),
  (null, 'insurance_property', 'insurance', 'Property Insurance', 'expense', null, false, 172),
  (null, 'insurance_liability', 'insurance', 'Liability Insurance', 'expense', null, false, 173),
  ('rising_tide', 'insurance_vehicle', 'insurance', 'Vehicle Insurance', 'expense', null, false, 174),
  (null, 'interest_paid', null, 'Interest Paid', 'expense', 'Schedule E line 12', false, 180),
  ('goose_astoria', 'mortgage_interest', 'interest_paid', 'Mortgage Interest', 'expense', null, false, 181),
  ('goose_calderwood', 'mortgage_interest_11_rockholm', 'interest_paid', 'Mortgage Interest - 11 Rockholm', 'expense', null, false, 182),
  ('goose_calderwood', 'mortgage_interest_65_calderwood', 'interest_paid', 'Mortgage Interest - 65 Calderwood', 'expense', null, false, 183),
  (null, 'business_loan_interest', 'interest_paid', 'Business Loan Interest', 'expense', null, false, 184),
  (null, 'credit_card_interest', 'interest_paid', 'Credit Card Interest', 'expense', null, false, 185),
  (null, 'legal_accounting', null, 'Legal & Accounting Services', 'expense', 'Schedule E line 10', false, 190),
  (null, 'accounting_fees', 'legal_accounting', 'Accounting Fees', 'expense', null, false, 191),
  (null, 'legal_fees', 'legal_accounting', 'Legal Fees', 'expense', null, false, 192),
  (null, 'meals', null, 'Meals', 'expense', null, false, 200),
  (null, 'meals_with_clients', 'meals', 'Meals with Clients', 'expense', null, false, 201),
  (null, 'team_meals', 'meals', 'Team Meals', 'expense', null, false, 202),
  ('rising_tide', 'merchant_account_fees', null, 'Merchant Account Fees', 'expense', 'Stripe/Guesty per-booking fees', false, 210),
  (null, 'office_expenses', null, 'Office Expenses', 'expense', null, false, 220),
  (null, 'office_supplies', 'office_expenses', 'Office Supplies', 'expense', null, false, 221),
  (null, 'shipping_postage', 'office_expenses', 'Shipping & Postage', 'expense', null, false, 222),
  (null, 'software_apps', 'office_expenses', 'Software & Apps', 'expense', 'Guesty, Notion, Vercel, etc.', false, 223),
  ('goose_calderwood', 'office_merchant_fees', 'office_expenses', 'Merchant Account Fees', 'expense', null, false, 224),
  ('goose_calderwood', 'parking_tolls', null, 'Parking & Tolls', 'expense', null, false, 230),
  ('rising_tide', 'payroll_expenses', null, 'Payroll Expenses', 'expense', null, false, 240),
  ('rising_tide', 'payroll_service_fee', 'payroll_expenses', 'Payroll Service Fee', 'expense', 'Gusto', false, 241),
  ('rising_tide', 'payroll_taxes', 'payroll_expenses', 'Payroll Taxes', 'expense', null, false, 242),
  ('rising_tide', 'wages', 'payroll_expenses', 'Wages', 'expense', null, false, 243),
  (null, 'repairs_maintenance', null, 'Repairs & Maintenance', 'expense', 'Schedule E line 14', false, 250),
  (null, 'supplies', null, 'Supplies', 'expense', 'Schedule E line 15', false, 260),
  (null, 'supplies_materials', 'supplies', 'Supplies & Materials', 'expense', null, false, 261),
  (null, 'taxes_paid', null, 'Taxes Paid', 'expense', 'Schedule E line 16', false, 270),
  ('rising_tide', 'ma_tax', 'taxes_paid', 'MA Tax', 'expense', null, false, 271),
  (null, 'property_taxes', 'taxes_paid', 'Property Taxes', 'expense', null, false, 272),
  (null, 'travel', null, 'Travel', 'expense', 'Schedule E line 6', false, 280),
  (null, 'travel_airfare', 'travel', 'Airfare', 'expense', null, false, 281),
  (null, 'travel_hotels', 'travel', 'Hotels', 'expense', null, false, 282),
  ('rising_tide', 'travel_vehicle_gas', 'travel', 'Vehicle Gas & Fuel', 'expense', null, false, 283),
  ('rising_tide', 'travel_vehicle_rental', 'travel', 'Vehicle Rental', 'expense', null, false, 284),
  (null, 'utilities', null, 'Utilities', 'expense', 'Schedule E line 17', false, 290),
  (null, 'utilities_electricity', 'utilities', 'Electricity', 'expense', null, false, 291),
  (null, 'utilities_heating_cooling', 'utilities', 'Heating & Cooling', 'expense', null, false, 292),
  (null, 'utilities_internet_tv', 'utilities', 'Internet & TV Services', 'expense', null, false, 293),
  (null, 'utilities_phone', 'utilities', 'Phone Service', 'expense', null, false, 294),
  (null, 'utilities_water_sewer', 'utilities', 'Water & Sewer', 'expense', null, false, 295),
  (null, 'utilities_disposal', 'utilities', 'Disposal & Waste Fees', 'expense', null, false, 296),
  ('rising_tide', 'home_office', null, 'Home Office', 'expense', null, false, 300),
  ('rising_tide', 'home_office_rent', 'home_office', 'Rent', 'expense', null, false, 301),
  ('rising_tide', 'long_term_equipment', null, 'Long-Term Office Equipment', 'expense', null, false, 310),
  ('rising_tide', 'computers_tablets', 'long_term_equipment', 'Computers & Tablets', 'expense', null, false, 311),
  ('rising_tide', 'personal_healthcare', null, 'Personal Healthcare', 'expense', null, false, 320),
  ('rising_tide', 'health_insurance_premiums', 'personal_healthcare', 'Health Insurance Premiums', 'expense', null, false, 321),
  ('rising_tide', 'property_owner_revenues', null, 'Property Owner Revenues', 'other_income', 'Flows through to owners, not Rising Tide P&L', true, 500),
  ('rising_tide', 'accommodation_fares', 'property_owner_revenues', 'Accommodation Fares', 'other_income', null, true, 501),
  ('rising_tide', 'pt_host_channel_fees', 'property_owner_revenues', 'Host Channel Fees', 'other_income', null, true, 502),
  ('rising_tide', 'additional_guest_fees', 'property_owner_revenues', 'Additional Guest Fees', 'other_income', null, true, 503),
  ('rising_tide', 'cleaning_fares_pt', 'property_owner_revenues', 'Cleaning Fares', 'other_income', null, true, 504),
  ('rising_tide', 'property_owner_expenses', null, 'Property Owner Expenses', 'other_expense', null, true, 510),
  ('rising_tide', 'property_cleaning', 'property_owner_expenses', 'Property Cleaning', 'other_expense', 'Cape Ann Elite, biggest 1099 candidate', true, 511),
  ('rising_tide', 'property_landscaping', 'property_owner_expenses', 'Property Landscaping', 'other_expense', null, true, 512),
  ('rising_tide', 'property_photography', 'property_owner_expenses', 'Property Photography', 'other_expense', null, true, 513),
  ('rising_tide', 'property_repair_maintenance', 'property_owner_expenses', 'Property Repair & Maintenance', 'other_expense', null, true, 514),
  ('rising_tide', 'str_management_fees', 'property_owner_expenses', 'STR Management Fees', 'other_expense', 'Mirrors Property Management Income', true, 515),
  ('rising_tide', 'property_owner_payouts', null, 'Property Owner Payouts', 'other_expense', null, true, 520),
  (null, 'credit_card_rewards', null, 'Credit Card Rewards', 'other_income', null, false, 600),
  (null, 'vehicle_expenses', null, 'Vehicle Expenses', 'other_expense', null, false, 700),
  (null, 'vehicle_gas_fuel', 'vehicle_expenses', 'Vehicle Gas & Fuel', 'other_expense', null, false, 701),
  (null, 'vehicle_wash', 'vehicle_expenses', 'Vehicle Wash & Road Services', 'other_expense', null, false, 702),
  (null, 'vehicle_registration', 'vehicle_expenses', 'Vehicle Registration', 'other_expense', null, false, 703),
  (null, 'parking_tolls_oe', 'vehicle_expenses', 'Parking & Tolls', 'other_expense', null, false, 704),
  (null, 'depreciation', null, 'Depreciation', 'other_expense', null, false, 710),
  (null, 'amortization', null, 'Amortization', 'other_expense', null, false, 711),
  (null, 'owner_contribution', null, 'Owner / Partner Contributions', 'equity', null, false, 800),
  (null, 'owner_draw', null, 'Owner / Partner Distributions', 'equity', null, false, 810),
  (null, 'opening_balance_equity', null, 'Opening Balance Equity', 'equity', null, false, 820),
  (null, 'retained_earnings', null, 'Retained Earnings', 'equity', null, false, 830),
  (null, 'intercompany_due', null, 'Intercompany Due To/From', 'equity', 'Rising Tide to and from the Goose entities', false, 840),
  ('goose_astoria', 'due_from_florida_property', 'owner_draw', 'Due from Florida Property', 'equity', '3246 NE 27th Terrace allocation -- FL property activity routes here', false, 850),
  (null, 'sales_tax_payable', null, 'Sales Tax Payable', 'liability', 'MA lodging tax + CT sales tax cycle -- liability cleared monthly via DOR ACH', false, 870),
  (null, 'customer_prepayments', null, 'Customer Prepayments', 'liability', 'Guest payments received in advance of stay', false, 871),
  ('goose_calderwood', 'heat_loan', null, 'Heat Loan', 'liability', '11 Rockholm heating-system loan via Eastern Bank, paid down by Ryan personally', false, 872),
  (null, 'uncategorized', null, 'Uncategorized', 'expense', 'Needs review', false, 900),
  (null, 'reconciliation_discrepancies', null, 'Reconciliation Discrepancies', 'other_expense', 'Bookkeeper plug -- flag for review', false, 980),
  (null, 'suspense', null, 'Suspense', 'other_expense', 'Reserved -- human review only, never auto-targeted', false, 990)
on conflict ((coalesce(entity_id, '')), key) do update set
  parent_key = excluded.parent_key, name = excluded.name, type = excluded.type,
  tax_hint = excluded.tax_hint, pass_through = excluded.pass_through, sort = excluded.sort;
