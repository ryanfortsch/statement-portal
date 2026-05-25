/**
 * LLC Accounting ("Books") module — entity model + starter chart of accounts.
 *
 * Rising Tide ran its books through QuickBooks via an outside bookkeeper
 * (Supporting Strategies) who categorized every transaction and produced
 * a year-end P&L + balance sheet for tax. After parting ways with them
 * (2026-05), this module brings that in-house: upload each entity's Chase
 * bank + credit-card CSVs per quarter, AI-categorize against the chart of
 * accounts below, the operator reviews, and Helm produces the P&L + 1099
 * prep data.
 *
 * SCOPE BOUNDARY: Helm preps, it does not FILE. 1099s and tax returns get
 * filed by Ryan / Jim (the CPA). A balance sheet (double-entry, opening
 * balances, depreciation) is a later phase; phases 1-3 are cash-basis
 * P&L + 1099 prep.
 *
 * This file is the TypeScript source of truth for entities + property
 * links + the *starter* chart of accounts. The starter COA is a sensible
 * STR/management default; it gets refined from the real QuickBooks Chart
 * of Accounts export once that's imported (categories are data, the
 * import can add/rename/retire without code changes).
 */

export type LlcEntityKind = 'management' | 'holding';

export type LlcEntity = {
  id: string;          // stable slug, also the DB primary key
  name: string;        // legal name
  short: string;       // UI label
  kind: LlcEntityKind;
  /** Property IDs this entity owns (holding entities only). */
  property_ids: string[];
  blurb: string;
  sort: number;
};

/**
 * The three entities Rising Tide files for.
 *
 * Rising Tide STR LLC is the management company: management-fee income,
 * business operating expenses. The two Goose LLCs are Ryan's property-
 * holding entities -- each owns specific rentals, so their books carry
 * that property's rental income plus ownership costs (mortgage interest,
 * property insurance, repairs, property tax).
 *
 * Property-ownership confirmed by Dotti 2026-05-15. Note: 3 Locust also
 * appears in the STR portal (lib/properties.ts) with a "Lucas" contact;
 * for tax purposes the owning entity is Goose of Astoria. Not a conflict
 * -- portal "owner" is the billing/contact, entity is the title holder.
 */
export const LLC_ENTITIES: Record<string, LlcEntity> = {
  rising_tide: {
    id: 'rising_tide',
    name: 'Rising Tide STR LLC',
    short: 'Rising Tide',
    kind: 'management',
    property_ids: [],
    blurb: 'Management company — management-fee income and business operating expenses.',
    sort: 0,
  },
  goose_astoria: {
    id: 'goose_astoria',
    name: 'Goose of Astoria LLC',
    short: 'Goose of Astoria',
    kind: 'holding',
    property_ids: ['3246_ne_27th', '3_locust'],
    blurb: 'Holding entity — owns 3246 NE 27th Terrace and 3 Locust Lane.',
    sort: 1,
  },
  goose_calderwood: {
    id: 'goose_calderwood',
    name: 'Goose of Calderwood LLC',
    short: 'Goose of Calderwood',
    kind: 'holding',
    property_ids: ['65_calderwood'],
    blurb: 'Holding entity — owns 65 Calderwood.',
    sort: 2,
  },
};

export const LLC_ENTITY_IDS = Object.keys(LLC_ENTITIES);

/** Human label for an owned property id (these aren't all in the STR portal). */
export const BOOKS_PROPERTY_LABELS: Record<string, string> = {
  '3246_ne_27th': '3246 NE 27th Terrace, Lighthouse Point FL',
  '3_locust': '3 Locust Lane, Gloucester MA',
  '65_calderwood': '65 Calderwood Lane, Fairfield CT',
};

export type CoaType = 'income' | 'expense' | 'cogs' | 'equity' | 'other';

export type CoaAccount = {
  key: string;       // stable slug used by the AI categorizer + dedupe
  name: string;
  type: CoaType;
  /** Optional hint for the tax line this rolls into; refined from QB import. */
  tax_hint?: string;
  sort: number;
};

/**
 * Starter chart of accounts (cash-basis). Deliberately STR-flavored and
 * intentionally small -- the QuickBooks Chart of Accounts import refines
 * this to match the categories Supporting Strategies actually used. The
 * AI categorizer matches transactions to these `key`s; an "uncategorized"
 * fallback always exists so nothing is silently dropped.
 */
export const STARTER_CHART_OF_ACCOUNTS: CoaAccount[] = [
  // ── Income ──
  { key: 'rental_income', name: 'Rental Income', type: 'income', tax_hint: 'Schedule E line 3', sort: 10 },
  { key: 'management_fee_income', name: 'Management Fee Income', type: 'income', sort: 20 },
  { key: 'other_income', name: 'Other Income', type: 'income', sort: 30 },

  // ── Expenses ──
  { key: 'advertising', name: 'Advertising & Social Media', type: 'expense', tax_hint: 'Schedule E line 1', sort: 100 },
  { key: 'bank_merchant_fees', name: 'Bank & Merchant Fees', type: 'expense', tax_hint: 'Stripe / Guesty / card processing', sort: 110 },
  { key: 'cleaning_turnover', name: 'Cleaning & Turnover', type: 'expense', tax_hint: 'Schedule E line 7', sort: 120 },
  { key: 'insurance_business', name: 'Insurance — Business', type: 'expense', tax_hint: 'Schedule E line 9', sort: 130 },
  { key: 'insurance_property', name: 'Insurance — Property', type: 'expense', tax_hint: 'Schedule E line 9', sort: 140 },
  { key: 'legal_professional', name: 'Legal & Professional', type: 'expense', tax_hint: 'Schedule E line 10', sort: 150 },
  { key: 'software_subscriptions', name: 'Software & Subscriptions', type: 'expense', tax_hint: 'Guesty, SaaS', sort: 160 },
  { key: 'repairs_maintenance', name: 'Repairs & Maintenance', type: 'expense', tax_hint: 'Schedule E line 14', sort: 170 },
  { key: 'supplies', name: 'Supplies', type: 'expense', tax_hint: 'Schedule E line 15', sort: 180 },
  { key: 'utilities', name: 'Utilities', type: 'expense', tax_hint: 'Schedule E line 17', sort: 190 },
  { key: 'property_tax', name: 'Property Tax', type: 'expense', tax_hint: 'Schedule E line 16', sort: 200 },
  { key: 'mortgage_interest', name: 'Mortgage Interest', type: 'expense', tax_hint: 'Schedule E line 12', sort: 210 },
  { key: 'travel_auto', name: 'Travel & Auto', type: 'expense', tax_hint: 'Schedule E line 6', sort: 220 },
  { key: 'meals', name: 'Meals & Entertainment', type: 'expense', sort: 230 },
  { key: 'management_fees_paid', name: 'Management Fees Paid', type: 'expense', tax_hint: 'Schedule E line 11 (Goose -> Rising Tide)', sort: 240 },
  { key: 'uncategorized', name: 'Uncategorized', type: 'expense', tax_hint: 'Needs review', sort: 900 },

  // ── Equity (tracked, not P&L) ──
  { key: 'owner_contribution', name: 'Owner Contribution', type: 'equity', sort: 1000 },
  { key: 'owner_draw', name: 'Owner Draw / Distribution', type: 'equity', sort: 1010 },
  { key: 'transfer', name: 'Internal Transfer', type: 'other', tax_hint: 'Between own accounts — excluded from P&L', sort: 1020 },
];

export function getLlcEntity(id: string): LlcEntity | undefined {
  return LLC_ENTITIES[id];
}

/** YYYY-Qn helpers for the quarterly accounting period. */
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
  const startMonth = (q - 1) * 3; // 0,3,6,9
  const start = new Date(Date.UTC(y, startMonth, 1));
  const endExclusive = new Date(Date.UTC(y, startMonth + 3, 1));
  return {
    start: start.toISOString().slice(0, 10),
    endExclusive: endExclusive.toISOString().slice(0, 10),
  };
}
