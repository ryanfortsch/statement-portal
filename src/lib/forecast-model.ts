/**
 * 2026 management-business financial model for Rising Tide.
 *
 * Pure functions + constants — no React, no DOM. The /forecast page imports
 * `calcYear` and the typed constants and renders the result.
 *
 * Scope of the model: only the property-management business. Three things
 * are deliberately OUT of scope:
 *   - RT-owned units (3 Locust, held by Goose of Astoria LLC; the only
 *     properties row carrying is_rising_tide_owned). It has its own P&L,
 *     not relevant to "what does another mgmt contract do for us?"
 *   - Personal owner draw — modeled separately by Ryan/Dotti.
 *   - Federal/state taxes, capex, distributions.
 *
 * Three revenue streams layer over a 12-month seasonality curve:
 *   1. CURRENT: the homes that file statements (seventeen in 2026)
 *   2. PRESIGNED   — 3 contracts signed but not yet onboarded
 *   3. NEW         — N hypothetical adds (the slider — 0 to 10)
 *
 * Each property carries a `type` that selects one of three seasonality
 * curves (CA = Cape Ann, FL = Florida, LS = less-seasonal / inland), and a
 * `start` month so partial-year onboardings are pro-rated correctly.
 */

import type { CardDetail, CardDetailKey } from './forecast-card-detail';

export type SeasonType = 'CA' | 'FL' | 'LS';

export type ManagedProperty = {
  /**
   * properties.id when the entry is a real Helm property. Lets the roster
   * consult the operating windows, so a home offboarded before a forecast
   * year stops counting as active in it. Hypotheticals carry none.
   */
  id?: string;
  name: string;
  /** Annual management fee in dollars (what RT collects, not gross rent). */
  fee: number;
  type: SeasonType;
  /** First month (1-12) the property contributes revenue. */
  start: number;
  /**
   * A hypothetical rolled forward from a prior year's slider. It exists in
   * no Guesty listing, so the smart forecast cannot see it and calcYear has
   * to carry its revenue on seasonality even when smart owns the real fleet.
   */
  synthetic?: boolean;
};

/** Years the model can render. */
export type ForecastYear = 2026 | 2027 | 2028;

/**
 * The properties actually under management in 2026, with each one's annual
 * management fee.
 *
 * RERACKED 2026-09-02 from `property_statements`. The previous list held nine
 * entries under names that appear nowhere in Helm ("Beverly", "The Neck",
 * "Smith Cove", "Rockport AVH") while seventeen properties were filing
 * statements. That gap was not cosmetic: `activeCount` is derived from this
 * list and feeds both ccOperatingCost and contractorCost, so every
 * per-property cost was being multiplied by a fleet 47% too small.
 *
 * Fees are each property's 2026 statement fee annualized over the CA curve
 * share of the months it actually filed. A property first appearing in April
 * gets start: 1, because the Statements module itself only went live that
 * month and those six were plainly already operating; later first-appearances
 * are real mid-year onboardings and keep theirs.
 *
 * Two carry a single month of history (3 Windward, 225 Washington) and their
 * annualized figures are correspondingly soft.
 */
export const CURRENT_2026: ManagedProperty[] = [
  { id: '17_beach_rd', name: '17 Beach', fee: 46519, type: 'CA', start: 1 },
  { id: '21_horton', name: '21 Horton', fee: 29881, type: 'CA', start: 1 },
  { id: '73_rocky_neck', name: '73 Rocky Neck', fee: 28458, type: 'CA', start: 1 },
  { id: '3_south_st', name: '3 South', fee: 23180, type: 'CA', start: 1 },
  { id: '20_hammond', name: '20 Hammond', fee: 17196, type: 'CA', start: 1 },
  { id: '20_enon', name: '20 Enon', fee: 10556, type: 'LS', start: 1 },
  { id: '53_rocky_neck', name: '53 Rocky Neck', fee: 29702, type: 'CA', start: 5 },
  { id: '30_woodward', name: '30 Woodward', fee: 26307, type: 'CA', start: 5 },
  { id: '19_rackliffe', name: '19 Rackliffe', fee: 27484, type: 'CA', start: 6 },
  { id: '79_main', name: '79 Main', fee: 17640, type: 'CA', start: 6 },
  { id: '16_waterman', name: '16 Waterman', fee: 17302, type: 'CA', start: 6 },
  { id: '36_granite', name: '36 Granite', fee: 14194, type: 'CA', start: 6 },
  { id: '4_brier_neck', name: '4 Brier Neck', fee: 31728, type: 'CA', start: 7 },
  { id: '84_thatcher', name: '84 Thatcher', fee: 26455, type: 'CA', start: 7 },
  { id: '53_rocky_neck_2', name: '53 Rocky Neck, Downstairs', fee: 9238, type: 'CA', start: 7 },
  { id: '3_windward', name: '3 Windward', fee: 33805, type: 'CA', start: 8 },
  { id: '225_washington', name: '225 Washington', fee: 3580, type: 'CA', start: 8 },
];
/**
 * Pre-signed list — DEPRECATED in favor of live Helm Prospects pipeline.
 *
 * Previously this hard-coded the 5 contracts in flight. The model now
 * pulls from Helm's `projections` table (see `forecast-prospects.ts`)
 * weighted by each record's `close_likelihood_pct`. The constant is kept
 * empty here for code paths that still reference the symbol.
 */
export const PRESIGNED_2026: ManagedProperty[] = [];

/**
 * Whether a real property is open in `year` (no month given: open for at
 * least one month, which builds the roster) or in a
 * given month of it (which scales the card and the contractor bench on the
 * homes actually operating). The caller supplies it from
 * forecast-operating-windows.ts (opensIn), which
 * this module deliberately does not import: forecast-model.ts is loaded
 * directly under Node by scripts/forecast_rerack_check.mjs, where an
 * extensionless import cannot resolve. Without a predicate every entry is
 * assumed open, which is exactly the behaviour those scripts expect.
 */
export type OpenInYear = (propertyId: string, year: number, month?: number) => boolean;

/**
 * The share of a month a real home is expected to stay under management, 0
 * to 1: 1 - the chance its contract ends, from the month it would be gone
 * (forecast-contract-endings.ts keepFn). Supplied by the caller for the same
 * reason OpenInYear is.
 */
export type KeepShare = (propertyId: string, year: number, month: number) => number;

/**
 * Contracts that may end, as calcYear takes them. `lossByMonth` (index
 * month - 1, positive) is the expected fee lost, read off the smart
 * forecast's per-home months; it is the line wherever smart carries the
 * month. A month smart cannot supply takes the loss from the roster's
 * seasonal fees through `keep`, and every projected month scales the card
 * and the bench on the homes expected to stay.
 */
export type ContractEndingInputs = {
  lossByMonth?: readonly number[];
  keep: KeepShare;
};

/**
 * In 2027 the current properties roll forward as full-year actives.
 * Prospects that closed in 2026 will appear in Helm's `properties` table by
 * then and get queried as currents; until then the forecast layer carries
 * them via the prospects feed. Filtered by the operating windows in
 * getYearConfig when a predicate is supplied.
 */
export const ACTIVE_2027: ManagedProperty[] = [
  ...CURRENT_2026.map((p) => ({ ...p, start: 1 })),
];

/**
 * The roster for a forward year: ACTIVE_2027 minus any home the operating
 * windows have offline for the whole year (4 Brier Neck non-renewed, 73
 * Rocky Neck from November 2026, 79 Main from 21 October 2026). Seasonal
 * homes stay. Until this filter existed the offboarded homes remained in
 * the roster, so activeCount, which scales the card and the contractor
 * bench, counted 17 earning homes where the smart layer had 14.
 */
function rosterFor(year: number, openIn?: OpenInYear, base?: ManagedProperty[]): ManagedProperty[] {
  const src = base ?? ACTIVE_2027;
  if (!openIn) return src;
  return src.filter((p) => !p.id || openIn(p.id, year));
}

/**
 * Order in which hypothetical new 2026 properties come online. Sprinkled
 * across June-Dec since pre-signed already saturate May-June. Default
 * count = 3 → first three slots: Jul, Sep, Nov (evenly spread).
 */
export const NEW_ORDER_2026 = [7, 9, 11, 6, 8, 10, 12] as const;

/**
 * 2027 — new properties can land any month. Defaults Mar, Jun, Sep for
 * the first 3, then fill in Q1/Q4 as the count goes up.
 */
export const NEW_ORDER_2027 = [3, 6, 9, 1, 5, 7, 11, 4, 8, 10, 12, 2] as const;

/** 2028 — same shape as 2027. Default 3 in Mar/Jun/Sep. */
export const NEW_ORDER_2028 = [3, 6, 9, 1, 5, 7, 11, 4, 8, 10, 12, 2] as const;

/**
 * A new management contract in its FIRST season: $25K a year on Cape Ann
 * seasonality from its start month. A first season is a ramp (thin calendar,
 * no reviews yet), so this deliberately sits below the fleet. From its second
 * year the home is a rolled-forward synthetic in getYearConfig and steps up
 * to the fleet's own projected average fee per earning home, the `matureFee`
 * the page derives from the smart forecast (about $32K on 2026-09-02 against
 * a $28K median), never below this first-year figure. The mean counts a
 * seasonal home (16 Waterman, May to October) at its seasonal total, which
 * leans the figure slightly conservative for a full-year synthetic. Before
 * 2026-09-02 a rolled-forward home stayed at $25K for life, which made every
 * added home worth less than the average one already run.
 */
export const NEW_PROPERTY_FEE = 25000;
export const NEW_PROPERTY_TYPE: SeasonType = 'CA';

/** Seasonality curves — raw weights, normalized at module load. */
const CA_RAW = [30 / 7, 30 / 7, 30 / 7, 30 / 7, 30 / 7, 10, 20, 20, 10, 10, 30 / 7, 30 / 7];
const FL_RAW = [15, 15, 12, 10, 8, 6, 5, 5, 5, 5, 5, 9];
const LS_RAW = [7, 7, 7, 7, 8, 9, 12, 12, 9, 8, 7, 7];

function normalize(arr: readonly number[]): number[] {
  const sum = arr.reduce((a, b) => a + b, 0);
  return arr.map((x) => x / sum);
}

export const SEASON: Record<SeasonType, number[]> = {
  CA: normalize(CA_RAW),
  FL: normalize(FL_RAW),
  LS: normalize(LS_RAW),
};

/**
 * Outfitting a new home, charged once in the month a slider home starts.
 *
 * $3,000 per home: the linen order plus the durables. Fix Linens billed the
 * card $23,719 across the eleven 2026 onboardings (January to September,
 * $2,156 each). The Amazon Business export of 2026-10-15 (505 line items,
 * October 2025 to October 2026, each carrying its UNSPSC class) sorts the
 * Amazon side into consumables and durables, and the durables bought beyond
 * the replacement trickle a settled home runs are the rest of outfitting:
 * towels, bedclothes, rugs, a Schlage lock, soap dispensers, a hair dryer,
 * a coffee maker, shelving, about $850 per onboarding. Supplies net of the
 * per-home run rate below leave $33,222 unexplained over the same months,
 * $3,020 per onboarding, so the two readings agree. The card only shows
 * what Rising Tide paid; whether an owner should fund outfitting instead is
 * an open policy decision (card review, 2026-09-02), and until it changes
 * this is the cost the company actually carries.
 *
 * It was $0 until 2026-10-15, on the argument that the trailing per-home
 * supplies figure already included onboarding purchases. It did, which is
 * exactly why that figure was double the run rate: the first clean month
 * after the summer onboarding wave (September 2026, $181 per home) came in
 * at a quarter of what the smeared rate projected. It was $2,150 (linens
 * alone, the only outfitting the card could tell from a restock) until the
 * Amazon item detail arrived the same day. Prospects from the pipeline
 * carry no onboarding charge until they become a property, as they carry
 * no other cost either.
 *
 * Plus the listing shoot. Lightshed Photography shot five homes between
 * 2026-07-31 and 2026-09-30 at $342 to $415, $2,002 in all, $400 a shoot,
 * paid on the card. It was projected as a $1,000/mo contractor bench line
 * from 2026-10-15 to 2026-11-07, when Dotti ruled it belongs to onboarding:
 * a shoot happens once, when a home comes online, and does not recur with
 * the month. So it is charged here, with the linens, in the start month.
 */
export const ONBOARDING_OUTFIT_COST = 3000;
export const ONBOARDING_PHOTO_COST = 400;
export const ONBOARDING_COST = ONBOARDING_OUTFIT_COST + ONBOARDING_PHOTO_COST;

/* --------------------------------------------------------------------- */
/* Recurring monthly expenses, calibrated to Chase ...5130 actuals       */
/* (Apr 2025 → Apr 2026, 12-mo window). See forecast-actuals.ts.         */
/* --------------------------------------------------------------------- */

/** 85 Eastern: downstairs $750/mo; Suite 107 adds $250/mo from July 2026.
 * July's added room was billed at $80; August onward totals $1,000/mo.
 * Both leases retained in October; continuation after Feb 2027 is assumed.
 */
export const OFFICE_BASE_RENT_MONTHLY = 750;
export const OFFICE_ADDITIONAL_RENT_MONTHLY = 250;
export const OFFICE_RENT_MONTHLY = OFFICE_BASE_RENT_MONTHLY + OFFICE_ADDITIONAL_RENT_MONTHLY;
/**
 * The office dumpster: Republic Services, billed to the card and filed as
 * Rent & office. Nothing on the card before April 2026, when the office
 * opened. Then $165 on 04-30, 05-27 and 06-14, no July charge, and $471 on
 * 2026-08-14: $966 over the five months since service began, $193/mo.
 *
 * September settled what the August charge meant: Republic billed $471
 * again on 2026-09-14, a month to the day after the first one, so $471 is
 * the monthly rate for the service as it now stands and that is what the
 * two remaining months project. It was $193 (the mean since service began)
 * from 2026-09-06 to 2026-10-15, and $50 flat before that, a number no bank
 * row had ever shown, while the real charges read as Travel & other because
 * a card row filed under Rent & office had no route to the Office line.
 * routeCardRow sends them here now, so ACT months and projected months
 * describe the same shape.
 *
 * The service ends 2026-11-30. Rising Tide sent Republic written notice on
 * 2026-10-05 (CSA A913211849) and the operator confirmed on 2026-10-14 that
 * the cancellation stands. November 2026 is the last month the Office line
 * projects the dumpster; from December 2026 it is rent alone (dumpsterCost).
 * Actuals are not gated: the final Republic invoice, and anything billed
 * after, still files under Rent & office and rides the Office line, so an
 * ACT month reads what the card actually paid.
 */
export const DUMPSTER_MONTHLY = 471;
/** The last month the dumpster is projected: service ends 2026-11-30. */
export const DUMPSTER_LAST_YEAR = 2026;
export const DUMPSTER_LAST_MONTH = 11;
/** Office costs only kick in from March (when the lease begins). */
export const OFFICE_START_MONTH = 3;

/**
 * Software subscriptions, consolidated from the corporate card (...3878).
 * Guesty, PriceLabs, Squarespace, QuickBooks, Adobe, AirDNA, AI tools, Quo,
 * Zoom, Dropbox, DocuSign, Vercel, Supabase, Resend, Tailscale.
 *
 * RERACKED Aug 2026 against `overhead_expenses` card rows. The previous
 * $1,687 baseline and its two "subscription cuts" did not survive contact
 * with the data:
 *
 *   trailing 12mo (Jun 2025 - May 2026)  $1,798/mo
 *   trailing  9mo (Sep 2025 - May 2026)  $1,978/mo
 *   2026 YTD      (Jan - May 2026)       $2,311/mo
 *   May 2026 alone                       $2,314/mo
 *
 * The model claimed May 2026 would land at $1,287 and June onward at
 * $1,187. May actually came in at $2,314, 80% above the claim, and the
 * line has risen every window, driven by the AI tooling stack. The cuts
 * are removed rather than deferred: there is no month in the record where
 * software spend stepped down.
 *
 * Card detail now runs through 2026-09-01 (#1457), so June to August are
 * corroborated, and the actuals builder routes the card's Software rows onto
 * this line rather than the operating lump, so the ACT months show it:
 *
 *   Jun 2026  $1,272     Jul 2026  $3,420     Aug 2026  $3,804
 *
 * July and August ran above the old $2,300 constant on Anthropic API credits
 * alone: $1,081 and $1,589 of prepaid reloads for the guest-messaging
 * responder, against under $300 in any earlier month. The operator ruled
 * those two months a one-off on 2026-09-02 and the constant was held, on
 * the condition that it be reopened if the reloads reached a third month.
 *
 * September 2026 (card detail to 2026-10-07) settled it at $2,952. The $11
 * reload stream did stop on August 25 and both Claude Pro seats are gone,
 * but the stack itself moved up: Guesty $1,323 (it was $973 in January and
 * bills per listing), PriceLabs $246, one Claude Max seat at $212.50 plus
 * five Anthropic charges of $95.63 to $106.25 that read as smaller seats or
 * $90 to $100 reloads, OpenAI $120 (ChatGPT went from $21 to $99, then
 * $148 on 2026-10-02), Seam $120, Quo $77, Adobe $69 on two plans, AirDNA
 * $68, and a second Zoom plan at $18 beside the annual one. The stack with
 * no usage at all is about $2,700, and that is the constant: the nine-month
 * 2026 mean is $2,598 and the Guesty line alone grows with every listing.
 * This remains the baseline before the Guesty exit budget below.
 */
export const SOFTWARE_MONTHLY = 2700;

/**
 * Guesty exit planning budget, approved 2026-11-07. Total software costs:
 * overlap at $2,850 in Nov-Dec 2026; $2,600 / $2,300 / $1,900 in Jan-Mar
 * 2027; $1,650 from April onward, including 2028. The rounded steady budget
 * replaces the baseline's $1,323 Guesty line with about $150-$160 Channex
 * and $100 extra operating allowance, retaining PriceLabs and other tools.
 * Assumes a late-November Calderwood pilot, phased rollout and billing
 * runoff through March-April, subject to channel readiness and Guesty terms.
 * November–March retain those transition allowances. From April 2027 the
 * itemized budget below supersedes the old $1,650 less cancellations total.
 * These are forecast allowances, not confirmed cancellations or invoices;
 * calcYear's measured-month path continues to use actual card spending.
 */
/** Confirmed Nov 7 cuts, budgeted from the next renewal month (December).
 * Vercel: Dotti switched to free Viewer, $20/mo paid seat removed.
 * Zoom: cancellation confirmed, paid access ends Dec 2, $14.44/mo renewal avoided.
 * Dropbox: one $12.74/mo account cancelled Nov 8; budget from December
 * because the final renewal date is not verified.
 * No assumed November refunds or tax credits. Actual card spending still wins.
 */
export const SOFTWARE_CONFIRMED_MONTHLY_SAVINGS = 20 + 14.44 + 12.74;
/** Adobe cancelled Nov 7; operator confirms $75/mo and next bill Nov 29.
 * Avoid that November renewal; no refund or cancellation fee assumed.
 */
export const ADOBE_MONTHLY_SAVINGS = 75;
/** Operator-approved planning assumption: avoid AirDNA's Nov 9 renewal.
 * Cancellation requested but not confirmed. Actual invoices still override.
 */
export const AIRDNA_PLANNED_MONTHLY_SAVINGS = 67.94;

/** Itemized post-Guesty cash budget, reviewed November 8, 2026.
 * Receipt evidence and unresolved items: docs/finance/software-cost-audit-2026-11-07.md.
 * AI credits are an operator-approved planning allowance, not a provider spending limit.
 * Fixed fleet snapshot: property/device growth and vendor price changes need review.
 */
export const SOFTWARE_BUDGET_ITEMS = [
  { key: 'channex', label: 'Channex', amount: 160, note: 'Planning estimate for account and live-property fees; not the partial November invoice.' },
  { key: 'pricelabs', label: 'PriceLabs', amount: 253.70, note: 'October and November payment receipts, including tax.' },
  { key: 'claude', label: 'Claude base plan', amount: 100, note: 'Operator-confirmed monthly budget; usage credits separate.' },
  { key: 'chatgpt', label: 'ChatGPT base plan', amount: 100, note: 'Operator-confirmed monthly budget; usage credits separate.' },
  { key: 'ai_credits', label: 'AI usage credits', amount: 150, note: 'Operator-approved monthly allowance across AI providers; not an enforced cap or observed run rate.' },
  { key: 'seam', label: 'Seam', amount: 120, note: 'October invoice: 24 managed devices at $5 each; excludes one-time proration.' },
  { key: 'quo', label: 'Quo', amount: 112.10, note: 'Estimated renewal after October seat change: 3 × $33, $5 extra number, $1.50 A2P, plus approximately 6.25% tax.' },
  { key: 'vercel', label: 'Vercel', amount: 21.25, note: 'Latest $41.25 receipt less the cancelled $20 seat; tax retained conservatively.' },
  { key: 'supabase', label: 'Supabase', amount: 32.14, note: 'October invoice; usage may vary.' },
  { key: 'render', label: 'Render', amount: 6.53, note: 'Latest November receipt; usage may vary.' },
  { key: 'tailscale', label: 'Tailscale', amount: 8.50, note: 'Latest November receipt.' },
  { key: 'resend', label: 'Resend', amount: 20, note: 'May–September card run rate; retained pending current bill review.' },
  { key: 'quickbooks', label: 'QuickBooks', amount: 40.38, note: 'June–September card run rate; no cancellation confirmed.' },
  { key: 'dropbox', label: 'Remaining Dropbox', amount: 12.74, note: 'One of two historical subscriptions remains budgeted; only one cancellation confirmed.' },
  { key: 'squarespace', label: 'Squarespace pending verification', amount: 53.12, note: 'Two historical $26.56 streams retained until cancellation is verified.' },
  { key: 'onepassword', label: '1Password annual renewal', amount: 57.28, billingMonth: 5, note: 'May only, at the last paid annual amount; family/business allocation and renewal discount remain unverified.' },
] as const;

export function itemizedSoftwareCost(month: number): number {
  return Math.round(SOFTWARE_BUDGET_ITEMS.reduce((sum, item) =>
    sum + (!('billingMonth' in item) || item.billingMonth === month ? item.amount : 0), 0) * 100) / 100;
}

export function softwareCost(year: number, month: number): number {
  if (year >= 2028 || (year === 2027 && month >= 4)) return itemizedSoftwareCost(month);
  let budget = SOFTWARE_MONTHLY;
  if (year === 2027) budget = [2600, 2300, 1900][month - 1] ?? SOFTWARE_MONTHLY;
  else if (year === 2026 && month >= 11) budget = 2850;
  const savings = year > 2026 || (year === 2026 && month >= 12)
    ? SOFTWARE_CONFIRMED_MONTHLY_SAVINGS : 0;
  const novemberSavings = year > 2026 || (year === 2026 && month >= 11)
    ? ADOBE_MONTHLY_SAVINGS + AIRDNA_PLANNED_MONTHLY_SAVINGS : 0;
  return Math.round((budget - savings - novemberSavings) * 100) / 100;
}

/**
 * MH Partners — RT's outside bookkeeper. Steady ~$1,000/mo retainer
 * through April 2026, with a final $1,800 wrap-up payment in May 2026.
 * Zero from June 2026 onward (engagement ends).
 */
export const BOOKKEEPER_MONTHLY = 1000;
/** Final month bookkeeper is paid (1-12). May 2026 — engagement winds down. */
export const BOOKKEEPER_LAST_MONTH = 5;
/** Larger final payment in the wrap-up month. */
export const BOOKKEEPER_FINAL_AMOUNT = 1800;

/**
 * Insurance. A single annual premium (Phillips, commercial general
 * liability) paid as one lump sum in March — $5,263.92 on 03/02/2026,
 * same March renewal assumed forward. Nothing else is modeled: there is
 * no recurring monthly premium (GEICO auto is monthly and rides the card,
 * see CC_VEHICLE_INSURANCE_MONTHLY).
 *
 * OPEN, revisit April 2027: Arbella charged $3,188.57 to the card on
 * 2026-04-15. Dotti ruled it a one-time hit (2026-09-06), so the ACT row
 * carries it on the Insurance line and nothing is projected. If Arbella
 * renews next April, add a second annual constant here rather than letting
 * it land in the card's monthly run rate.
 *
 * Workers comp for the operations manager rides this line too, on its own
 * installment dates from November 2026: see workersCompCost.
 */
export const INSURANCE_ANNUAL = 5264;
export const INSURANCE_MONTH = 3;

/**
 * Accounting (MS Consultants). The Aug 2026 rerack modeled this as an
 * annual April lump because the bank showed two hits, $4,156.62 on
 * 2025-01-13 and $4,442.96 on 2026-04-15, and read them as a tax-season
 * engagement that recurs. The operator ruled on 2026-09-02 that MS
 * Consultants was a one-off, so its lump does not project forward. The April 2026 hit is kept for the seasonality
 * path only, and that month is an ACT month carrying the real charge.
 * Do not reinstate the annual lump on the strength of the 2025 payment
 * without asking; that evidence was already on the table when she ruled.
 *
 * CPA (Jim Keefe, Lee & Crowley), from 2027. Dotti asked on 2026-11-09
 * for his year-end fee to be budgeted: the three LLC returns, the 1099s
 * and the tax projection. No fee is quoted in his mail yet, so the
 * placeholder is the last measured accountant bill, $4,450, in April
 * (tax season). Replace CPA_ANNUAL with his invoice when it arrives.
 */
export const ACCOUNTING_MONTHLY = 0;
export const ACCOUNTING_ANNUAL = 4450;
export const ACCOUNTING_MONTH = 4;
/** The MS Consultants year. */
export const ACCOUNTING_YEAR = 2026;
export const CPA_ANNUAL = 4450;
export const CPA_MONTH = 4;
export const CPA_FIRST_YEAR = 2027;

export function accountingCost(year: number, month: number): number {
  if (year === ACCOUNTING_YEAR && month === ACCOUNTING_MONTH) return ACCOUNTING_ANNUAL;
  if (year >= CPA_FIRST_YEAR && month === CPA_MONTH) return CPA_ANNUAL;
  return ACCOUNTING_MONTHLY;
}

/**
 * Bank fees and stop payments. RERACKED Aug 2026: actual FEE_TRANSACTION
 * rows total $75.00 across 24 months ($3.12/mo) - three $15 monthly service
 * charges in 2024 and one $30 stop-payment fee in April 2026. The old $100
 * conflated real fees with the bounced check deposits, which are a wash
 * rather than a cost (see the DEPOSIT_RETURN note in overhead-categories).
 * Set to $10 to leave headroom without inventing $1,164/yr of cost.
 */
export const BANK_FEES_MONTHLY = 10;

/**
 * Corporate-card spend, split into what scales with the fleet and what does not.
 *
 * RERACKED 2026-09-02 against the full Chase ...3878 statement (1,012 rows,
 * January to September). The old model was a flat CC_BASELINE_MONTHLY of
 * $6,045 with a CC_ELASTICITY coefficient, and it could not work: real card
 * spend ran $3,858 in March and $19,239 in August. No flat number and no
 * single elasticity describes a line that swings five-fold, because most of it
 * is consumables bought per property per turnover and the rest is
 * subscriptions that never move.
 *
 * VARIABLE: guest supplies and small repairs. What a settled home consumes
 * and replaces: Amazon consumables, the replacement durables, Target and
 * HomeGoods. Measured at the item level on the Amazon Business export of
 * 2026-10-15 (505 line items, October 2025 to October 2026, each with its
 * UNSPSC class; Amazon is 95% of the card's supplies spend and the Business
 * account is 91% of the card's Amazon). Amazon consumables (cleaning and
 * dishwasher products, paper, the EO bath refills, coffee pods, trash bags,
 * sponges, batteries) per live home per month in 2026:
 *
 *     Jan $88   Feb $108  Mar $0    Apr $166  May $197
 *     Jun $233  Jul $345  Aug $229  Sep $79
 *
 * Least-squares against the Cape Ann curve pulled one month earlier and damped
 * to 60% amplitude gives $1,805 per home per year (the flat mean says $1,800,
 * so the curve is not doing the work). The months with no onboarding in them
 * also show about $1,000 a year per home of replacement durables (towels,
 * dryers, dispensers; $89 a home a month across January to April and
 * September), and the non-Amazon stores add about $56. The recurring rate is
 * the sum, $2,950; the Amazon durables bought beyond that trickle are the
 * onboarding charge above, and the two tile the year's $60,896 of supplies
 * within half a percent. The one-month lead is not a fitting trick: a house
 * is stocked the month BEFORE its guests arrive.
 *
 * RERACKED 2026-10-15, twice. The figure was $8,360 from 2026-09-02, fitted
 * to February through August with every onboarding of the year inside it.
 * September 2026, the first month after the summer wave, came in at $2,892
 * for sixteen homes against the $11,900 that rate projected: the summer was
 * eleven outfittings, not a run rate. A card-level refit with the Fix Linens
 * orders removed gave $4,070 the same morning; the Amazon item detail that
 * afternoon showed that figure still carried the summer's towels, rugs,
 * locks and kitchen kit, and settled it here. The whole of 2025 spent
 * $35,939 on supplies for the fleet of the time, which the old rate would
 * have put at $50,000 for six homes.
 *
 * Two shapes fit better on paper and were rejected. The revenue curve at a
 * one-month lead puts September above August, an artifact of Gloucester's
 * own September/October inversion. The raw occupancy curve is physically
 * tidier and fits worse.
 */
export const CC_SUPPLY_ANNUAL_PER_PROP = 2950;

/** Cape Ann turnovers, pulled one month earlier and damped to 60%. */
const CC_SUPPLY_RAW = SEASON.CA.map((_, i) => 0.6 * SEASON.CA[(i + 1) % 12] + 0.4 / 12);
export const CC_SUPPLY_SEASON: number[] = normalize(CC_SUPPLY_RAW);

/**
 * Supplies budget reduced 25% for November 2026 through April 2027.
 * Applies to projected guest supplies after the repairs split; measured
 * spend, repairs and new-home outfitting keep their existing amounts.
 * This is the requested winter window, not a recurring annual reduction.
 */
export const CC_SUPPLY_WINTER_FACTOR = 0.75;

export function supplyBudgetFactor(year: number, month: number): number {
  return (year === 2026 && month >= 11 && month <= 12) ||
    (year === 2027 && month >= 1 && month <= 4)
    ? CC_SUPPLY_WINTER_FACTOR
    : 1;
}

/** GEICO auto. $518.35 to $518.81 every month of 2026, unchanged since Mar 2025. */
export const CC_VEHICLE_INSURANCE_MONTHLY = 519;
/** AT&T. Five charges April onward, nothing before. */
export const CC_TELECOM_MONTHLY = 114;
/** AT&T Extra active Nov 8, 2026. Quoted bills include taxes, fees and
 * existing services: $69.54 next bill with partial-month credits, $82.96
 * ongoing with eligible bank AutoPay. These are estimates; actuals win.
 */
export function telecomCost(year: number, month: number): number {
  if (year > 2026 || (year === 2026 && month >= 12)) return 82.96;
  if (year === 2026 && month === 11) return 69.54;
  return CC_TELECOM_MONTHLY;
}
/**
 * Flights, car rental, fuel, meals. Averaged over the whole card record rather
 * than 2026 alone: November 2025 was $3,600 by itself and a 2026-only mean
 * understates the line three-fold.
 */
export const CC_TRAVEL_MONTHLY = 175;
/**
 * The residual Other bucket once the identifiable lines are pulled out:
 * the van (Honda North service, Wagners detailing, the car wash), the
 * card's own interest charges, the hiring run (Indeed job ads billed on the
 * 2nd of each month, one Checkr background check) and the odd one-off.
 * Measured on the 2026 card with Lightshed moved to the Contractors line
 * and the landscapers to Repairs: $380, $668, $0, $50, $352, $212, $364,
 * $610, $578 for January to September, $357 a month, which with the $175
 * travel figure is what this line carries. It was $110 until 2026-10-15.
 */
export const CC_ADMIN_MONTHLY = 185;
/**
 * Furnished Finder, $199 a year per listing. Two listings now: the card
 * carried one on 2026-08-11 and a second on 2026-09-30, so the projection
 * renews one in August and one in September. VRBO is deliberately NOT here:
 * it is a channel commission already netted out of rental revenue,
 * categorised 'Pass-through', and counted in no expense total.
 */
export const CC_LISTING_ANNUAL = 199;
export const CC_LISTING_MONTHS: readonly number[] = [8, 9];

/** The Furnished Finder renewals that land in a month. */
export function listingCost(month: number): number {
  return CC_LISTING_MONTHS.includes(month) ? CC_LISTING_ANNUAL : 0;
}

/**
 * Marketing, and the cut that really did happen.
 *
 * $173 / $526 / $1,111 / $757 / $832 for January to May, then $333, $33, $164,
 * $378 for June to September. The model originally claimed this cut and #1382
 * removed it as unverifiable, because card detail stopped on 2026-06-06. The
 * statement now covers those months and the cut is plainly there. It is a step
 * down to roughly $225 (the June to September mean, a $10-a-day Meta campaign
 * plus Seaside Graphics print and the Eagle Tribune), not the drop to zero
 * the first version assumed. It was carried at $175 until 2026-10-15.
 */
export const CC_MARKETING_MONTHLY = 680;
export const CC_MARKETING_POST_CUT_MONTHLY = 225;
export const CC_MARKETING_CUT_MONTH = 6;

export function marketingCost(year: number, month: number): number {
  if (year > 2026 || (year === 2026 && month >= CC_MARKETING_CUT_MONTH)) {
    return CC_MARKETING_POST_CUT_MONTHLY;
  }
  return CC_MARKETING_MONTHLY;
}

/** The part of the card that arrives whether a guest does or not. */
export const CC_FIXED_MONTHLY =
  CC_VEHICLE_INSURANCE_MONTHLY + CC_TELECOM_MONTHLY + CC_TRAVEL_MONTHLY + CC_ADMIN_MONTHLY;

/**
 * Of the per-property variable spend, the slice that is hardware, plumbing,
 * propane and yard work rather than consumables and replacements. Measured
 * on the 2026 card through September, with Wolf Hill and SP Properties filed
 * as repairs: $3,813 of Repairs & upkeep against $27,674 of recurring
 * supplies (the per-home rate times the fleet, outfitting excluded), 12% of
 * the variable spend. It read 5% against the outfitting-inflated supplies
 * figure until 2026-10-15 and 9% against the card-level refit the same
 * morning; an earlier itemisation put it at 20%, which is how the Repairs
 * row came to claim $1,660 a month the card never showed.
 */
export const CC_REPAIRS_SHARE = 0.12;

/**
 * The card for one month, itemised the same way the ACT months are.
 *
 * Consumables and repairs scale with the fleet and the season; insurance,
 * telecom, travel and marketing are the fixed floor. Furnished Finder's
 * annual listing fee rides the marketing bucket in August, and so does
 * Cooper's content work (creativeCost below), the one operating-account
 * payment in here: Dotti filed it under marketing on 2026-11-07, and the
 * ACT mapping puts his rows in the same bucket. The six keys are the six
 * Recurring Monthly rows on /forecast, so a projected month and a measured
 * one describe the same shape and the table has no seam between them.
 *
 * Elasticity is structural rather than a tuned coefficient: the variable
 * term is fully elastic by construction and the fixed term is not elastic
 * at all, so the blended figure falls out of the mix instead of being
 * asserted. Same shape as contractorCost, which already rides a curve and
 * scales with the fleet. Outfitting a new home is NOT in here: it is the
 * one-time ONBOARDING_COST in the month a slider home starts.
 */
export function ccOperatingDetail(
  activePropCount: number,
  year: number,
  month: number,
): CardDetail {
  const variable =
    CC_SUPPLY_ANNUAL_PER_PROP * (CC_SUPPLY_SEASON[month - 1] ?? 0) * activePropCount;
  return {
    supplies: variable * (1 - CC_REPAIRS_SHARE) * supplyBudgetFactor(year, month),
    repairs: variable * CC_REPAIRS_SHARE,
    vehicle_insurance: CC_VEHICLE_INSURANCE_MONTHLY,
    travel_other: CC_TRAVEL_MONTHLY + CC_ADMIN_MONTHLY,
    marketing: marketingCost(year, month) + listingCost(month) + creativeCost(year, month, activePropCount),
    telecom: telecomCost(year, month),
  };
}

/**
 * Card spend for one month: the sum of ccOperatingDetail, so the total and
 * its itemisation cannot drift apart.
 */
export function ccOperatingCost(
  activePropCount: number,
  year: number,
  month: number,
): number {
  const d = ccOperatingDetail(activePropCount, year, month);
  return d.supplies + d.repairs + d.vehicle_insurance + d.travel_other + d.marketing + d.telecom;
}

/**
 * The Recurring Monthly rows on /forecast, in display order.
 *
 * `key` selects the bucket in a month's `cc_detail`, which is measured for
 * an ACT month and the model's own term for a projected one. `monthly` is
 * a FALLBACK weight, used only for a month whose card spend is known solely
 * through the operating account's card payoff and so has no category
 * detail; such a month is split proportionally by these weights. Values
 * are a representative mid-season month at the current fleet and only
 * their ratio matters.
 */
export const CC_OPERATING_BREAKDOWN: ReadonlyArray<{
  key: CardDetailKey;
  label: string;
  monthly: number;
  info: string;
}> = [
  {
    key: 'supplies',
    label: 'Guest supplies & inventory',
    monthly: 4000,
    info: 'What a settled home consumes and replaces: Amazon consumables (cleaning and dishwasher products, paper, bath refills, coffee pods, trash bags), replacement towels and small durables, Target and HomeGoods. Projected at $2,950 per live home per year on the turnover curve pulled a month early, because a house is stocked before its guests arrive: $1,805 of consumables measured item by item on the Amazon Business export of 2026-10-15, about $1,000 of replacements, and the non-Amazon stores. The summer 2026 peak ($16,925 in June) was eleven outfittings, which the Onboarding line carries; September, the first clean month after the wave, read $2,892 for sixteen homes. The projected supplies allocation is reduced 25% from November 2026 through April 2027; repairs and onboarding keep their existing amounts. Measured months show the real card figure.',
  },
  {
    key: 'repairs',
    label: 'Repairs & upkeep',
    monthly: 550,
    info: 'Hardware stores, plumbing, propane, yard work (Wolf Hill, SP Properties) and small contractor charges on the card. About 12% of the variable card spend, measured on 2026 through September: $3,813 against $27,674 of recurring supplies. Rides the same per-property seasonal curve as supplies.',
  },
  {
    key: 'vehicle_insurance',
    label: 'Vehicle & other insurance',
    monthly: 519,
    info: 'GEICO auto, $519 every month of 2026 and unchanged since March 2025, and that is the run rate forward. Measured months show the real GEICO charge. The $3,189 Arbella premium that hit the card on 2026-04-15 is a one-time payment and sits on the Insurance line below, beside Phillips, not in this row.',
  },
  {
    key: 'travel_other',
    label: 'Travel & other',
    monthly: 360,
    info: 'Flights, car rental, rideshares, the van (service, detailing), the card\'s own interest charges, the hiring run (Indeed, Checkr) and the small remainder the categorizer could not name. Projected at $360/mo: $175 of travel averaged across the whole card record, because one month (November 2025, $3,600) carries most of a year, plus $185 of the rest, the 2026 mean through September once photography moved to Contractors and yard work to Repairs.',
  },
  {
    key: 'marketing',
    label: 'Marketing & advertising',
    monthly: 1525,
    info: 'Cooper\'s content work, $1,300/mo per 16 homes scaled to the live fleet (paid $300/wk on the Chase payroll rail from 2026-07-29; filed under marketing rather than the contractor bench since 2026-11-07, full every month: the off-season half stayed on the bench), plus Facebook and Meta, Seaside Graphics print and the Eagle Tribune, plus the $199 Furnished Finder listings (one renews in August, a second in September). The ads ran $680/mo through May 2026, then stepped down to roughly $225 from June ($333, $33, $164, $378 for June to September). The cut is real and measured, not assumed.',
  },
  {
    key: 'telecom',
    label: 'Telecom',
    monthly: 114,
    info: 'AT&T: $114/mo historical allowance through October 2026. Extra activated November 8 with bank AutoPay: estimated November bill $69.54 after partial-month credits, then $82.96/mo including taxes, fees and existing services. Discounts can take two bill cycles; measured charges override estimates.',
  },
];

/* --------------------------------------------------------------------- */
/* 1099 contractors: the field + creative bench                          */
/* --------------------------------------------------------------------- */

/**
 * Field labor (Delaney Jordan). Paid per job by Zelle out of ...5130, not
 * through Gusto, so it never touched the old payroll line and the model
 * carried it as $0 until this rerack. Runs July to October 2026 only: from
 * 2026-11-01 she is salaried (payrollCost below) and this line is $0 for good.
 *
 * Calibration: the whole 1099 bench ran $15,248 over the 56 days from
 * 2026-07-01 to 2026-08-25, $272.29/day, $8,288/mo, in peak season. Net
 * out the flat creative and misc lines below and field labor is $6,738/mo
 * at a July share of 20% of the Cape Ann year, so $33,700 annualized.
 *
 * PROP_COUNT is 16, the mean live fleet across the calibration window: 15
 * properties in July 2026 and 17 in August.
 *
 * It was 10 until 2026-09-02, and deliberately so: CURRENT_2026 was a stale
 * nine-entry roster, so `activeCount` reported 10 and the divisor had to match
 * the count the model actually passed in rather than the fleet on the ground.
 * That roster is now real, so the divisor is real too. The annual figure is
 * unchanged, because the two corrections cancel: the window averaged 16
 * properties, which is exactly what the old pairing was standing in for.
 *
 * The work is per-turnover: payments cluster on Monday and Thursday (62.3%
 * of dollars, 59.0% of payments), track checkout volume, and grew by
 * frequency rather than by rate. So it rides the same seasonality curve as
 * revenue and scales with the portfolio at full elasticity, unlike the
 * card baseline's 0.5x.
 */
export const CONTRACTOR_FIELD_ANNUAL = 33700;
export const CONTRACTOR_FIELD_PROP_COUNT = 16;
/** First month field labor appears (2026 only, it starts mid-year). */
export const CONTRACTOR_FIELD_START_MONTH_2026 = 7;

/**
 * Content work (Cooper). Paid $300/wk on the Chase "Basic Online Payroll"
 * rail from 2026-07-29, with occasional larger weeks, $2,300 through 08/25.
 * $1,300/mo at the 16-home calibration fleet, scaled to the live count:
 * content is per listing, so a bigger fleet is more shoots. It does not
 * ride the seasonality curve, because shoots are scheduled against the
 * content calendar rather than turnover volume.
 *
 * It sat on the Contractors line until 2026-11-07, when Dotti moved it to
 * marketing: the run rate was right, the row was wrong. So it rides the
 * card's Marketing & advertising bucket (ccOperatingDetail) in a projected
 * month, and an ACT month puts his operating-account rows in the same
 * bucket (isCreativeBench in forecast-card-detail.ts). The bench
 * calibration below ($8,288/mo) was measured with him in it, so the
 * harness takes him back out when it checks the Contractors line.
 */
export const MARKETING_CREATIVE_MONTHLY = 1300;
export const MARKETING_CREATIVE_START_MONTH_2026 = 7;

/**
 * The bench runs at half for January to April 2027.
 *
 * Dotti, 2026-10-21: "reduce the contractor expense by 50% from Jan-Apr of
 * 2027". A dated ruling, applied to the whole Contractors line for those
 * four months as it stood that day (creative, listing photography and the
 * misc blend; the field work is the operations manager's salary by then
 * and is not touched). Since 2026-11-07 the factor applies to what is left
 * on the Contractors line, the misc blend: Cooper's line in marketing runs
 * full every month (Dotti, 2026-11-07: "Drop the half"), and the listing
 * shoot is a one-time onboarding charge with no month to halve. It is
 * scoped to 2027 because that is what was asked; extending
 * it to the off-season of every forward year is a one-line change here,
 * not an inference to make on her behalf.
 */
export const CONTRACTOR_OFF_SEASON_FACTOR = 0.5;
export const CONTRACTOR_OFF_SEASON_YEAR = 2027;
export const CONTRACTOR_OFF_SEASON_MONTHS: readonly number[] = [1, 2, 3, 4];

/** 0.5 in the months the ruling covers, 1 everywhere else. */
export function benchSeasonFactor(year: number, month: number): number {
  return year === CONTRACTOR_OFF_SEASON_YEAR && CONTRACTOR_OFF_SEASON_MONTHS.includes(month)
    ? CONTRACTOR_OFF_SEASON_FACTOR
    : 1;
}

/**
 * Cooper's content work for a month, the marketing bucket's share of the
 * bench. Scales with the fleet, starts July 2026, and runs full every
 * month: the 2027 off-season half (benchSeasonFactor) stays on the
 * Contractors line and does not follow him here (Dotti, 2026-11-07). Paid
 * from the operating account, so a card-only ACT month adds it to the
 * measured card marketing rather than reading it as $0.
 */
export function creativeCost(year: number, month: number, activeCount: number): number {
  const start = year === 2026 ? MARKETING_CREATIVE_START_MONTH_2026 : 1;
  if (month < start) return 0;
  return MARKETING_CREATIVE_MONTHLY * (activeCount / CONTRACTOR_FIELD_PROP_COUNT);
}

/**
 * Everyone else on the 1099 bench, Nicole Whitten, Ian Drometer, handymen,
 * one-off trades. Lumpy but persistent across the whole 24-month file:
 * ~$250/mo blended. Nicole alone took $2,400 on 2026-08-11, so single
 * months run well above this.
 */
export const CONTRACTOR_MISC_MONTHLY = 250;

/**
 * Total contractor cost for a month: field labor through October 2026,
 * then the misc blend alone. Cooper is creativeCost (marketing) and the
 * listing shoot is ONBOARDING_PHOTO_COST (onboarding) since 2026-11-07.
 *
 * @param month        1-12
 * @param year         forecast year
 * @param activeCount  properties producing this month
 * @param seasonShare  this month's share of the Cape Ann annual curve
 */
export function contractorCost(
  year: number,
  month: number,
  activeCount: number,
  seasonShare: number,
): number {
  // 2026 is the ramp year: nothing before the bench actually started.
  const fieldStart = year === 2026 ? CONTRACTOR_FIELD_START_MONTH_2026 : 1;

  // The field contractor joined payroll on 2026-11-01 (see payrollCost): the
  // per-job line ends in October 2026 and never returns.
  let field = 0;
  if (month >= fieldStart && !onPayroll(year, month)) {
    const scale = activeCount / CONTRACTOR_FIELD_PROP_COUNT;
    field = CONTRACTOR_FIELD_ANNUAL * seasonShare * scale;
  }
  const misc = CONTRACTOR_MISC_MONTHLY;
  return (field + misc) * benchSeasonFactor(year, month);
}

/* --------------------------------------------------------------------- */
/* Payroll: the operations manager                                        */
/* --------------------------------------------------------------------- */

/**
 * One salaried hire, on a DATE, never on a headcount.
 *
 * The plan once put a $5K/mo body in August 2026 and a second at 20 homes.
 * The first became the 1099 bench instead and the second was a step:
 * whichever home happened to be the twentieth dragged $20K of hire in
 * behind it and read as a loss, so both were dropped on 2026-09-06 and
 * people cost scaled linearly with the fleet through the bench.
 *
 * The hire that did happen is dated. The field contractor (Delaney Jordan)
 * joins payroll as Operations Manager on 2026-11-01 at $70,000 (raised
 * from $65,000 on 2026-10-19 to cover her own health coverage), and the
 * field-labor line above ends the month before: the same person, the same
 * work, paid as salary instead of per job. The salary is flat and does not
 * scale with the fleet; the creative and misc bench still does.
 *
 * Employer cost on top of the salary, per month:
 *   - payroll taxes at 8.1%: FICA 7.65% on every dollar, plus about $300
 *     a year of FUTA ($42 on the first $7,000) and MA unemployment (on the
 *     first $15,000), blended flat over the year. In cash those two land in
 *     the first months of each year. Was 9% until 2026-11-04;
 *   - the Gusto platform fee, $92 (Plus plan, one person, reactivated
 *     2026-11-03);
 *   - the $50 phone allowance in the offer letter.
 * Mileage (IRS rate, reimbursed as driven) and summer overtime are not
 * modeled; ACT months carry them as they are paid.
 *
 * Workers comp is NOT in here. It was a 4% placeholder until the AmTrust
 * policy was bound, and now sits on the Insurance line on its real
 * installment dates (workersCompCost below).
 *
 * ACT months read the Gusto debits (NET + TAX + FEE) from overhead_expenses,
 * which is gross wages plus employer taxes plus the fee: the same shape as
 * the projection.
 */
export const SALARY_ANNUAL = 70000;
export const SALARY_START_YEAR = 2026;
export const SALARY_START_MONTH = 11;
export const SALARY_EMPLOYER_TAX_RATE = 0.081;
export const PAYROLL_PLATFORM_MONTHLY = 92;
export const PHONE_ALLOWANCE_MONTHLY = 50;

/** True from the operations manager's first month on payroll. */
export function onPayroll(year: number, month: number): boolean {
  return year > SALARY_START_YEAR || (year === SALARY_START_YEAR && month >= SALARY_START_MONTH);
}

/** Employer cost of the salaried operations manager for a month; $0 before the hire. */
export function payrollCost(year: number, month: number): number {
  if (!onPayroll(year, month)) return 0;
  return (
    (SALARY_ANNUAL / 12) * (1 + SALARY_EMPLOYER_TAX_RATE) +
    PAYROLL_PLATFORM_MONTHLY +
    PHONE_ALLOWANCE_MONTHLY
  );
}

/**
 * Workers compensation for the operations manager. AmTrust (Wesco) policy
 * WWC3900538, bound through EPIC for 2026-11-01 to 2027-11-01: class 9015 on
 * $77,000 of estimated payroll, $1,966 for the year ($1,884 premium plus the
 * $82 Massachusetts DIA assessment). It is paid on AmTrust's installment
 * plan, so it is projected on the months the money leaves rather than spread
 * evenly: $274 down in November (due 11/17), then $188 on the 1st of January
 * through September. December and October carry nothing. Each November
 * renewal is assumed at the same price on the same plan.
 *
 * Not modeled: the per-installment charge ($3 on AutoPay, $15 on a mailed
 * invoice), and the year-end audit, which re-rates the premium on actual
 * payroll and adds the pay of any 1099 subcontractor without a workers comp
 * certificate on file.
 *
 * It rides the Insurance line because that is where the categorizer files
 * an AmTrust debit, so projected and measured months have the same shape.
 */
export const WORKERS_COMP_DOWN_PAYMENT = 274;
export const WORKERS_COMP_INSTALLMENT = 188;
/** The last month (1-12) an installment is due; the first is January. */
export const WORKERS_COMP_LAST_INSTALLMENT_MONTH = 9;
export const WORKERS_COMP_RENEWAL_MONTH = 11;

/** Workers comp paid in a month; $0 before the hire. */
export function workersCompCost(year: number, month: number): number {
  if (!onPayroll(year, month)) return 0;
  if (month === WORKERS_COMP_RENEWAL_MONTH) return WORKERS_COMP_DOWN_PAYMENT;
  if (month <= WORKERS_COMP_LAST_INSTALLMENT_MONTH) return WORKERS_COMP_INSTALLMENT;
  return 0;
}

export const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/** True while the dumpster is still under contract: through November 2026. */
export function hasDumpster(year: number, month: number): boolean {
  return year < DUMPSTER_LAST_YEAR || (year === DUMPSTER_LAST_YEAR && month <= DUMPSTER_LAST_MONTH);
}

/** Projected dumpster cost for a month; $0 once the service has ended. */
export function dumpsterCost(year: number, month: number): number {
  return hasDumpster(year, month) ? DUMPSTER_MONTHLY : 0;
}

/** Rent alone for a month: the operating-account half of the Office line. */
export function rentCost(year: number, month: number, startMonth: number): number {
  if (month < startMonth) return 0;
  if (year < 2026 || (year === 2026 && month < 7)) return OFFICE_BASE_RENT_MONTHLY;
  if (year === 2026 && month === 7) return OFFICE_BASE_RENT_MONTHLY + 80;
  return OFFICE_RENT_MONTHLY;
}

/**
 * Office cost for a month: rent from the lease start, plus the dumpster
 * while Republic Services is still under contract (through 2026-11).
 */
export function officeCost(year: number, month: number, startMonth: number): number {
  if (month < startMonth) return 0;
  return rentCost(year, month, startMonth) + dumpsterCost(year, month);
}

/**
 * Bookkeeper cost for a given month under a given year config. Returns
 * the regular retainer through the wrap-up month, the larger final
 * payment in that month, and zero after.
 */
export function bookkeeperCost(month: number, lastMonth: number | null): number {
  if (lastMonth == null) return 0; // engagement already ended (e.g. 2027)
  if (month < lastMonth) return BOOKKEEPER_MONTHLY;
  if (month === lastMonth) return BOOKKEEPER_FINAL_AMOUNT;
  return 0;
}

/**
 * Per-year configuration. `getYearConfig(2026)` returns the seventeen homes
 * that filed 2026 statements (CURRENT_2026) plus N new from the slider, with
 * the bookkeeper through May, the office from March and the operations
 * manager on payroll from November.
 * `getYearConfig(2027)` and 2028 return that roster minus any home the
 * operating windows have offline for the whole year (14 today), plus the
 * rolled-forward synthetics at the fleet average fee, plus N new spread
 * across the year, no bookkeeper and the office all year. People cost is the
 * bench, scaled to the fleet, plus the flat salary from 2026-11 (payrollCost).
 */
export type YearConfig = {
  year: ForecastYear;
  /** Properties already producing revenue this year. */
  current: ManagedProperty[];
  /** Properties signed but onboarding mid-year. Empty in 2027. */
  presigned: ManagedProperty[];
  /** Order in which the slider adds new properties this year. */
  newOrder: readonly number[];
  /** Last month bookkeeper retainer is paid (1-12), or null if engagement ended. */
  bookkeeperLastMonth: number | null;
  /** First month office rent kicks in (1 if continuous from prior year). */
  officeStartMonth: number;
};

/**
 * @param year         which year config to return
 * @param rolledForward count of "new" properties added in PRIOR years that
 *                      should appear as full-year actives in this year. e.g.
 *                      if user adds 4 new in 2026, then for 2027:
 *                      rolledForward = 4. For 2028: rolledForward = 4 +
 *                      whatever was added in 2027.
 */
export function getYearConfig(
  year: ForecastYear,
  rolledForward: number = 0,
  openIn?: OpenInYear,
  /**
   * Annual fee a home in its second season or later is assumed to earn:
   * the fleet's projected average per earning home, from the smart forecast.
   * Omitted (the pure check scripts, or smart unavailable) it falls back to
   * NEW_PROPERTY_FEE, and it is never allowed below that first-year figure.
   */
  matureFee?: number,
  /**
   * The homes that cost money this year, built from Helm's registry by
   * forecast-roster.ts. Omitted (the pure check scripts, or smart
   * unavailable) the hardcoded CURRENT_2026 stands in, which is exactly the
   * roster the cost lines scaled on before the registry fed them.
   */
  roster?: ManagedProperty[],
): YearConfig {
  if (year === 2026) {
    // 2026 is the starting year; nothing to roll forward into it.
    return {
      year: 2026,
      current: roster ?? CURRENT_2026,
      presigned: PRESIGNED_2026,
      newOrder: NEW_ORDER_2026,
      bookkeeperLastMonth: 5,
      officeStartMonth: 3,
    };
  }

  // Synthesize the rolled-forward properties as CA contracts active from
  // January 1 of the given year, in their second season or later, so at the
  // fleet's average fee rather than the first-year $25K.
  const rolledFee =
    matureFee != null && Number.isFinite(matureFee) ? Math.max(NEW_PROPERTY_FEE, matureFee) : NEW_PROPERTY_FEE;
  const synth: ManagedProperty[] = Array.from({ length: rolledForward }, (_, i) => ({
    name: `Rolled fwd #${i + 1}`,
    fee: rolledFee,
    type: NEW_PROPERTY_TYPE,
    start: 1,
    synthetic: true,
  }));

  if (year === 2027) {
    return {
      year: 2027,
      current: [...rosterFor(2027, openIn, roster), ...synth],
      presigned: [],
      newOrder: NEW_ORDER_2027,
      bookkeeperLastMonth: null,
      officeStartMonth: 1,
    };
  }

  // 2028 — same 14-property baseline as 2027 plus all rollovers.
  return {
    year: 2028,
    current: [...rosterFor(2028, openIn, roster), ...synth],
    presigned: [],
    newOrder: NEW_ORDER_2028,
    bookkeeperLastMonth: null,
    officeStartMonth: 1,
  };
}

export type MonthRow = {
  month: number;
  /** Revenue from the 9 current properties this month. */
  rev_current: number;
  /** Revenue from the 3 pre-signed contracts this month. */
  rev_presigned: number;
  /** Revenue from the N hypothetical new properties this month. */
  rev_new: number;
  /**
   * Expected management fee lost to contracts that may end, zero or
   * negative: each home's projected fee times the chance it ends, from the
   * month it would be gone. Zero on a measured month.
   */
  rev_ending: number;
  /** All revenue combined. */
  rev_total: number;

  /** Office rent from March 2026, plus the dumpster through November 2026 (service ends 2026-11-30). */
  exp_office: number;
  /** Software subscriptions on the corporate card (Guesty, Anthropic, PriceLabs, QuickBooks, Adobe, Quo, AirDNA, Squarespace, Vercel, Supabase and the smaller tools). */
  exp_software: number;
  /** MH Partners debt service. */
  exp_debt: number;
  /** Insurance: Phillips, an annual lump in March, plus the workers comp installments from 2026-11. */
  exp_insurance: number;
  /** Accounting (MS Consultants), smoothed monthly. */
  exp_accounting: number;
  /** Bank fees, stop payments, returned checks. */
  exp_bank: number;
  /** The corporate card, less software and one-time insurance premiums. */
  exp_cc_ops: number;
  /**
   * exp_cc_ops itemised into the six Recurring Monthly buckets. Measured for
   * an ACT month with card detail, the model's own terms for a projected
   * month, null for an ACT month known only through a card payoff (the UI
   * then splits exp_cc_ops by the CC_OPERATING_BREAKDOWN weights).
   */
  cc_detail: CardDetail | null;
  /**
   * 1099 contractor bench: field labor through 2026-10, then the misc blend
   * (handymen, one-off trades). Cooper's content work is in the marketing
   * bucket of cc_detail and the listing shoot is in the onboarding charge,
   * both since 2026-11-07.
   */
  exp_contractors: number;
  /**
   * The salaried operations manager from 2026-11: salary, employer taxes,
   * the Gusto fee and the phone allowance. Workers comp is on exp_insurance.
   * $0 before the hire. Flat; it does not scale with the fleet.
   */
  exp_payroll: number;
  /** ONBOARDING_COST for each pre-signed contract in its start month (2026 only). */
  exp_onboard_presigned: number;
  /**
   * ONBOARDING_COST for each slider home in its start month: outfitting plus
   * the listing shoot. A measured month carries the shoot the card paid
   * (Lightshed); its linens and durables sit in Guest supplies.
   */
  exp_onboard_new: number;
  /** Sum of all the above. */
  exp_total: number;

  /** Revenue minus business expenses — the bottom line for this model. */
  net_business: number;

  /**
   * True when this row's numbers are actual bank-derived data (a past
   * month with a complete record) rather than the model's projection.
   */
  is_actual: boolean;
  /**
   * True for an ACT month the operating-account export has not reached:
   * the card lines are measured and the operating lines (rent, the bench,
   * payroll, the bookkeeper, bank fees) are the model's own terms for the
   * month. The table badges such a column so a reader knows which half is
   * the bank.
   */
  actual_card_only: boolean;

  /** Count of properties active and producing this month. */
  active_count: number;
};

export type YearResult = {
  monthly: MonthRow[];
  /** Cumulative net business income at the end of each month. */
  cumulative: number[];
  /** Months in which a new property comes online (1-12). */
  newStartMonths: number[];
  totals: {
    rev_current: number;
    rev_presigned: number;
    rev_new: number;
    rev_ending: number;
    rev_total: number;
    exp_total: number;
    net_business: number;
  };
};

/** Optional actuals override for past months. Index = month - 1. */
export type ActualsByMonth = ReadonlyArray<{
  month: string; // YYYY-MM
  revenue: number;
  exp_office: number;
  exp_software: number;
  exp_debt: number;
  exp_insurance: number;
  exp_accounting: number;
  exp_bank: number;
  exp_cc_ops: number;
  exp_contractors: number;
  exp_payroll: number;
  exp_onboard_presigned: number;
  exp_onboard_new: number;
  /** Card itemisation; absent or null when the month has no category detail. */
  cc_detail?: CardDetail | null;
  /** False when the operating export has not reached the month; see forecast-actuals.ts. */
  operating_covered?: boolean;
}>;

/**
 * Optional forward-month override sourced from the Smart Forecast (Guesty
 * bookings × Gloucester pacing × per-property mgmt fee). When provided,
 * the model uses these numbers for rev_current+rev_presigned in forward
 * months instead of the seasonality heuristic. rev_new from the slider
 * still adds on top.
 *
 * Map: month-of-year (1-12) → total RT mgmt fee for that month across
 * all properties already on Guesty.
 */
export type SmartForwardOverride = ReadonlyMap<number, number>;

/**
 * Compute the 12-month forecast for a given year and count of hypothetical
 * new properties. `numNew` is clamped to [0, length of that year's
 * newOrder array].
 *
 * `actuals` (optional): when provided alongside `actualsThroughMonth`, the
 * model substitutes real bank-derived values for months 1..actualsThroughMonth
 * and projects from `actualsThroughMonth + 1` onward. The substituted
 * MonthRow has `is_actual: true`.
 */
export function calcYear(
  numNew: number,
  year: ForecastYear = 2026,
  actuals?: ActualsByMonth,
  actualsThroughMonth?: number,
  smartOverride?: SmartForwardOverride,
  /**
   * Multiplier applied to seasonality-derived rev_current. Used to forward
   * a calibration learned from a prior year's Smart Forecast — e.g., 2027
   * passes a factor of ~1.3 so the conservative contracted annual fees
   * scale up to what real listings actually earn. Only applies to months
   * computed via seasonality (not smart override or actuals).
   */
  calibrationFactor?: number,
  /**
   * Properties added as "new" in any PRIOR year, rolled forward as
   * full-year actives. For 2027 = numNew added in 2026. For 2028 =
   * numNew added in 2026 + numNew added in 2027.
   */
  rolledForward?: number,
  /**
   * Per-month expected mgmt fee from the live Prospects pipeline (Helm's
   * projections table, weighted by each prospect's close_likelihood_pct).
   * Replaces the old hard-coded PRESIGNED_2026 contribution. 12 numbers,
   * one per month (Jan…Dec) of the forecast year.
   */
  prospectsMonthly?: readonly number[],
  /**
   * Statement-derived revenue actual for months that have been reconciled
   * in Helm's Statements module. Keys are month-of-year (1..12), values
   * are total mgmt fee across all properties for that month. When set
   * for a month, the row is marked is_actual=true, rev_current is
   * replaced, rev_presigned + rev_new go to zero, and expenses stay as
   * the model projects. Bank-derived ACTUALS overrides this when both
   * are present for the same month.
   */
  statementRevenueByMonth?: ReadonlyMap<number, number>,
  /**
   * Operating-window predicate from forecast-operating-windows.ts. Drops
   * homes offline for the whole year from the roster, so activeCount and
   * the seasonality fallback stop counting them. Omitted by the pure check
   * scripts, which then see the full roster.
   */
  openIn?: OpenInYear,
  /** Second-season fee for rolled-forward homes; see getYearConfig. */
  matureFee?: number,
  /** The registry-built cost roster; see getYearConfig. */
  roster?: ManagedProperty[],
  /** Contracts that may end; see ContractEndingInputs. Omitted, every home stays. */
  endings?: ContractEndingInputs,
): YearResult {
  const config = getYearConfig(year, rolledForward ?? 0, openIn, matureFee, roster);
  const maxNew = config.newOrder.length;
  const n = Math.max(0, Math.min(maxNew, Math.round(numNew)));
  const newStartMonths: number[] = config.newOrder.slice(0, n);
  const useActualsThrough = actuals && actualsThroughMonth ? actualsThroughMonth : 0;

  const monthly: MonthRow[] = [];
  for (let m = 1; m <= 12; m++) {
    // ─── Past month: use bank-derived actuals ──────────────────────────
    if (m <= useActualsThrough && actuals && actuals[m - 1]) {
      const a = actuals[m - 1];
      // Active count for actuals month: derived from config so it matches
      // the rest of the table; useful for diagnostics even when expense
      // values are frozen from the bank.
      let activeForActual = 0;
      for (const p of config.current) if (m >= p.start) activeForActual += 1;
      for (const p of config.presigned) if (m >= p.start) activeForActual += 1;

      // A month the operating-account export has not reached carries only
      // what the card paid. Reading its rent, bench and payroll as $0 would
      // make the month look better than any real month could, so those
      // lines take the model's own terms for the month, exactly as a
      // forward month would, on the homes operating in it. Every measured
      // figure on such a month is card-sourced (that is what uncovered
      // means), so the card's dumpster, Arbella and Lightshed charges are
      // added to the projected rent, Phillips, workers comp and operating
      // bench rather than replacing them.
      const cardOnly = a.operating_covered === false;
      let opCount = activeForActual;
      if (cardOnly && (openIn || endings)) {
        for (const p of config.current) {
          if (m < p.start || !p.id) continue;
          if (openIn && !openIn(p.id, year, m)) opCount -= 1;
          else if (endings) opCount -= 1 - endings.keep(p.id, year, m);
        }
      }
      const exp_office = cardOnly ? a.exp_office + rentCost(year, m, config.officeStartMonth) : a.exp_office;
      const exp_debt = cardOnly ? bookkeeperCost(m, config.bookkeeperLastMonth) : a.exp_debt;
      const exp_insurance = cardOnly
        ? a.exp_insurance + (m === INSURANCE_MONTH ? INSURANCE_ANNUAL : 0) + workersCompCost(year, m)
        : a.exp_insurance;
      const exp_accounting = cardOnly ? accountingCost(year, m) : a.exp_accounting;
      const exp_bank = cardOnly ? BANK_FEES_MONTHLY : a.exp_bank;
      const exp_contractors = cardOnly
        ? a.exp_contractors + contractorCost(year, m, opCount, SEASON.CA[m - 1])
        : a.exp_contractors;
      const exp_payroll = cardOnly ? payrollCost(year, m) : a.exp_payroll;
      // Cooper is paid from the operating account and filed under marketing,
      // so a card-only month adds his projected term to the measured card
      // marketing, in the bucket and in the total it sums to.
      const creative = cardOnly ? creativeCost(year, m, opCount) : 0;
      const exp_cc_ops = a.exp_cc_ops + creative;
      const cc_detail: CardDetail | null =
        a.cc_detail && creative ? { ...a.cc_detail, marketing: a.cc_detail.marketing + creative } : (a.cc_detail ?? null);

      const exp_total =
        exp_office +
        a.exp_software +
        exp_debt +
        exp_insurance +
        exp_accounting +
        exp_bank +
        exp_cc_ops +
        exp_contractors +
        exp_payroll +
        a.exp_onboard_presigned +
        a.exp_onboard_new;

      monthly.push({
        month: m,
        rev_current: a.revenue, // attribute everything to current portfolio
        rev_presigned: 0,
        rev_new: 0,
        rev_ending: 0,
        rev_total: a.revenue,
        exp_office,
        exp_software: a.exp_software,
        exp_debt,
        exp_insurance,
        exp_accounting,
        exp_bank,
        exp_cc_ops,
        cc_detail,
        exp_contractors,
        exp_payroll,
        exp_onboard_presigned: a.exp_onboard_presigned,
        exp_onboard_new: a.exp_onboard_new,
        exp_total,
        net_business: a.revenue - exp_total,
        is_actual: true,
        actual_card_only: cardOnly,
        active_count: activeForActual,
      });
      continue;
    }

    // ─── Future month: project from the model ──────────────────────────
    const i = m - 1;
    const dist = { CA: SEASON.CA[i], FL: SEASON.FL[i], LS: SEASON.LS[i] };

    // If we have a Smart Forecast value for this month, that becomes
    // rev_current — booked + projected from real Guesty data, with each
    // property's actual mgmt fee. Pre-signed contracts run through
    // seasonality regardless: they aren't in Guesty until they actually
    // onboard, so smart forecast can't see them yet. If a presigned shows
    // up in Guesty later, it'll start contributing through smart and the
    // model will overcount — flag for review when that happens.
    const smartFee = smartOverride?.get(m);
    const useSmart = smartFee != null && smartFee > 0;

    let rev_current = 0;
    let rev_presigned = 0;
    let rev_new = 0;
    let rev_ending = 0;

    if (useSmart) {
      // Smart Forecast owns the real fleet. Presigned + new remain on
      // seasonality because they aren't in Guesty yet, and so do the
      // hypotheticals rolled forward from a prior year's slider: they are in
      // no Guesty listing either, so smart cannot see them. They used to be
      // dropped here while still counting toward activeCount, so a rolled
      // forward property cost money in 2027 and earned nothing.
      rev_current = smartFee;
      for (const p of config.current) {
        if (p.synthetic && m >= p.start) rev_current += p.fee * dist[p.type];
      }
      // The loss is read off the same smart months as rev_current, so a
      // home's row in the per-property table and its share here agree.
      const loss = endings?.lossByMonth?.[i] ?? 0;
      if (loss > 0) rev_ending = -loss;
    } else {
      // No smart data — fall back to seasonality for current too.
      for (const p of config.current) {
        if (m >= p.start) rev_current += p.fee * dist[p.type];
        if (endings && p.id && !p.synthetic && m >= p.start) {
          rev_ending -= p.fee * dist[p.type] * (1 - endings.keep(p.id, year, m));
        }
      }
      // Apply forward-year calibration if we learned one from a prior
      // year's smart forecast.
      if (calibrationFactor && calibrationFactor > 0 && calibrationFactor !== 1) {
        rev_current *= calibrationFactor;
        rev_ending *= calibrationFactor;
      }
    }
    // Prospects pipeline: per-month expected mgmt fee, weighted by each
    // prospect's close_likelihood_pct. When the live feed isn't available
    // (no Supabase config, table empty), falls back to the (now empty)
    // config.presigned seasonality calc.
    if (prospectsMonthly && prospectsMonthly[i] != null) {
      rev_presigned = prospectsMonthly[i];
    } else {
      for (const p of config.presigned) {
        if (m >= p.start) rev_presigned += p.fee * dist[p.type];
      }
    }
    // N new (slider) properties: always seasonality (hypothetical).
    for (const start of newStartMonths) {
      if (m >= start) rev_new += NEW_PROPERTY_FEE * SEASON[NEW_PROPERTY_TYPE][i];
    }

    // Statement actual override: a fully-reconciled month replaces the
    // projected revenue lines with the real sum-of-management-fees from
    // property_statements. Expenses stay projected because statements
    // don't carry RT's operating costs.
    const stmtRevenue = statementRevenueByMonth?.get(m);
    const isStatementActual = stmtRevenue != null && stmtRevenue > 0;
    if (isStatementActual) {
      rev_current = stmtRevenue;
      rev_presigned = 0;
      rev_new = 0;
      rev_ending = 0;
    }

    const rev_total = rev_current + rev_presigned + rev_new + rev_ending;

    // Count contracts whose start month equals this month → multiply by
    // the per-contract onboarding cost. This handles the case where two
    // pre-signeds land the same month (e.g. May 2026 has two starts).
    const presignedStartCount = config.presigned.filter((p) => p.start === m).length;
    const newStartCount = newStartMonths.filter((s) => s === m).length;

    // Roster count this month: every home on the books, open or not. Feeds
    // active_count (the Managed at year-end figure); costs scale on the
    // operating count below.
    let activeCount = 0;
    for (const p of config.current) if (m >= p.start) activeCount += 1;
    for (const p of config.presigned) if (m >= p.start) activeCount += 1;
    for (const start of newStartMonths) if (m >= start) activeCount += 1;

    // Homes actually operating THIS month: the roster count minus any real
    // home whose operating window has it closed (4 Brier Neck after August
    // 2026, 73 Rocky Neck from November, 79 Main from late October, 16
    // Waterman outside May to October). The card and the bench, which is
    // the whole people line, scale on this. A home whose contract may end
    // counts for the share of it expected to stay, so a home half expected
    // to leave costs half, the same expectation its revenue carries.
    let operatingCount = activeCount;
    if (openIn || endings) {
      for (const p of config.current) {
        if (m < p.start || !p.id) continue;
        if (openIn && !openIn(p.id, year, m)) operatingCount -= 1;
        else if (endings) operatingCount -= 1 - endings.keep(p.id, year, m);
      }
    }

    const exp_office = officeCost(year, m, config.officeStartMonth);
    const exp_software = softwareCost(year, m);
    const exp_debt = bookkeeperCost(m, config.bookkeeperLastMonth);
    const exp_insurance = (m === INSURANCE_MONTH ? INSURANCE_ANNUAL : 0) + workersCompCost(year, m);
    const exp_accounting = accountingCost(year, m);
    const exp_bank = BANK_FEES_MONTHLY;
    const cc_detail = ccOperatingDetail(operatingCount, year, m);
    const exp_cc_ops = ccOperatingCost(operatingCount, year, m);
    const exp_contractors = contractorCost(year, m, operatingCount, dist.CA);
    const exp_payroll = payrollCost(year, m);
    const exp_onboard_presigned = presignedStartCount * ONBOARDING_COST;
    const exp_onboard_new = newStartCount * ONBOARDING_COST;
    const exp_total =
      exp_office +
      exp_software +
      exp_debt +
      exp_insurance +
      exp_accounting +
      exp_bank +
      exp_cc_ops +
      exp_contractors +
      exp_payroll +
      exp_onboard_presigned +
      exp_onboard_new;

    const net_business = rev_total - exp_total;

    monthly.push({
      month: m,
      rev_current,
      rev_presigned,
      rev_new,
      rev_ending,
      rev_total,
      exp_office,
      exp_software,
      exp_debt,
      exp_insurance,
      exp_accounting,
      exp_bank,
      exp_cc_ops,
      cc_detail,
      exp_contractors,
      exp_payroll,
      exp_onboard_presigned,
      exp_onboard_new,
      exp_total,
      net_business,
      is_actual: isStatementActual,
      actual_card_only: false,
      active_count: activeCount,
    });
  }

  let running = 0;
  const cumulative = monthly.map((r) => {
    running += r.net_business;
    return running;
  });

  const sum = (k: keyof MonthRow) => monthly.reduce((a, r) => a + (r[k] as number), 0);

  return {
    monthly,
    cumulative,
    newStartMonths: [...newStartMonths],
    totals: {
      rev_current: sum('rev_current'),
      rev_presigned: sum('rev_presigned'),
      rev_new: sum('rev_new'),
      rev_ending: sum('rev_ending'),
      rev_total: sum('rev_total'),
      exp_total: sum('exp_total'),
      net_business: sum('net_business'),
    },
  };
}

const FMT_OPTS: Intl.NumberFormatOptions = {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
};

/**
 * Format as `$1,234` or `($1,234)` for negatives. Whole dollars, no
 * cents, no $K compaction — round to the nearest dollar for legibility.
 */
export function fmtDollar(n: number): string {
  const abs = Math.abs(n).toLocaleString('en-US', FMT_OPTS);
  return n < 0 ? `($${abs})` : `$${abs}`;
}

/**
 * Format with thousands separators, no dollar sign. Whole dollars only.
 * Negatives use parentheses. Used in the Monthly Detail table cells.
 */
export function fmtNum(n: number): string {
  const abs = Math.abs(n).toLocaleString('en-US', FMT_OPTS);
  return n < 0 ? `(${abs})` : abs;
}

/** Format as `$1.2K` for compact display. */
export function fmtCompact(n: number): string {
  const k = Math.round(n / 100) / 10;
  const sign = n >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(k)}K`;
}
