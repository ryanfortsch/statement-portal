-- LLC Accounting ("Books") module schema.
--
-- Brings Rising Tide's bookkeeping in-house after parting with the
-- outside bookkeeper (Supporting Strategies / QuickBooks). Three entities
-- (Rising Tide STR LLC + the two Goose holding LLCs) each get a
-- categorized transaction ledger; quarterly P&L + 1099 prep build on top.
--
-- Run in the Supabase SQL editor:
--   https://supabase.com/dashboard/project/qjueexujiuticjrtqdyj/sql/new
--
-- Idempotent: safe to re-run. Seeds entities, property links, bank/card
-- accounts, and the hierarchical chart of accounts informed by the QB
-- exports Dotti pulled 2026-05-27.

-- ── Entities ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS llc_entities (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  short       TEXT NOT NULL,
  kind        TEXT NOT NULL,
  ein         TEXT,
  notes       TEXT,
  sort        INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Bank / credit-card accounts per entity ────────────────────────────
CREATE TABLE IF NOT EXISTS llc_accounts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    TEXT NOT NULL REFERENCES llc_entities(id),
  kind         TEXT NOT NULL,
  institution  TEXT,
  last4        TEXT,
  label        TEXT,
  property_id  TEXT,
  inactive     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Auxiliary columns added 2026-05-27: link a Rising Tide account to its
-- managed property (where applicable), and a soft-inactive flag for old
-- accounts that should hide from the picker but not be deleted.
ALTER TABLE llc_accounts ADD COLUMN IF NOT EXISTS property_id TEXT;
ALTER TABLE llc_accounts ADD COLUMN IF NOT EXISTS inactive BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_llc_accounts_entity ON llc_accounts(entity_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_llc_accounts_last4 ON llc_accounts(entity_id, kind, last4) WHERE last4 IS NOT NULL;

-- ── Which properties an entity owns ───────────────────────────────────
CREATE TABLE IF NOT EXISTS llc_property_links (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id      TEXT NOT NULL REFERENCES llc_entities(id),
  property_id    TEXT NOT NULL,
  property_label TEXT,
  UNIQUE (entity_id, property_id)
);

-- ── Chart of accounts ─────────────────────────────────────────────────
-- entity_id NULL = shared default. parent_key references another COA
-- row's key (within the same scope) for hierarchical accounts.
-- pass_through = auto-fills from Statements data (Phase 1c), don't ask
-- the categorizer.
CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     TEXT REFERENCES llc_entities(id),
  key           TEXT NOT NULL,
  parent_key    TEXT,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL,
  tax_hint      TEXT,
  pass_through  BOOLEAN NOT NULL DEFAULT FALSE,
  sort          INT NOT NULL DEFAULT 0,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS parent_key TEXT;
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS pass_through BOOLEAN NOT NULL DEFAULT FALSE;
-- NULL entity_id rows treat each NULL as unique under standard UNIQUE
-- constraints, which trips the seed re-run. Use an expression index that
-- coerces NULL to '' so re-seeds are clean.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_chart_of_accounts_scope_key
  ON chart_of_accounts (COALESCE(entity_id, ''), key);

-- ── Ledger: one row per transaction ───────────────────────────────────
CREATE TABLE IF NOT EXISTS ledger_transactions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id      TEXT NOT NULL REFERENCES llc_entities(id),
  account_id     UUID REFERENCES llc_accounts(id),
  txn_date       DATE NOT NULL,
  description    TEXT NOT NULL,
  amount         NUMERIC NOT NULL,
  category_key   TEXT,
  ai_category_key TEXT,
  ai_confidence  TEXT,
  reviewed       BOOLEAN NOT NULL DEFAULT FALSE,
  source         TEXT,
  raw            JSONB,
  dedupe_hash    TEXT UNIQUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ledger_entity_date ON ledger_transactions(entity_id, txn_date);
CREATE INDEX IF NOT EXISTS idx_ledger_reviewed ON ledger_transactions(entity_id, reviewed);

-- ── Seed entities ─────────────────────────────────────────────────────
INSERT INTO llc_entities (id, name, short, kind, sort) VALUES
  ('rising_tide',      'Rising Tide STR LLC',    'Rising Tide',         'management', 0),
  ('goose_astoria',    'Goose of Astoria LLC',   'Goose of Astoria',    'holding',    1),
  ('goose_calderwood', 'Goose of Calderwood LLC','Goose of Calderwood', 'holding',    2)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, short = EXCLUDED.short, kind = EXCLUDED.kind, sort = EXCLUDED.sort;

-- ── Seed property ownership (audited from QB exports 2026-05-27) ─────
-- 11 Rockholm is on Goose of Calderwood's books with its own mortgage
-- ($52.7k interest in 2025) -- pending address confirmation from Ryan.
INSERT INTO llc_property_links (entity_id, property_id, property_label) VALUES
  ('goose_astoria',    '3246_ne_27th', '3246 NE 27th Terrace, Lighthouse Point FL'),
  ('goose_astoria',    '3_locust',     '3 Locust Lane, Gloucester MA'),
  ('goose_calderwood', '65_calderwood','65 Calderwood Lane, Fairfield CT'),
  ('goose_calderwood', '11_rockholm',  '11 Rockholm (per QB books — confirm address)')
ON CONFLICT (entity_id, property_id) DO UPDATE SET property_label = EXCLUDED.property_label;

-- ── Seed bank + credit-card accounts (audited from QB exports) ───────
INSERT INTO llc_accounts (entity_id, kind, institution, last4, label, property_id) VALUES
  -- Rising Tide STR LLC: per-property Chase checking (held in trust for owners)
  ('rising_tide', 'bank', 'Chase', '5621', '17 Beach',                '17_beach_rd'),
  ('rising_tide', 'bank', 'Chase', '5622', '3 South (Bailey)',        '3_south_st'),
  ('rising_tide', 'bank', 'Chase', '9910', '53 Rocky Neck (Senecal)', '53_rocky_neck'),
  ('rising_tide', 'bank', 'Chase', '7876', '4 Brier Neck (Armstrong)','4_brier_neck'),
  ('rising_tide', 'bank', 'Chase', '1323', '21 Horton (Kittredge)',   '21_horton'),
  ('rising_tide', 'bank', 'Chase', '8221', '30 Woodward (McWethy)',   '30_woodward'),
  ('rising_tide', 'bank', 'Chase', '3227', '73 Rocky Neck (Moynahan)','73_rocky_neck'),
  ('rising_tide', 'bank', 'Chase', '9969', '20 Hammond (Ramsey)',     '20_hammond'),
  ('rising_tide', 'bank', 'Chase', '1307', '20 Enon (Snyder)',        '20_enon'),
  ('rising_tide', 'bank', 'Chase', '5130', 'Rising Tide Main (operating)', NULL),
  ('rising_tide', 'bank', 'Chase', '5623', 'Business Complete CHK',    NULL),
  ('rising_tide', 'bank', 'Chase', '9928', 'Tax Account (MA occupancy)', NULL),
  ('rising_tide', 'credit_card', 'Chase', '3878', 'A. OBrien Credit Card', NULL),
  -- Goose of Astoria LLC
  ('goose_astoria',    'bank',        'Chase', '6966', 'Business Complete CHK',  NULL),
  ('goose_astoria',    'credit_card', 'Chase', '4972', 'A. OBrien Credit Card',  NULL),
  ('goose_astoria',    'credit_card', 'Chase', '0037', 'R. Fortsch Credit Card', NULL),
  -- Goose of Calderwood LLC
  ('goose_calderwood', 'bank',        'Chase', '8203', 'Business Complete CHK',  NULL),
  ('goose_calderwood', 'credit_card', 'Chase', '9750', 'A. OBrien Credit Card',  NULL)
ON CONFLICT (entity_id, kind, last4) WHERE last4 IS NOT NULL
  DO UPDATE SET label = EXCLUDED.label, property_id = EXCLUDED.property_id, inactive = FALSE;

-- ── Seed chart of accounts (hierarchical, entity-scoped) ─────────────
-- Reset and re-insert so the seed is canonical. Ledger transactions
-- reference categories by string key, not by COA row id, so this is
-- safe even with existing data.
DELETE FROM chart_of_accounts;
INSERT INTO chart_of_accounts (entity_id, key, parent_key, name, type, tax_hint, pass_through, sort) VALUES
  -- INCOME
  ('rising_tide', 'property_management_income', NULL, 'Property Management Income', 'income', 'Mgmt fees earned on client portfolio', FALSE, 10),
  ('rising_tide', 'interior_design_income', NULL, 'Interior Design Income', 'income', NULL, FALSE, 20),
  ('rising_tide', 'refunds_to_customers', NULL, 'Refunds to Customers', 'income', 'Contra-income (negative)', FALSE, 30),
  (NULL, 'rental_income', NULL, 'Rental Income', 'income', 'Schedule E line 3', FALSE, 40),
  ('rising_tide', 'rental_income_brier_neck', 'rental_income', 'Armstrong / Brier Neck Rental Income', 'income', NULL, FALSE, 41),
  ('rising_tide', 'rental_chargebacks', 'rental_income', 'Chargebacks', 'income', NULL, FALSE, 42),
  ('goose_calderwood', 'str_income', NULL, 'STR Income', 'income', NULL, FALSE, 50),
  (NULL, 'cleaning_fares_income', NULL, 'Cleaning Fares', 'income', 'Cleaning fees collected from guests', FALSE, 60),

  -- COGS
  (NULL, 'cogs', NULL, 'Cost of Goods Sold', 'cogs', NULL, FALSE, 80),
  (NULL, 'cogs_supplies_materials', 'cogs', 'Supplies & Materials', 'cogs', NULL, FALSE, 81),

  -- OPERATING EXPENSES
  (NULL, 'advertising_marketing', NULL, 'Advertising & Marketing', 'expense', 'Schedule E line 1', FALSE, 100),
  (NULL, 'listing_fees', 'advertising_marketing', 'Listing Fees', 'expense', NULL, FALSE, 101),
  (NULL, 'photography', 'advertising_marketing', 'Photography', 'expense', NULL, FALSE, 102),
  ('rising_tide', 'social_media', 'advertising_marketing', 'Social Media', 'expense', 'Facebook/Google Ads', FALSE, 103),
  ('rising_tide', 'web_email_marketing', 'advertising_marketing', 'Web / Email Marketing', 'expense', NULL, FALSE, 104),
  (NULL, 'photographer_for_listing', 'advertising_marketing', 'Photographer for Listing', 'expense', NULL, FALSE, 105),

  (NULL, 'business_licenses', NULL, 'Business Licenses', 'expense', 'CT SOS, MA filings', FALSE, 110),
  (NULL, 'cleaning_operating', NULL, 'Cleaning (Operating)', 'expense', 'Ops-side cleaning — NOT Property Cleaning (pass-through)', FALSE, 120),
  (NULL, 'contract_labor', NULL, 'Contract Labor', 'expense', NULL, FALSE, 130),
  ('rising_tide', 'filing_fees', NULL, 'Filing Fees', 'expense', NULL, FALSE, 140),

  (NULL, 'general_business', NULL, 'General Business Expenses', 'expense', NULL, FALSE, 150),
  (NULL, 'bank_service_charges', 'general_business', 'Bank Fees & Service Charges', 'expense', NULL, FALSE, 151),
  (NULL, 'memberships_subscriptions', 'general_business', 'Memberships & Subscriptions', 'expense', 'PriceLabs, Furnished Finder, etc.', FALSE, 152),

  (NULL, 'host_channel_fees', NULL, 'Host Channel Fees', 'expense', 'Goose entities — channel commissions', FALSE, 160),
  (NULL, 'host_channel_airbnb', 'host_channel_fees', 'Airbnb Fees', 'expense', NULL, FALSE, 161),
  (NULL, 'host_channel_booking', 'host_channel_fees', 'Booking.com Fees', 'expense', NULL, FALSE, 162),
  (NULL, 'host_channel_guesty', 'host_channel_fees', 'Guesty Fees', 'expense', NULL, FALSE, 163),
  (NULL, 'host_channel_stripe', 'host_channel_fees', 'Stripe Fees', 'expense', NULL, FALSE, 164),
  (NULL, 'host_channel_vrbo', 'host_channel_fees', 'VRBO Fees', 'expense', NULL, FALSE, 165),

  (NULL, 'insurance', NULL, 'Insurance', 'expense', 'Schedule E line 9', FALSE, 170),
  (NULL, 'insurance_business', 'insurance', 'Business Insurance', 'expense', NULL, FALSE, 171),
  (NULL, 'insurance_property', 'insurance', 'Property Insurance', 'expense', NULL, FALSE, 172),
  (NULL, 'insurance_liability', 'insurance', 'Liability Insurance', 'expense', NULL, FALSE, 173),
  ('rising_tide', 'insurance_vehicle', 'insurance', 'Vehicle Insurance', 'expense', NULL, FALSE, 174),

  (NULL, 'interest_paid', NULL, 'Interest Paid', 'expense', 'Schedule E line 12', FALSE, 180),
  ('goose_astoria', 'mortgage_interest', 'interest_paid', 'Mortgage Interest', 'expense', NULL, FALSE, 181),
  ('goose_calderwood', 'mortgage_interest_11_rockholm', 'interest_paid', 'Mortgage Interest — 11 Rockholm', 'expense', NULL, FALSE, 182),
  ('goose_calderwood', 'mortgage_interest_65_calderwood', 'interest_paid', 'Mortgage Interest — 65 Calderwood', 'expense', NULL, FALSE, 183),
  (NULL, 'business_loan_interest', 'interest_paid', 'Business Loan Interest', 'expense', NULL, FALSE, 184),
  (NULL, 'credit_card_interest', 'interest_paid', 'Credit Card Interest', 'expense', NULL, FALSE, 185),

  (NULL, 'legal_accounting', NULL, 'Legal & Accounting Services', 'expense', 'Schedule E line 10', FALSE, 190),
  (NULL, 'accounting_fees', 'legal_accounting', 'Accounting Fees', 'expense', NULL, FALSE, 191),
  (NULL, 'legal_fees', 'legal_accounting', 'Legal Fees', 'expense', NULL, FALSE, 192),

  (NULL, 'meals', NULL, 'Meals', 'expense', NULL, FALSE, 200),
  (NULL, 'meals_with_clients', 'meals', 'Meals with Clients', 'expense', NULL, FALSE, 201),
  (NULL, 'team_meals', 'meals', 'Team Meals', 'expense', NULL, FALSE, 202),

  ('rising_tide', 'merchant_account_fees', NULL, 'Merchant Account Fees', 'expense', 'Stripe/Guesty per-booking fees', FALSE, 210),

  (NULL, 'office_expenses', NULL, 'Office Expenses', 'expense', NULL, FALSE, 220),
  (NULL, 'office_supplies', 'office_expenses', 'Office Supplies', 'expense', NULL, FALSE, 221),
  (NULL, 'shipping_postage', 'office_expenses', 'Shipping & Postage', 'expense', NULL, FALSE, 222),
  (NULL, 'software_apps', 'office_expenses', 'Software & Apps', 'expense', 'Guesty, Notion, Vercel, etc.', FALSE, 223),
  ('goose_calderwood', 'office_merchant_fees', 'office_expenses', 'Merchant Account Fees', 'expense', NULL, FALSE, 224),

  ('goose_calderwood', 'parking_tolls', NULL, 'Parking & Tolls', 'expense', NULL, FALSE, 230),

  ('rising_tide', 'payroll_expenses', NULL, 'Payroll Expenses', 'expense', NULL, FALSE, 240),
  ('rising_tide', 'payroll_service_fee', 'payroll_expenses', 'Payroll Service Fee', 'expense', 'Gusto', FALSE, 241),
  ('rising_tide', 'payroll_taxes', 'payroll_expenses', 'Payroll Taxes', 'expense', NULL, FALSE, 242),
  ('rising_tide', 'wages', 'payroll_expenses', 'Wages', 'expense', NULL, FALSE, 243),

  (NULL, 'repairs_maintenance', NULL, 'Repairs & Maintenance', 'expense', 'Schedule E line 14', FALSE, 250),

  (NULL, 'supplies', NULL, 'Supplies', 'expense', 'Schedule E line 15', FALSE, 260),
  (NULL, 'supplies_materials', 'supplies', 'Supplies & Materials', 'expense', NULL, FALSE, 261),

  (NULL, 'taxes_paid', NULL, 'Taxes Paid', 'expense', 'Schedule E line 16', FALSE, 270),
  ('rising_tide', 'ma_tax', 'taxes_paid', 'MA Tax', 'expense', NULL, FALSE, 271),
  (NULL, 'property_taxes', 'taxes_paid', 'Property Taxes', 'expense', NULL, FALSE, 272),

  (NULL, 'travel', NULL, 'Travel', 'expense', 'Schedule E line 6', FALSE, 280),
  (NULL, 'travel_airfare', 'travel', 'Airfare', 'expense', NULL, FALSE, 281),
  (NULL, 'travel_hotels', 'travel', 'Hotels', 'expense', NULL, FALSE, 282),
  ('rising_tide', 'travel_vehicle_gas', 'travel', 'Vehicle Gas & Fuel', 'expense', NULL, FALSE, 283),
  ('rising_tide', 'travel_vehicle_rental', 'travel', 'Vehicle Rental', 'expense', NULL, FALSE, 284),

  (NULL, 'utilities', NULL, 'Utilities', 'expense', 'Schedule E line 17', FALSE, 290),
  (NULL, 'utilities_electricity', 'utilities', 'Electricity', 'expense', NULL, FALSE, 291),
  (NULL, 'utilities_heating_cooling', 'utilities', 'Heating & Cooling', 'expense', NULL, FALSE, 292),
  (NULL, 'utilities_internet_tv', 'utilities', 'Internet & TV Services', 'expense', NULL, FALSE, 293),
  (NULL, 'utilities_phone', 'utilities', 'Phone Service', 'expense', NULL, FALSE, 294),
  (NULL, 'utilities_water_sewer', 'utilities', 'Water & Sewer', 'expense', NULL, FALSE, 295),
  (NULL, 'utilities_disposal', 'utilities', 'Disposal & Waste Fees', 'expense', NULL, FALSE, 296),

  ('rising_tide', 'home_office', NULL, 'Home Office', 'expense', NULL, FALSE, 300),
  ('rising_tide', 'home_office_rent', 'home_office', 'Rent', 'expense', NULL, FALSE, 301),

  ('rising_tide', 'long_term_equipment', NULL, 'Long-Term Office Equipment', 'expense', NULL, FALSE, 310),
  ('rising_tide', 'computers_tablets', 'long_term_equipment', 'Computers & Tablets', 'expense', NULL, FALSE, 311),

  ('rising_tide', 'personal_healthcare', NULL, 'Personal Healthcare', 'expense', NULL, FALSE, 320),
  ('rising_tide', 'health_insurance_premiums', 'personal_healthcare', 'Health Insurance Premiums', 'expense', NULL, FALSE, 321),

  (NULL, 'uncategorized', NULL, 'Uncategorized', 'expense', 'Needs review', FALSE, 900),

  -- PASS-THROUGH (Rising Tide only — auto-fills from Statements in Phase 1c)
  ('rising_tide', 'property_owner_revenues', NULL, 'Property Owner Revenues', 'other_income', 'Flows through to owners — not Rising Tide P&L', TRUE, 500),
  ('rising_tide', 'accommodation_fares', 'property_owner_revenues', 'Accommodation Fares', 'other_income', NULL, TRUE, 501),
  ('rising_tide', 'pt_host_channel_fees', 'property_owner_revenues', 'Host Channel Fees', 'other_income', NULL, TRUE, 502),
  ('rising_tide', 'additional_guest_fees', 'property_owner_revenues', 'Additional Guest Fees', 'other_income', NULL, TRUE, 503),
  ('rising_tide', 'cleaning_fares_pt', 'property_owner_revenues', 'Cleaning Fares', 'other_income', NULL, TRUE, 504),
  ('rising_tide', 'property_owner_expenses', NULL, 'Property Owner Expenses', 'other_expense', NULL, TRUE, 510),
  ('rising_tide', 'property_cleaning', 'property_owner_expenses', 'Property Cleaning', 'other_expense', 'Cape Ann Elite — biggest 1099 candidate', TRUE, 511),
  ('rising_tide', 'property_landscaping', 'property_owner_expenses', 'Property Landscaping', 'other_expense', NULL, TRUE, 512),
  ('rising_tide', 'property_photography', 'property_owner_expenses', 'Property Photography', 'other_expense', NULL, TRUE, 513),
  ('rising_tide', 'property_repair_maintenance', 'property_owner_expenses', 'Property Repair & Maintenance', 'other_expense', NULL, TRUE, 514),
  ('rising_tide', 'str_management_fees', 'property_owner_expenses', 'STR Management Fees', 'other_expense', 'Mirrors Property Management Income', TRUE, 515),
  ('rising_tide', 'property_owner_payouts', NULL, 'Property Owner Payouts', 'other_expense', NULL, TRUE, 520),

  -- OTHER INCOME
  (NULL, 'credit_card_rewards', NULL, 'Credit Card Rewards', 'other_income', NULL, FALSE, 600),

  -- OTHER EXPENSE
  (NULL, 'vehicle_expenses', NULL, 'Vehicle Expenses', 'other_expense', NULL, FALSE, 700),
  (NULL, 'vehicle_gas_fuel', 'vehicle_expenses', 'Vehicle Gas & Fuel', 'other_expense', NULL, FALSE, 701),
  (NULL, 'vehicle_wash', 'vehicle_expenses', 'Vehicle Wash & Road Services', 'other_expense', NULL, FALSE, 702),
  (NULL, 'depreciation', NULL, 'Depreciation', 'other_expense', NULL, FALSE, 710),
  (NULL, 'amortization', NULL, 'Amortization', 'other_expense', NULL, FALSE, 711),
  (NULL, 'suspense', NULL, 'Suspense', 'other_expense', 'Reserved — human review only, never auto-targeted', FALSE, 990),

  -- EQUITY
  (NULL, 'owner_contribution', NULL, 'Owner / Partner Contributions', 'equity', NULL, FALSE, 800),
  (NULL, 'owner_draw', NULL, 'Owner / Partner Distributions', 'equity', NULL, FALSE, 810),
  (NULL, 'opening_balance_equity', NULL, 'Opening Balance Equity', 'equity', NULL, FALSE, 820),
  (NULL, 'retained_earnings', NULL, 'Retained Earnings', 'equity', NULL, FALSE, 830),
  (NULL, 'intercompany_due', NULL, 'Intercompany Due To/From', 'equity', 'Rising Tide ↔ Goose entities', FALSE, 840);
