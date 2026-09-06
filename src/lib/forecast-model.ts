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
function rosterFor(year: number, openIn?: OpenInYear): ManagedProperty[] {
  if (!openIn) return ACTIVE_2027;
  return ACTIVE_2027.filter((p) => !p.id || openIn(p.id, year));
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
 * Onboarding cost per contract. Set to $0: the supplies and inventory
 * bought to set up a new unit are already captured in the Guest supplies
 * & inventory line — that trailing-12-month figure includes onboarding
 * purchases, and the extrapolation carries them forward. Charging a
 * separate per-contract amount would double-count.
 */
export const ONBOARDING_COST = 0;

/* --------------------------------------------------------------------- */
/* Recurring monthly expenses, calibrated to Chase ...5130 actuals       */
/* (Apr 2025 → Apr 2026, 12-mo window). See forecast-actuals.ts.         */
/* --------------------------------------------------------------------- */

/** Office rent at 85 Eastern Ave. Confirmed: 3 ACHs of $750 in 2026. */
export const OFFICE_RENT_MONTHLY = 750;
/**
 * The office dumpster: Republic Services, billed to the card and filed as
 * Rent & office. Nothing on the card before April 2026, when the office
 * opened. Then $165 on 04-30, 05-27 and 06-14, no July charge, and $471 on
 * 2026-08-14: $966 over the five months since service began, $193/mo.
 *
 * The August charge does not say what it covers. Read as July and August
 * together it is a raised rate of about $235; read as a quarter it is $157.
 * The mean since service began is the figure carried until a September
 * charge settles it. It was $50 flat until 2026-09-06, a number no bank row
 * had ever shown, while the real charges read as Travel & other because a
 * card row filed under Rent & office had no route to the Office line.
 * routeCardRow sends them here now, so ACT months and projected months
 * describe the same shape.
 */
export const DUMPSTER_MONTHLY = 193;
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
 * July and August ran above this constant on Anthropic API credits alone:
 * $1,081 and $1,589 of prepaid reloads for the guest-messaging responder,
 * against under $300 in any earlier month. The operator ruled those two
 * months a one-off on 2026-09-02, so the constant is NOT raised. The steady
 * stack without API usage (Guesty about $1,200 and drifting up per listing,
 * PriceLabs $220, Claude seats $234, everything else about $550) comes to
 * roughly $2,200, which this figure already covers.
 */
export const SOFTWARE_MONTHLY = 2300;

export function softwareCost(_year: number, _month: number): number {
  return SOFTWARE_MONTHLY;
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
 * no recurring monthly premium.
 */
export const INSURANCE_ANNUAL = 5264;
export const INSURANCE_MONTH = 3;

/**
 * Accounting (MS Consultants). The Aug 2026 rerack modeled this as an
 * annual April lump because the bank showed two hits, $4,156.62 on
 * 2025-01-13 and $4,442.96 on 2026-04-15, and read them as a tax-season
 * engagement that recurs. The operator ruled on 2026-09-02 that MS
 * Consultants was a one-off, so nothing projects forward: $0 in every
 * month of 2027 and 2028. The April 2026 hit is kept for the seasonality
 * path only, and that month is an ACT month carrying the real charge.
 * Do not reinstate the annual lump on the strength of the 2025 payment
 * without asking; that evidence was already on the table when she ruled.
 */
export const ACCOUNTING_MONTHLY = 0;
export const ACCOUNTING_ANNUAL = 4450;
export const ACCOUNTING_MONTH = 4;
/** The one year the lump lands. Later years project $0. */
export const ACCOUNTING_YEAR = 2026;

export function accountingCost(year: number, month: number): number {
  if (year === ACCOUNTING_YEAR && month === ACCOUNTING_MONTH) return ACCOUNTING_ANNUAL;
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
 * VARIABLE: guest supplies and small repairs. Amazon, Fix Linens, Target,
 * hardware. Per live property per month in 2026:
 *
 *     Feb $236   Apr $872   May $858   Jun $1,492   Jul $1,009   Aug $729
 *
 * Least-squares against the Cape Ann curve pulled one month earlier and damped
 * to 60% amplitude gives $8,360 per property per year at R2 0.593. The
 * one-month lead is not a fitting trick: a house is stocked the month BEFORE
 * its guests arrive. The damping is, and it is there because six data points
 * from a year in which the fleet went from six properties to seventeen cannot
 * carry the full amplitude of a curve fitted to something else.
 *
 * Two shapes fit better on paper and were rejected. The revenue curve at a
 * one-month lead reaches R2 0.701 but puts September above August, an artifact
 * of Gloucester's own September/October inversion. The raw occupancy curve is
 * physically tidier and fits worse, at R2 0.157.
 */
export const CC_SUPPLY_ANNUAL_PER_PROP = 8360;

/** Cape Ann turnovers, pulled one month earlier and damped to 60%. */
const CC_SUPPLY_RAW = SEASON.CA.map((_, i) => 0.6 * SEASON.CA[(i + 1) % 12] + 0.4 / 12);
export const CC_SUPPLY_SEASON: number[] = normalize(CC_SUPPLY_RAW);

/** GEICO auto. $518.35 to $518.81 every month of 2026, unchanged since Mar 2025. */
export const CC_VEHICLE_INSURANCE_MONTHLY = 519;
/** AT&T. Five charges April onward, nothing before. */
export const CC_TELECOM_MONTHLY = 114;
/**
 * Flights, car rental, fuel, meals. Averaged over the whole card record rather
 * than 2026 alone: November 2025 was $3,600 by itself and a 2026-only mean
 * understates the line three-fold.
 */
export const CC_TRAVEL_MONTHLY = 175;
/** The residual Other bucket once the identifiable lines are pulled out. */
export const CC_ADMIN_MONTHLY = 110;
/**
 * Furnished Finder, once a year. VRBO is deliberately NOT here: it is a
 * channel commission already netted out of rental revenue, categorised
 * 'Pass-through', and counted in no expense total.
 */
export const CC_LISTING_ANNUAL = 199;
export const CC_LISTING_MONTH = 8;

/**
 * Marketing, and the cut that really did happen.
 *
 * $173 / $526 / $1,111 / $757 / $832 for January to May, then $333, $33, $164
 * for June, July and August. The model originally claimed this cut and #1382
 * removed it as unverifiable, because card detail stopped on 2026-06-06. The
 * statement now covers those months and the cut is plainly there. It is a step
 * down to roughly $175, not the drop to zero the first version assumed.
 */
export const CC_MARKETING_MONTHLY = 680;
export const CC_MARKETING_POST_CUT_MONTHLY = 175;
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
 * Of the per-property variable spend, the slice that is hardware, plumbing
 * and propane rather than linens and consumables. Measured on the 2026 card
 * and operating rows through August: $3,142 of Repairs & upkeep against
 * $58,298 of Guest supplies, 5.1%. An earlier itemisation put this at 20%,
 * which is how the Repairs row came to claim $1,660 a month the card never
 * showed.
 */
export const CC_REPAIRS_SHARE = 0.05;

/**
 * The card for one month, itemised the same way the ACT months are.
 *
 * Consumables and repairs scale with the fleet and the season; insurance,
 * telecom, travel and marketing are the fixed floor. Furnished Finder's
 * annual listing fee rides the marketing bucket in August. The six keys are
 * the six Recurring Monthly rows on /forecast, so a projected month and a
 * measured one describe the same shape and the table has no seam between
 * them.
 *
 * Elasticity is structural rather than a tuned coefficient: the variable
 * term is fully elastic by construction and the fixed term is not elastic
 * at all, so the blended figure falls out of the mix instead of being
 * asserted. Same shape as contractorCost, which already rides a curve and
 * scales with the fleet.
 */
export function ccOperatingDetail(
  activePropCount: number,
  year: number,
  month: number,
): CardDetail {
  const variable =
    CC_SUPPLY_ANNUAL_PER_PROP * (CC_SUPPLY_SEASON[month - 1] ?? 0) * activePropCount;
  return {
    supplies: variable * (1 - CC_REPAIRS_SHARE),
    repairs: variable * CC_REPAIRS_SHARE,
    vehicle_insurance: CC_VEHICLE_INSURANCE_MONTHLY,
    travel_other: CC_TRAVEL_MONTHLY + CC_ADMIN_MONTHLY,
    marketing: marketingCost(year, month) + (month === CC_LISTING_MONTH ? CC_LISTING_ANNUAL : 0),
    telecom: CC_TELECOM_MONTHLY,
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
    monthly: 7940,
    info: 'Amazon, Fix Linens, Target, HomeGoods. The dominant card line and the seasonal one: $236 per property in February against $1,492 in June. Bought the month before the guests arrive, which is why it leads the turnover curve. ACT months show the real card figure.',
  },
  {
    key: 'repairs',
    label: 'Repairs & upkeep',
    monthly: 420,
    info: 'Hardware stores, plumbing, propane and small contractor charges on the card. About 5% of the variable card spend, measured on 2026: $3,142 against $58,298 of supplies through August. Rides the same per-property seasonal curve as supplies.',
  },
  {
    key: 'vehicle_insurance',
    label: 'Vehicle & other insurance',
    monthly: 519,
    info: 'GEICO auto, $519 every month of 2026 and unchanged since March 2025, and that is the run rate forward. ACT months show the real GEICO charge. The $3,189 Arbella premium that hit the card on 2026-04-15 is a one-time payment and sits on the Insurance line below, beside Phillips, not in this row.',
  },
  {
    key: 'travel_other',
    label: 'Travel & other',
    monthly: 285,
    info: 'Flights, car rental, fuel, meals, the card\'s own interest charges, and the small remainder the categorizer could not name. Projected at $285/mo, averaged across the whole card record rather than 2026 alone, because one month (November 2025, $3,600) carries most of a year.',
  },
  {
    key: 'marketing',
    label: 'Marketing & advertising',
    monthly: 175,
    info: 'Facebook and Meta, plus occasional print, plus the $199 Furnished Finder listing each August. Ran $680/mo through May, then stepped down to roughly $175 from June. The cut is real and measured, not assumed.',
  },
  {
    key: 'telecom',
    label: 'Telecom',
    monthly: 114,
    info: 'AT&T. Five charges from April onward, nothing before it.',
  },
];

/* --------------------------------------------------------------------- */
/* 1099 contractors: the field + creative bench                          */
/* --------------------------------------------------------------------- */

/**
 * Field labor (Delaney Jordan and successors). Paid per job by Zelle out of
 * ...5130, not through Gusto, so it never touched the old payroll line and
 * the model carried it as $0 until this rerack.
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
 * Creative bench (Cooper). Paid $300/wk on the Chase "Basic Online Payroll"
 * rail from 2026-07-29, with occasional larger weeks, $2,300 through 08/25.
 * $1,300/mo at the 16-home calibration fleet, scaled to the live count:
 * content is per listing, so a bigger fleet is more shoots. It does not
 * ride the seasonality curve, because shoots are scheduled against the
 * content calendar rather than turnover volume.
 */
export const CONTRACTOR_CREATIVE_MONTHLY = 1300;
export const CONTRACTOR_CREATIVE_START_MONTH_2026 = 7;

/**
 * Everyone else on the 1099 bench, Nicole Whitten, Ian Drometer, handymen,
 * one-off trades. Lumpy but persistent across the whole 24-month file:
 * ~$250/mo blended. Nicole alone took $2,400 on 2026-08-11, so single
 * months run well above this.
 */
export const CONTRACTOR_MISC_MONTHLY = 250;

/**
 * Total contractor cost for a month.
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
  const creativeStart = year === 2026 ? CONTRACTOR_CREATIVE_START_MONTH_2026 : 1;

  let field = 0;
  if (month >= fieldStart) {
    const scale = activeCount / CONTRACTOR_FIELD_PROP_COUNT;
    field = CONTRACTOR_FIELD_ANNUAL * seasonShare * scale;
  }
  const creative =
    month >= creativeStart
      ? CONTRACTOR_CREATIVE_MONTHLY * (activeCount / CONTRACTOR_FIELD_PROP_COUNT)
      : 0;
  const misc = CONTRACTOR_MISC_MONTHLY;
  return field + creative + misc;
}

/**
 * There is no salaried-hire line.
 *
 * The plan once put a $5K/mo body in August 2026 and a second at 20 homes.
 * The first became the 1099 bench instead (Delaney from 2026-07-07, Cooper
 * from 2026-07-29), and the second was a step: whichever home happened to
 * be the twentieth dragged $20K of hire in behind it and read as a loss.
 * Decided 2026-09-06: people cost scales linearly with the fleet, which is
 * what the bench above already does, about $3,340 per home per year on
 * the 2026 calibration. Nothing here prices a body to run twenty-plus
 * homes who is not an owner; the model treats the owners' time as free
 * everywhere else too, so this is the consistent choice, not a hidden one.
 */

export const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

export function officeCost(month: number, startMonth: number): number {
  if (month < startMonth) return 0;
  return OFFICE_RENT_MONTHLY + DUMPSTER_MONTHLY;
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
 * the bookkeeper through May, the office from March and no salaried hire.
 * `getYearConfig(2027)` and 2028 return that roster minus any home the
 * operating windows have offline for the whole year (14 today), plus the
 * rolled-forward synthetics at the fleet average fee, plus N new spread
 * across the year, no bookkeeper and the office all year. No year carries a
 * salaried hire: people cost is the bench, scaled to the fleet.
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
): YearConfig {
  if (year === 2026) {
    // 2026 is the starting year; nothing to roll forward into it.
    return {
      year: 2026,
      current: CURRENT_2026,
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
      current: [...rosterFor(2027, openIn), ...synth],
      presigned: [],
      newOrder: NEW_ORDER_2027,
      bookkeeperLastMonth: null,
      officeStartMonth: 1,
    };
  }

  // 2028 — same 14-property baseline as 2027 plus all rollovers.
  return {
    year: 2028,
    current: [...rosterFor(2028, openIn), ...synth],
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
  /** All revenue combined. */
  rev_total: number;

  /** Office rent + dumpster (from March). */
  exp_office: number;
  /** Software subscriptions on the corporate card (Guesty, Anthropic, PriceLabs, QuickBooks, Adobe, Quo, AirDNA, Squarespace, Vercel, Supabase and the smaller tools). */
  exp_software: number;
  /** MH Partners debt service. */
  exp_debt: number;
  /** Insurance (Phillips) — annual premium, lump sum in March. */
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
  /** 1099 contractor bench, field labor + creative + misc. */
  exp_contractors: number;
  /** Onboarding cost for pre-signed contracts — $0 (folded into supplies). */
  exp_onboard_presigned: number;
  /** Onboarding cost for slider-added properties — $0 (folded into supplies). */
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
  exp_onboard_presigned: number;
  exp_onboard_new: number;
  /** Card itemisation; absent or null when the month has no category detail. */
  cc_detail?: CardDetail | null;
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
  matureFee?: number
): YearResult {
  const config = getYearConfig(year, rolledForward ?? 0, openIn, matureFee);
  const maxNew = config.newOrder.length;
  const n = Math.max(0, Math.min(maxNew, Math.round(numNew)));
  const newStartMonths: number[] = config.newOrder.slice(0, n);
  const useActualsThrough = actuals && actualsThroughMonth ? actualsThroughMonth : 0;

  const monthly: MonthRow[] = [];
  for (let m = 1; m <= 12; m++) {
    // ─── Past month: use bank-derived actuals ──────────────────────────
    if (m <= useActualsThrough && actuals && actuals[m - 1]) {
      const a = actuals[m - 1];
      const exp_total =
        a.exp_office +
        a.exp_software +
        a.exp_debt +
        a.exp_insurance +
        a.exp_accounting +
        a.exp_bank +
        a.exp_cc_ops +
        a.exp_contractors +
        a.exp_onboard_presigned +
        a.exp_onboard_new;
      // Active count for actuals month: derived from config so it matches
      // the rest of the table; useful for diagnostics even when expense
      // values are frozen from the bank.
      let activeForActual = 0;
      for (const p of config.current) if (m >= p.start) activeForActual += 1;
      for (const p of config.presigned) if (m >= p.start) activeForActual += 1;

      monthly.push({
        month: m,
        rev_current: a.revenue, // attribute everything to current portfolio
        rev_presigned: 0,
        rev_new: 0,
        rev_total: a.revenue,
        exp_office: a.exp_office,
        exp_software: a.exp_software,
        exp_debt: a.exp_debt,
        exp_insurance: a.exp_insurance,
        exp_accounting: a.exp_accounting,
        exp_bank: a.exp_bank,
        exp_cc_ops: a.exp_cc_ops,
        cc_detail: a.cc_detail ?? null,
        exp_contractors: a.exp_contractors,
        exp_onboard_presigned: a.exp_onboard_presigned,
        exp_onboard_new: a.exp_onboard_new,
        exp_total,
        net_business: a.revenue - exp_total,
        is_actual: true,
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
    } else {
      // No smart data — fall back to seasonality for current too.
      for (const p of config.current) {
        if (m >= p.start) rev_current += p.fee * dist[p.type];
      }
      // Apply forward-year calibration if we learned one from a prior
      // year's smart forecast.
      if (calibrationFactor && calibrationFactor > 0 && calibrationFactor !== 1) {
        rev_current *= calibrationFactor;
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
    }

    const rev_total = rev_current + rev_presigned + rev_new;

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
    // the whole people line, scale on this.
    let operatingCount = activeCount;
    if (openIn) {
      for (const p of config.current) {
        if (m >= p.start && p.id && !openIn(p.id, year, m)) operatingCount -= 1;
      }
    }

    const exp_office = officeCost(m, config.officeStartMonth);
    const exp_software = softwareCost(year, m);
    const exp_debt = bookkeeperCost(m, config.bookkeeperLastMonth);
    const exp_insurance = m === INSURANCE_MONTH ? INSURANCE_ANNUAL : 0;
    const exp_accounting = accountingCost(year, m);
    const exp_bank = BANK_FEES_MONTHLY;
    const cc_detail = ccOperatingDetail(operatingCount, year, m);
    const exp_cc_ops = ccOperatingCost(operatingCount, year, m);
    const exp_contractors = contractorCost(year, m, operatingCount, dist.CA);
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
      exp_onboard_presigned +
      exp_onboard_new;

    const net_business = rev_total - exp_total;

    monthly.push({
      month: m,
      rev_current,
      rev_presigned,
      rev_new,
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
      exp_onboard_presigned,
      exp_onboard_new,
      exp_total,
      net_business,
      is_actual: isStatementActual,
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
