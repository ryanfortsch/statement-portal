-- Trades: the outside vendors Rising Tide calls when something breaks.
--
-- Helm already tracks three populations of people (SCHEMA.md "People"):
-- contacts (owners/vendors/leads), audience_contacts (guests), and
-- contractors (the 1099 Field portal roster -- our own inspectors,
-- handymen and creative crew, with portal tokens, W-9s and packets).
--
-- None of them is the plumber. When a pipe lets go at 20 Enon at 9 PM,
-- the question is "who do we call, what's their number, do they take
-- after-hours" -- and today that answer lives in Ryan's phone and in
-- bank descriptors we only see after the money has moved
-- (bank-charges.ts MAINTENANCE_VENDORS, books-vendor-hints.ts).
--
-- trade_vendors is the directory for that: a licensed-trade / service
-- vendor we hire as a company, not a person we onboard onto the portal.
-- Deliberately NOT the contractors table -- these outfits never claim a
-- packet, never get a portal token, and are ranked by trade, not by
-- reliability tier.
--
-- Axes:
--   category    what they do. Free text, validated in code against
--               TRADE_CATEGORIES (src/lib/trades.ts) so adding a trade
--               is a one-file change, not a migration. Unknown values
--               render under "Other".
--   standing    who we call first for that category: primary > backup >
--               trial > do_not_use. One ranking axis, so the list sorts
--               itself.
--   emergency   takes after-hours / same-day emergency calls. Drives the
--               "after hours" rail at the top of /fieldwork/trades.
--   archived_at visibility, kept separate from standing so retiring a
--               vendor never rewrites the ranking history.
--
--   property_ids  empty/NULL = serves the whole fleet. A non-empty array
--                 scopes them to specific homes (a plumber who only knows
--                 3 Locust's boiler).

CREATE TABLE IF NOT EXISTS public.trade_vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  name TEXT NOT NULL,                 -- the company: "128 Plumbing & Heating"
  contact_name TEXT,                  -- the person we ask for
  category TEXT NOT NULL,             -- see TRADE_CATEGORIES in src/lib/trades.ts
  standing TEXT NOT NULL DEFAULT 'backup'
    CHECK (standing IN ('primary', 'backup', 'trial', 'do_not_use')),
  emergency BOOLEAN NOT NULL DEFAULT FALSE,

  phone TEXT,
  after_hours_phone TEXT,
  email TEXT,
  website TEXT,
  service_area TEXT,                  -- "Cape Ann + North Shore"

  rate_note TEXT,                     -- "$135/hr, 2hr minimum, $250 after hours"
  account_number TEXT,                -- our account with them
  license_number TEXT,
  insured BOOLEAN,
  coi_expires_on DATE,                -- certificate of insurance expiry
  w9_on_file BOOLEAN NOT NULL DEFAULT FALSE,

  property_ids TEXT[] NOT NULL DEFAULT '{}',  -- empty = whole fleet
  notes TEXT,
  last_used_on DATE,

  archived_at TIMESTAMPTZ,
  created_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS trade_vendors_category_idx ON public.trade_vendors(category);
CREATE INDEX IF NOT EXISTS trade_vendors_active_idx ON public.trade_vendors(archived_at);
CREATE INDEX IF NOT EXISTS trade_vendors_properties_idx ON public.trade_vendors USING GIN(property_ids);

DROP TRIGGER IF EXISTS trade_vendors_updated_at ON public.trade_vendors;
CREATE TRIGGER trade_vendors_updated_at
  BEFORE UPDATE ON public.trade_vendors
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Service-role only, like every new Helm table: RLS on, no policies.
ALTER TABLE public.trade_vendors ENABLE ROW LEVEL SECURITY;

-- ── Seed ────────────────────────────────────────────────────────────
-- Everything below is a vendor Helm ALREADY knows about, lifted from the
-- two places their names are currently recorded: bank-charges.ts (the
-- descriptors that classify a charge) and books-vendor-hints.ts (the
-- 2025 general-ledger audit). Phone numbers are only filled where the
-- bank descriptor itself carried one; everything else is name + trade +
-- provenance, so the directory opens with the real roster and the office
-- fills in the numbers.
--
-- Deliberately NOT seeded: the Goose Calderwood / Goose Astoria trade
-- vendors in books-vendor-hints.ts (Tom Mackey Plumbing, Walton Electric,
-- Menard, Manuel Aca Tello, Ed Chavez Landscaping, A-Z Finish Carpentry,
-- Custom Home Improvement). Those serve 65 Calderwood and 11 Rockholm in
-- Connecticut, not the Gloucester fleet this tab is for.

INSERT INTO public.trade_vendors (name, category, standing, phone, notes, property_ids, created_by_email)
VALUES
  ('Cape Ann Elite', 'cleaning', 'primary', NULL,
   'The housekeeping vendor for the whole fleet; ACH charges classify as turnovers in bank-charges.ts. Bills through QuickBooks addressed to Allie. Note: the Jobber appointment reminders that reach the 24/7 Quo line are signed "A-1 Maintenance & Cleaning" (see vendor_appointments) -- confirm whether that is the same outfit.',
   '{}', 'seed'),
  ('Nor''East Cleaners', 'linen_laundry', 'primary', NULL,
   'Linen service. Additive cleaning-family cost, not a turnover (LINEN_VENDORS in bank-charges.ts).',
   '{}', 'seed'),
  ('Laundry Plus', 'linen_laundry', 'primary', NULL,
   'Laundry service. Additive cleaning-family cost, not a turnover (LAUNDRY_VENDORS in bank-charges.ts).',
   '{}', 'seed'),
  ('Morris Heating & Air', 'hvac', 'primary', NULL,
   'HVAC service contract for the rentals. Bank descriptor truncates to "MORRIS HEATING".',
   '{}', 'seed'),
  ('SP Properties', 'handyman', 'primary', '978-949-1399',
   'Anthony Silva, handyman. Number came off the card descriptor "IN *SP PROPERTIES 978-9491399 NH" -- verify before relying on it.',
   '{}', 'seed'),
  ('Ian Drometer', 'handyman', 'primary', NULL,
   'Handyman. Recognized maintenance vendor in bank-charges.ts (descriptor "DROMETER").',
   '{}', 'seed'),
  ('128 Plumbing & Heating', 'plumbing', 'primary', NULL,
   'Recurring plumbing/heating contractor for 3 Locust (2025 general-ledger audit).',
   '{3_locust}', 'seed'),
  ('Ultra Safe Pest Management', 'pest', 'primary', NULL,
   'Recurring pest control for 3 Locust (2025 general-ledger audit).',
   '{3_locust}', 'seed'),
  ('Bugzilla Pest Control', 'pest', 'backup', NULL,
   'Pest control seen in the 2025 general-ledger audit.',
   '{}', 'seed'),
  ('Pinebrook Landscaping', 'landscaping', 'primary', NULL,
   'Middleton, MA. Bills against Rising Tide as a property landscaping pass-through.',
   '{}', 'seed')
ON CONFLICT DO NOTHING;
