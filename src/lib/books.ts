/**
 * LLC Accounting ("Books") module — entity model, real chart of accounts,
 * and bank/card account inventory.
 *
 * Rising Tide ran its books through QuickBooks via an outside bookkeeper
 * (Supporting Strategies) who categorized every transaction and produced
 * a year-end P&L + balance sheet for tax. After parting ways with them
 * (2026-05), this module brings that in-house: upload each entity's Chase
 * bank + credit-card CSVs per quarter, AI-categorize against the chart of
 * accounts below, the operator reviews, and Helm produces the P&L + 1099
 * prep data.
 *
 * The chart of accounts here is informed by the QuickBooks exports Dotti
 * pulled 2026-05-27 (transaction detail by account for Rising Tide STR
 * LLC + chart of accounts CSVs for both Goose entities). Only the
 * categories with real activity are seeded -- QB's default template has
 * ~133 accounts each but most are inactive. The categorizer in Phase 1b
 * will extend this as needed from the transaction history.
 *
 * SCOPE BOUNDARY: Helm preps, it does not FILE. 1099s and tax returns get
 * filed by Ryan / Jim (the CPA). A balance sheet (double-entry, opening
 * balances, depreciation) is a later phase; phases 1-3 are cash-basis
 * P&L + 1099 prep.
 */

export type LlcEntityKind = 'management' | 'holding';

export type LlcEntity = {
  id: string;
  name: string;
  short: string;
  kind: LlcEntityKind;
  property_ids: string[];
  blurb: string;
  sort: number;
};

/**
 * The three entities Rising Tide files for. Property ownership confirmed
 * by Dotti 2026-05-15 + 2026-05-27 audit of QB exports.
 *
 * 11 Rockholm appears on Goose of Calderwood's books with its own mortgage
 * ($52.7k interest in 2025) but isn't in the STR portal -- needs Dotti
 * confirmation but seeded here as a real owned property.
 */
export const LLC_ENTITIES: Record<string, LlcEntity> = {
  rising_tide: {
    id: 'rising_tide',
    name: 'Rising Tide STR LLC',
    short: 'Rising Tide',
    kind: 'management',
    property_ids: [],
    blurb: 'Management company. Earns management-fee income on the client portfolio; holds the per-property Chase accounts in trust for owners (Property Owner Reserves + Due To/From Owner track the liability).',
    sort: 0,
  },
  goose_astoria: {
    id: 'goose_astoria',
    name: 'Goose of Astoria LLC',
    short: 'Goose of Astoria',
    kind: 'holding',
    property_ids: ['3246_ne_27th', '3_locust'],
    blurb: 'Holding entity — owns 3246 NE 27th Terrace (Lighthouse Point FL) and 3 Locust Lane (Gloucester MA).',
    sort: 1,
  },
  goose_calderwood: {
    id: 'goose_calderwood',
    name: 'Goose of Calderwood LLC',
    short: 'Goose of Calderwood',
    kind: 'holding',
    property_ids: ['65_calderwood', '11_rockholm'],
    blurb: 'Holding entity — owns 65 Calderwood Lane (Fairfield CT) and 11 Rockholm.',
    sort: 2,
  },
};

export const LLC_ENTITY_IDS = Object.keys(LLC_ENTITIES);

/** Human label per owned property id (not all are in the STR portal). */
export const BOOKS_PROPERTY_LABELS: Record<string, string> = {
  '3246_ne_27th': '3246 NE 27th Terrace, Lighthouse Point FL',
  '3_locust': '3 Locust Lane, Gloucester MA',
  '65_calderwood': '65 Calderwood Lane, Fairfield CT',
  '11_rockholm': '11 Rockholm (per QB books — confirm address with Ryan)',
};

// ── Bank + credit-card account inventory ─────────────────────────────────
// Pulled from the QB exports' "Bank" and "Credit Card" account sections.
// The labels in parentheses mirror what the bookkeeper used in QB so
// transactions can be matched back when we ingest CSVs.

export type LlcAccountKind = 'bank' | 'credit_card';

export type LlcAccountSeed = {
  entity_id: string;
  kind: LlcAccountKind;
  institution: string;
  last4: string;
  label: string;
  /** When set, links the account to one of the managed STR properties (Rising Tide's per-property accounts). */
  property_id?: string;
  inactive?: boolean;
};

export const LLC_ACCOUNTS: LlcAccountSeed[] = [
  // ── Rising Tide STR LLC ──
  // Per-property Chase checking accounts (held in trust for owners).
  { entity_id: 'rising_tide', kind: 'bank', institution: 'Chase', last4: '5621', label: '17 Beach', property_id: '17_beach_rd' },
  { entity_id: 'rising_tide', kind: 'bank', institution: 'Chase', last4: '5622', label: '3 South (Bailey)', property_id: '3_south_st' },
  { entity_id: 'rising_tide', kind: 'bank', institution: 'Chase', last4: '9910', label: '53 Rocky Neck (Senecal)', property_id: '53_rocky_neck' },
  { entity_id: 'rising_tide', kind: 'bank', institution: 'Chase', last4: '7876', label: '4 Brier Neck (Armstrong)', property_id: '4_brier_neck' },
  { entity_id: 'rising_tide', kind: 'bank', institution: 'Chase', last4: '1323', label: '21 Horton (Kittredge)', property_id: '21_horton' },
  { entity_id: 'rising_tide', kind: 'bank', institution: 'Chase', last4: '8221', label: '30 Woodward (McWethy)', property_id: '30_woodward' },
  { entity_id: 'rising_tide', kind: 'bank', institution: 'Chase', last4: '3227', label: '73 Rocky Neck (Moynahan)', property_id: '73_rocky_neck' },
  { entity_id: 'rising_tide', kind: 'bank', institution: 'Chase', last4: '9969', label: '20 Hammond (Ramsey)', property_id: '20_hammond' },
  { entity_id: 'rising_tide', kind: 'bank', institution: 'Chase', last4: '1307', label: '20 Enon (Snyder)', property_id: '20_enon' },
  // Operating, business, and tax accounts.
  { entity_id: 'rising_tide', kind: 'bank', institution: 'Chase', last4: '5130', label: 'Rising Tide Main (operating)' },
  { entity_id: 'rising_tide', kind: 'bank', institution: 'Chase', last4: '5623', label: 'Business Complete CHK' },
  { entity_id: 'rising_tide', kind: 'bank', institution: 'Chase', last4: '9928', label: 'Tax Account (MA occupancy remittance)' },
  // Operating credit card (heavy traffic — most SaaS, supplies, meals).
  { entity_id: 'rising_tide', kind: 'credit_card', institution: 'Chase', last4: '3878', label: 'A. OBrien Credit Card' },

  // ── Goose of Astoria LLC ──
  { entity_id: 'goose_astoria', kind: 'bank', institution: 'Chase', last4: '6966', label: 'Business Complete CHK' },
  { entity_id: 'goose_astoria', kind: 'credit_card', institution: 'Chase', last4: '4972', label: 'A. OBrien Credit Card' },
  { entity_id: 'goose_astoria', kind: 'credit_card', institution: 'Chase', last4: '0037', label: 'R. Fortsch Credit Card' },

  // ── Goose of Calderwood LLC ──
  { entity_id: 'goose_calderwood', kind: 'bank', institution: 'Chase', last4: '8203', label: 'Business Complete CHK' },
  { entity_id: 'goose_calderwood', kind: 'credit_card', institution: 'Chase', last4: '9750', label: 'A. OBrien Credit Card' },
];

// ── Chart of accounts ────────────────────────────────────────────────────
// Hierarchical (parent_key + child) and entity-scoped (some accounts are
// shared, some entity-specific). Sourced from the QB exports' active
// account list. Phase 1b's categorizer matches transactions to these keys.

export type CoaType = 'income' | 'expense' | 'cogs' | 'equity' | 'other_income' | 'other_expense';
export type CoaScope = 'shared' | 'rising_tide' | 'goose_astoria' | 'goose_calderwood';

export type CoaAccount = {
  key: string;
  parent_key?: string;
  name: string;
  type: CoaType;
  scope: CoaScope;
  tax_hint?: string;
  /** Auto-filled from Statements data (Phase 1c) -- don't ask the categorizer. */
  pass_through?: boolean;
  sort: number;
};

export const CHART_OF_ACCOUNTS: CoaAccount[] = [
  // ── INCOME ─────────────────────────────────────────────────────────────
  { key: 'property_management_income', name: 'Property Management Income', type: 'income', scope: 'rising_tide', tax_hint: 'Mgmt fees earned on client portfolio', sort: 10 },
  { key: 'interior_design_income', name: 'Interior Design Income', type: 'income', scope: 'rising_tide', sort: 20 },
  { key: 'refunds_to_customers', name: 'Refunds to Customers', type: 'income', scope: 'rising_tide', tax_hint: 'Contra-income (negative)', sort: 30 },
  { key: 'rental_income', name: 'Rental Income', type: 'income', scope: 'shared', tax_hint: 'Schedule E line 3', sort: 40 },
  { key: 'rental_income_brier_neck', parent_key: 'rental_income', name: 'Armstrong / Brier Neck Rental Income', type: 'income', scope: 'rising_tide', sort: 41 },
  { key: 'rental_chargebacks', parent_key: 'rental_income', name: 'Chargebacks', type: 'income', scope: 'rising_tide', sort: 42 },
  { key: 'str_income', name: 'STR Income', type: 'income', scope: 'goose_calderwood', sort: 50 },
  { key: 'cleaning_fares_income', name: 'Cleaning Fares', type: 'income', scope: 'shared', tax_hint: 'Cleaning fees collected from guests', sort: 60 },

  // ── COGS ───────────────────────────────────────────────────────────────
  { key: 'cogs', name: 'Cost of Goods Sold', type: 'cogs', scope: 'shared', sort: 80 },
  { key: 'cogs_supplies_materials', parent_key: 'cogs', name: 'Supplies & Materials', type: 'cogs', scope: 'shared', sort: 81 },

  // ── OPERATING EXPENSES ─────────────────────────────────────────────────
  { key: 'advertising_marketing', name: 'Advertising & Marketing', type: 'expense', scope: 'shared', tax_hint: 'Schedule E line 1', sort: 100 },
  { key: 'listing_fees', parent_key: 'advertising_marketing', name: 'Listing Fees', type: 'expense', scope: 'shared', sort: 101 },
  { key: 'photography', parent_key: 'advertising_marketing', name: 'Photography', type: 'expense', scope: 'shared', sort: 102 },
  { key: 'social_media', parent_key: 'advertising_marketing', name: 'Social Media', type: 'expense', scope: 'rising_tide', tax_hint: 'Facebook/Google Ads', sort: 103 },
  { key: 'web_email_marketing', parent_key: 'advertising_marketing', name: 'Web / Email Marketing', type: 'expense', scope: 'rising_tide', sort: 104 },
  { key: 'photographer_for_listing', parent_key: 'advertising_marketing', name: 'Photographer for Listing', type: 'expense', scope: 'shared', sort: 105 },

  { key: 'business_licenses', name: 'Business Licenses', type: 'expense', scope: 'shared', tax_hint: 'CT SOS, MA filings', sort: 110 },
  { key: 'cleaning_operating', name: 'Cleaning (Operating)', type: 'expense', scope: 'shared', tax_hint: 'Ops-side cleaning -- NOT Property Cleaning (pass-through)', sort: 120 },
  { key: 'contract_labor', name: 'Contract Labor', type: 'expense', scope: 'shared', sort: 130 },
  { key: 'filing_fees', name: 'Filing Fees', type: 'expense', scope: 'rising_tide', sort: 140 },

  { key: 'general_business', name: 'General Business Expenses', type: 'expense', scope: 'shared', sort: 150 },
  { key: 'bank_service_charges', parent_key: 'general_business', name: 'Bank Fees & Service Charges', type: 'expense', scope: 'shared', sort: 151 },
  { key: 'memberships_subscriptions', parent_key: 'general_business', name: 'Memberships & Subscriptions', type: 'expense', scope: 'shared', tax_hint: 'PriceLabs, Furnished Finder, etc.', sort: 152 },

  { key: 'host_channel_fees', name: 'Host Channel Fees', type: 'expense', scope: 'shared', tax_hint: 'Goose entities — channel commissions on rental income', sort: 160 },
  { key: 'host_channel_airbnb', parent_key: 'host_channel_fees', name: 'Airbnb Fees', type: 'expense', scope: 'shared', sort: 161 },
  { key: 'host_channel_booking', parent_key: 'host_channel_fees', name: 'Booking.com Fees', type: 'expense', scope: 'shared', sort: 162 },
  { key: 'host_channel_guesty', parent_key: 'host_channel_fees', name: 'Guesty Fees', type: 'expense', scope: 'shared', sort: 163 },
  { key: 'host_channel_stripe', parent_key: 'host_channel_fees', name: 'Stripe Fees', type: 'expense', scope: 'shared', sort: 164 },
  { key: 'host_channel_vrbo', parent_key: 'host_channel_fees', name: 'VRBO Fees', type: 'expense', scope: 'shared', sort: 165 },

  { key: 'insurance', name: 'Insurance', type: 'expense', scope: 'shared', tax_hint: 'Schedule E line 9', sort: 170 },
  { key: 'insurance_business', parent_key: 'insurance', name: 'Business Insurance', type: 'expense', scope: 'shared', sort: 171 },
  { key: 'insurance_property', parent_key: 'insurance', name: 'Property Insurance', type: 'expense', scope: 'shared', sort: 172 },
  { key: 'insurance_liability', parent_key: 'insurance', name: 'Liability Insurance', type: 'expense', scope: 'shared', sort: 173 },
  { key: 'insurance_vehicle', parent_key: 'insurance', name: 'Vehicle Insurance', type: 'expense', scope: 'rising_tide', sort: 174 },

  { key: 'interest_paid', name: 'Interest Paid', type: 'expense', scope: 'shared', tax_hint: 'Schedule E line 12', sort: 180 },
  { key: 'mortgage_interest', parent_key: 'interest_paid', name: 'Mortgage Interest', type: 'expense', scope: 'goose_astoria', sort: 181 },
  { key: 'mortgage_interest_11_rockholm', parent_key: 'interest_paid', name: 'Mortgage Interest — 11 Rockholm', type: 'expense', scope: 'goose_calderwood', sort: 182 },
  { key: 'mortgage_interest_65_calderwood', parent_key: 'interest_paid', name: 'Mortgage Interest — 65 Calderwood', type: 'expense', scope: 'goose_calderwood', sort: 183 },
  { key: 'business_loan_interest', parent_key: 'interest_paid', name: 'Business Loan Interest', type: 'expense', scope: 'shared', sort: 184 },
  { key: 'credit_card_interest', parent_key: 'interest_paid', name: 'Credit Card Interest', type: 'expense', scope: 'shared', sort: 185 },

  { key: 'legal_accounting', name: 'Legal & Accounting Services', type: 'expense', scope: 'shared', tax_hint: 'Schedule E line 10', sort: 190 },
  { key: 'accounting_fees', parent_key: 'legal_accounting', name: 'Accounting Fees', type: 'expense', scope: 'shared', sort: 191 },
  { key: 'legal_fees', parent_key: 'legal_accounting', name: 'Legal Fees', type: 'expense', scope: 'shared', sort: 192 },

  { key: 'meals', name: 'Meals', type: 'expense', scope: 'shared', sort: 200 },
  { key: 'meals_with_clients', parent_key: 'meals', name: 'Meals with Clients', type: 'expense', scope: 'shared', sort: 201 },
  { key: 'team_meals', parent_key: 'meals', name: 'Team Meals', type: 'expense', scope: 'shared', sort: 202 },

  { key: 'merchant_account_fees', name: 'Merchant Account Fees', type: 'expense', scope: 'rising_tide', tax_hint: 'Stripe/Guesty per-booking fees', sort: 210 },

  { key: 'office_expenses', name: 'Office Expenses', type: 'expense', scope: 'shared', sort: 220 },
  { key: 'office_supplies', parent_key: 'office_expenses', name: 'Office Supplies', type: 'expense', scope: 'shared', sort: 221 },
  { key: 'shipping_postage', parent_key: 'office_expenses', name: 'Shipping & Postage', type: 'expense', scope: 'shared', sort: 222 },
  { key: 'software_apps', parent_key: 'office_expenses', name: 'Software & Apps', type: 'expense', scope: 'shared', tax_hint: 'Guesty, Notion, Vercel, etc.', sort: 223 },
  { key: 'office_merchant_fees', parent_key: 'office_expenses', name: 'Merchant Account Fees', type: 'expense', scope: 'goose_calderwood', sort: 224 },

  { key: 'parking_tolls', name: 'Parking & Tolls', type: 'expense', scope: 'goose_calderwood', sort: 230 },

  { key: 'payroll_expenses', name: 'Payroll Expenses', type: 'expense', scope: 'rising_tide', sort: 240 },
  { key: 'payroll_service_fee', parent_key: 'payroll_expenses', name: 'Payroll Service Fee', type: 'expense', scope: 'rising_tide', tax_hint: 'Gusto', sort: 241 },
  { key: 'payroll_taxes', parent_key: 'payroll_expenses', name: 'Payroll Taxes', type: 'expense', scope: 'rising_tide', sort: 242 },
  { key: 'wages', parent_key: 'payroll_expenses', name: 'Wages', type: 'expense', scope: 'rising_tide', sort: 243 },

  { key: 'repairs_maintenance', name: 'Repairs & Maintenance', type: 'expense', scope: 'shared', tax_hint: 'Schedule E line 14', sort: 250 },

  { key: 'supplies', name: 'Supplies', type: 'expense', scope: 'shared', tax_hint: 'Schedule E line 15', sort: 260 },
  { key: 'supplies_materials', parent_key: 'supplies', name: 'Supplies & Materials', type: 'expense', scope: 'shared', sort: 261 },

  { key: 'taxes_paid', name: 'Taxes Paid', type: 'expense', scope: 'shared', tax_hint: 'Schedule E line 16', sort: 270 },
  { key: 'ma_tax', parent_key: 'taxes_paid', name: 'MA Tax', type: 'expense', scope: 'rising_tide', sort: 271 },
  { key: 'property_taxes', parent_key: 'taxes_paid', name: 'Property Taxes', type: 'expense', scope: 'shared', sort: 272 },

  { key: 'travel', name: 'Travel', type: 'expense', scope: 'shared', tax_hint: 'Schedule E line 6', sort: 280 },
  { key: 'travel_airfare', parent_key: 'travel', name: 'Airfare', type: 'expense', scope: 'shared', sort: 281 },
  { key: 'travel_hotels', parent_key: 'travel', name: 'Hotels', type: 'expense', scope: 'shared', sort: 282 },
  { key: 'travel_vehicle_gas', parent_key: 'travel', name: 'Vehicle Gas & Fuel', type: 'expense', scope: 'rising_tide', sort: 283 },
  { key: 'travel_vehicle_rental', parent_key: 'travel', name: 'Vehicle Rental', type: 'expense', scope: 'rising_tide', sort: 284 },

  { key: 'utilities', name: 'Utilities', type: 'expense', scope: 'shared', tax_hint: 'Schedule E line 17', sort: 290 },
  { key: 'utilities_electricity', parent_key: 'utilities', name: 'Electricity', type: 'expense', scope: 'shared', sort: 291 },
  { key: 'utilities_heating_cooling', parent_key: 'utilities', name: 'Heating & Cooling', type: 'expense', scope: 'shared', sort: 292 },
  { key: 'utilities_internet_tv', parent_key: 'utilities', name: 'Internet & TV Services', type: 'expense', scope: 'shared', sort: 293 },
  { key: 'utilities_phone', parent_key: 'utilities', name: 'Phone Service', type: 'expense', scope: 'shared', sort: 294 },
  { key: 'utilities_water_sewer', parent_key: 'utilities', name: 'Water & Sewer', type: 'expense', scope: 'shared', sort: 295 },
  { key: 'utilities_disposal', parent_key: 'utilities', name: 'Disposal & Waste Fees', type: 'expense', scope: 'shared', sort: 296 },

  { key: 'home_office', name: 'Home Office', type: 'expense', scope: 'rising_tide', sort: 300 },
  { key: 'home_office_rent', parent_key: 'home_office', name: 'Rent', type: 'expense', scope: 'rising_tide', sort: 301 },

  { key: 'long_term_equipment', name: 'Long-Term Office Equipment', type: 'expense', scope: 'rising_tide', sort: 310 },
  { key: 'computers_tablets', parent_key: 'long_term_equipment', name: 'Computers & Tablets', type: 'expense', scope: 'rising_tide', sort: 311 },

  { key: 'personal_healthcare', name: 'Personal Healthcare', type: 'expense', scope: 'rising_tide', sort: 320 },
  { key: 'health_insurance_premiums', parent_key: 'personal_healthcare', name: 'Health Insurance Premiums', type: 'expense', scope: 'rising_tide', sort: 321 },

  { key: 'uncategorized', name: 'Uncategorized', type: 'expense', scope: 'shared', tax_hint: 'Needs review', sort: 900 },

  // ── PASS-THROUGH (Rising Tide only — auto-fills from Statements) ─────
  { key: 'property_owner_revenues', name: 'Property Owner Revenues', type: 'other_income', scope: 'rising_tide', pass_through: true, tax_hint: 'Flows through to owners — not Rising Tide P&L', sort: 500 },
  { key: 'accommodation_fares', parent_key: 'property_owner_revenues', name: 'Accommodation Fares', type: 'other_income', scope: 'rising_tide', pass_through: true, sort: 501 },
  { key: 'pt_host_channel_fees', parent_key: 'property_owner_revenues', name: 'Host Channel Fees', type: 'other_income', scope: 'rising_tide', pass_through: true, sort: 502 },
  { key: 'additional_guest_fees', parent_key: 'property_owner_revenues', name: 'Additional Guest Fees', type: 'other_income', scope: 'rising_tide', pass_through: true, sort: 503 },
  { key: 'cleaning_fares_pt', parent_key: 'property_owner_revenues', name: 'Cleaning Fares', type: 'other_income', scope: 'rising_tide', pass_through: true, sort: 504 },

  { key: 'property_owner_expenses', name: 'Property Owner Expenses', type: 'other_expense', scope: 'rising_tide', pass_through: true, sort: 510 },
  { key: 'property_cleaning', parent_key: 'property_owner_expenses', name: 'Property Cleaning', type: 'other_expense', scope: 'rising_tide', pass_through: true, tax_hint: 'Cape Ann Elite — biggest 1099 candidate', sort: 511 },
  { key: 'property_landscaping', parent_key: 'property_owner_expenses', name: 'Property Landscaping', type: 'other_expense', scope: 'rising_tide', pass_through: true, sort: 512 },
  { key: 'property_photography', parent_key: 'property_owner_expenses', name: 'Property Photography', type: 'other_expense', scope: 'rising_tide', pass_through: true, sort: 513 },
  { key: 'property_repair_maintenance', parent_key: 'property_owner_expenses', name: 'Property Repair & Maintenance', type: 'other_expense', scope: 'rising_tide', pass_through: true, sort: 514 },
  { key: 'str_management_fees', parent_key: 'property_owner_expenses', name: 'STR Management Fees', type: 'other_expense', scope: 'rising_tide', pass_through: true, tax_hint: 'Mirrors Property Management Income', sort: 515 },
  { key: 'property_owner_payouts', name: 'Property Owner Payouts', type: 'other_expense', scope: 'rising_tide', pass_through: true, sort: 520 },

  // ── OTHER INCOME ─────────────────────────────────────────────────────
  { key: 'credit_card_rewards', name: 'Credit Card Rewards', type: 'other_income', scope: 'shared', sort: 600 },

  // ── OTHER EXPENSE ────────────────────────────────────────────────────
  { key: 'vehicle_expenses', name: 'Vehicle Expenses', type: 'other_expense', scope: 'shared', sort: 700 },
  { key: 'vehicle_gas_fuel', parent_key: 'vehicle_expenses', name: 'Vehicle Gas & Fuel', type: 'other_expense', scope: 'shared', sort: 701 },
  { key: 'vehicle_wash', parent_key: 'vehicle_expenses', name: 'Vehicle Wash & Road Services', type: 'other_expense', scope: 'shared', sort: 702 },
  { key: 'depreciation', name: 'Depreciation', type: 'other_expense', scope: 'shared', sort: 710 },
  { key: 'amortization', name: 'Amortization', type: 'other_expense', scope: 'shared', sort: 711 },
  { key: 'suspense', name: 'Suspense', type: 'other_expense', scope: 'shared', tax_hint: 'Reserved -- human review only, never auto-targeted', sort: 990 },

  // ── EQUITY ───────────────────────────────────────────────────────────
  { key: 'owner_contribution', name: 'Owner / Partner Contributions', type: 'equity', scope: 'shared', sort: 800 },
  { key: 'owner_draw', name: 'Owner / Partner Distributions', type: 'equity', scope: 'shared', sort: 810 },
  { key: 'opening_balance_equity', name: 'Opening Balance Equity', type: 'equity', scope: 'shared', sort: 820 },
  { key: 'retained_earnings', name: 'Retained Earnings', type: 'equity', scope: 'shared', sort: 830 },
  { key: 'intercompany_due', name: 'Intercompany Due To/From', type: 'equity', scope: 'shared', tax_hint: 'Rising Tide ↔ Goose entities', sort: 840 },
];

// ── Helpers ──────────────────────────────────────────────────────────────

/** Accounts visible for a given entity: shared + entity-specific. */
export function accountsForEntity(entityId: string): CoaAccount[] {
  return CHART_OF_ACCOUNTS
    .filter(a => a.scope === 'shared' || a.scope === entityId)
    .sort((a, b) => a.sort - b.sort);
}

/** Bank/CC accounts for an entity. */
export function accountsListForEntity(entityId: string): LlcAccountSeed[] {
  return LLC_ACCOUNTS.filter(a => a.entity_id === entityId && !a.inactive);
}

export function getLlcEntity(id: string): LlcEntity | undefined {
  return LLC_ENTITIES[id];
}

// ── Quarter helpers ──────────────────────────────────────────────────────
export function currentQuarter(d = new Date()): string {
  const y = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${y}-Q${q}`;
}

export function quarterRange(period: string): { start: string; endExclusive: string } | null {
  const m = period.match(/^(\d{4})-Q([1-4])$/);
  if (!m) return null;
  const y = Number(m[1]);
  const q = Number(m[2]);
  const startMonth = (q - 1) * 3;
  const start = new Date(Date.UTC(y, startMonth, 1));
  const endExclusive = new Date(Date.UTC(y, startMonth + 3, 1));
  return {
    start: start.toISOString().slice(0, 10),
    endExclusive: endExclusive.toISOString().slice(0, 10),
  };
}
