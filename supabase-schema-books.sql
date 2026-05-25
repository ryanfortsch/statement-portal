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
-- Idempotent: safe to re-run. Seeds entities + property links + a starter
-- chart of accounts; the real QuickBooks Chart of Accounts import refines
-- the COA later.

-- ── Entities ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS llc_entities (
  id          TEXT PRIMARY KEY,          -- 'rising_tide', 'goose_astoria', 'goose_calderwood'
  name        TEXT NOT NULL,
  short       TEXT NOT NULL,
  kind        TEXT NOT NULL,             -- 'management' | 'holding'
  ein         TEXT,
  notes       TEXT,
  sort        INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Bank / credit-card accounts per entity ────────────────────────────
CREATE TABLE IF NOT EXISTS llc_accounts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    TEXT NOT NULL REFERENCES llc_entities(id),
  kind         TEXT NOT NULL,            -- 'bank' | 'credit_card'
  institution  TEXT,                     -- 'Chase'
  last4        TEXT,
  label        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_llc_accounts_entity ON llc_accounts(entity_id);

-- ── Which properties an entity owns (holding entities) ────────────────
CREATE TABLE IF NOT EXISTS llc_property_links (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id      TEXT NOT NULL REFERENCES llc_entities(id),
  property_id    TEXT NOT NULL,
  property_label TEXT,
  UNIQUE (entity_id, property_id)
);

-- ── Chart of accounts ─────────────────────────────────────────────────
-- entity_id NULL = shared default that applies to every entity. The QB
-- import can add entity-specific accounts later.
CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   TEXT REFERENCES llc_entities(id),
  key         TEXT NOT NULL,             -- stable slug used by the categorizer
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,             -- 'income' | 'expense' | 'cogs' | 'equity' | 'other'
  tax_hint    TEXT,
  sort        INT NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_id, key)
);

-- ── Ledger: one row per transaction ───────────────────────────────────
CREATE TABLE IF NOT EXISTS ledger_transactions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id      TEXT NOT NULL REFERENCES llc_entities(id),
  account_id     UUID REFERENCES llc_accounts(id),
  txn_date       DATE NOT NULL,
  description    TEXT NOT NULL,
  amount         NUMERIC NOT NULL,       -- signed: + money in, - money out
  category_key   TEXT,                   -- confirmed COA key (null until reviewed)
  ai_category_key TEXT,                  -- the categorizer's proposal
  ai_confidence  TEXT,                   -- 'high' | 'medium' | 'low'
  reviewed       BOOLEAN NOT NULL DEFAULT FALSE,
  source         TEXT,                   -- 'chase_bank_csv' | 'chase_cc_csv' | 'quickbooks_import'
  raw            JSONB,
  dedupe_hash    TEXT UNIQUE,            -- entity+date+amount+description hash; blocks double-import
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ledger_entity_date ON ledger_transactions(entity_id, txn_date);
CREATE INDEX IF NOT EXISTS idx_ledger_reviewed ON ledger_transactions(entity_id, reviewed);

-- ── Seed entities ─────────────────────────────────────────────────────
INSERT INTO llc_entities (id, name, short, kind, sort) VALUES
  ('rising_tide',      'Rising Tide STR LLC',   'Rising Tide',       'management', 0),
  ('goose_astoria',    'Goose of Astoria LLC',  'Goose of Astoria',  'holding',    1),
  ('goose_calderwood', 'Goose of Calderwood LLC','Goose of Calderwood','holding',  2)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, short = EXCLUDED.short, kind = EXCLUDED.kind, sort = EXCLUDED.sort;

-- ── Seed property ownership (confirmed by Dotti 2026-05-15) ───────────
INSERT INTO llc_property_links (entity_id, property_id, property_label) VALUES
  ('goose_astoria',    '3246_ne_27th', '3246 NE 27th Terrace, Lighthouse Point FL'),
  ('goose_astoria',    '3_locust',     '3 Locust Lane, Gloucester MA'),
  ('goose_calderwood', '65_calderwood','65 Calderwood Lane, Fairfield CT')
ON CONFLICT (entity_id, property_id) DO UPDATE SET property_label = EXCLUDED.property_label;

-- ── Seed starter chart of accounts (shared default; entity_id NULL) ──
INSERT INTO chart_of_accounts (entity_id, key, name, type, tax_hint, sort) VALUES
  (NULL, 'rental_income',          'Rental Income',              'income',  'Schedule E line 3', 10),
  (NULL, 'management_fee_income',  'Management Fee Income',      'income',  NULL, 20),
  (NULL, 'other_income',           'Other Income',               'income',  NULL, 30),
  (NULL, 'advertising',            'Advertising & Social Media', 'expense', 'Schedule E line 1', 100),
  (NULL, 'bank_merchant_fees',     'Bank & Merchant Fees',       'expense', 'Stripe / Guesty / card processing', 110),
  (NULL, 'cleaning_turnover',      'Cleaning & Turnover',        'expense', 'Schedule E line 7', 120),
  (NULL, 'insurance_business',     'Insurance — Business',       'expense', 'Schedule E line 9', 130),
  (NULL, 'insurance_property',     'Insurance — Property',       'expense', 'Schedule E line 9', 140),
  (NULL, 'legal_professional',     'Legal & Professional',       'expense', 'Schedule E line 10', 150),
  (NULL, 'software_subscriptions', 'Software & Subscriptions',   'expense', 'Guesty, SaaS', 160),
  (NULL, 'repairs_maintenance',    'Repairs & Maintenance',      'expense', 'Schedule E line 14', 170),
  (NULL, 'supplies',               'Supplies',                   'expense', 'Schedule E line 15', 180),
  (NULL, 'utilities',              'Utilities',                  'expense', 'Schedule E line 17', 190),
  (NULL, 'property_tax',           'Property Tax',               'expense', 'Schedule E line 16', 200),
  (NULL, 'mortgage_interest',      'Mortgage Interest',          'expense', 'Schedule E line 12', 210),
  (NULL, 'travel_auto',            'Travel & Auto',              'expense', 'Schedule E line 6', 220),
  (NULL, 'meals',                  'Meals & Entertainment',      'expense', NULL, 230),
  (NULL, 'management_fees_paid',   'Management Fees Paid',       'expense', 'Schedule E line 11 (Goose -> Rising Tide)', 240),
  (NULL, 'uncategorized',          'Uncategorized',              'expense', 'Needs review', 900),
  (NULL, 'owner_contribution',     'Owner Contribution',         'equity',  NULL, 1000),
  (NULL, 'owner_draw',             'Owner Draw / Distribution',  'equity',  NULL, 1010),
  (NULL, 'transfer',               'Internal Transfer',          'other',   'Between own accounts — excluded from P&L', 1020)
ON CONFLICT (entity_id, key) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, tax_hint = EXCLUDED.tax_hint, sort = EXCLUDED.sort;
