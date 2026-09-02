/**
 * 2026 management-business financial model for Rising Tide.
 *
 * Pure functions + constants — no React, no DOM. The /forecast page imports
 * `calcYear` and the typed constants and renders the result.
 *
 * Scope of the model: only the property-management business. Three things
 * are deliberately OUT of scope:
 *   - RT-owned units (3 Locust, Lighthouse Point, 65 Calderwood) — those
 *     have their own P&L, not relevant to "what does another mgmt
 *     contract do for us?"
 *   - Personal owner draw — modeled separately by Ryan/Dotti.
 *   - Federal/state taxes, capex, distributions.
 *
 * Three revenue streams layer over a 12-month seasonality curve:
 *   1. CURRENT     — 9 properties already under management
 *   2. PRESIGNED   — 3 contracts signed but not yet onboarded
 *   3. NEW         — N hypothetical adds (the slider — 0 to 10)
 *
 * Each property carries a `type` that selects one of three seasonality
 * curves (CA = Cape Ann, FL = Florida, LS = less-seasonal / inland), and a
 * `start` month so partial-year onboardings are pro-rated correctly.
 */

export type SeasonType = 'CA' | 'FL' | 'LS';

export type ManagedProperty = {
  name: string;
  /** Annual management fee in dollars (what RT collects, not gross rent). */
  fee: number;
  type: SeasonType;
  /** First month (1-12) the property contributes revenue. */
  start: number;
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
  { name: '17 Beach', fee: 46519, type: 'CA', start: 1 },
  { name: '21 Horton', fee: 29881, type: 'CA', start: 1 },
  { name: '73 Rocky Neck', fee: 28458, type: 'CA', start: 1 },
  { name: '3 South', fee: 23180, type: 'CA', start: 1 },
  { name: '20 Hammond', fee: 17196, type: 'CA', start: 1 },
  { name: '20 Enon', fee: 10556, type: 'LS', start: 1 },
  { name: '53 Rocky Neck', fee: 29702, type: 'CA', start: 5 },
  { name: '30 Woodward', fee: 26307, type: 'CA', start: 5 },
  { name: '19 Rackliffe', fee: 27484, type: 'CA', start: 6 },
  { name: '79 Main', fee: 17640, type: 'CA', start: 6 },
  { name: '16 Waterman', fee: 17302, type: 'CA', start: 6 },
  { name: '36 Granite', fee: 14194, type: 'CA', start: 6 },
  { name: '4 Brier Neck', fee: 31728, type: 'CA', start: 7 },
  { name: '84 Thatcher', fee: 26455, type: 'CA', start: 7 },
  { name: '53 Rocky Neck, Downstairs', fee: 9238, type: 'CA', start: 7 },
  { name: '3 Windward', fee: 33805, type: 'CA', start: 8 },
  { name: '225 Washington', fee: 3580, type: 'CA', start: 8 },
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
 * In 2027 the 9 current properties roll forward as full-year actives.
 * Prospects that closed in 2026 will appear in Helm's `properties`
 * table by then and get queried as currents — until then the forecast
 * layer carries them forward via the prospects feed.
 */
export const ACTIVE_2027: ManagedProperty[] = [
  ...CURRENT_2026.map((p) => ({ ...p, start: 1 })),
];

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

/** Each new property is assumed to be a Cape Ann management contract at $25K/yr. */
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
/** Dumpster — flat $50/mo year-round (no summer surcharge). */
export const DUMPSTER_MONTHLY = 50;
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
 *   Jun 2026  $1,272     Jul 2026  $3,586     Aug 2026  $3,804
 *
 * July and August run well above this constant. Anthropic is the driver,
 * $420 in April to $1,823 in August, nearly half the line. Whether that
 * holds depends on the responder prompt-cost work, so the constant stays at
 * the 2026 YTD figure until a full quarter says otherwise.
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
 * Accounting (MS Consultants). RERACKED Aug 2026: this was modeled as a
 * one-time engagement at $0 forward, but the bank shows it recurring
 * annually - $4,156.62 on 2025-01-13 and $4,442.96 on 2026-04-15. It is a
 * tax-season lump, not a monthly retainer, so it is modeled the same way
 * as the insurance premium: one hit, in April.
 */
export const ACCOUNTING_MONTHLY = 0;
export const ACCOUNTING_ANNUAL = 4450;
export const ACCOUNTING_MONTH = 4;

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
 * Card spend for one month: consumables that scale with the fleet and the
 * season, plus the fixed floor.
 *
 * The old signature is unchanged. `month` was already accepted and ignored;
 * it now indexes the seasonal curve. Elasticity is structural rather than a
 * tuned coefficient: the variable term is fully elastic by construction and
 * the fixed term is not elastic at all, so the blended figure falls out of the
 * mix instead of being asserted. Same shape as contractorCost, which already
 * rides a curve and scales with the fleet.
 */
export function ccOperatingCost(
  activePropCount: number,
  year: number,
  month: number,
): number {
  const variable =
    CC_SUPPLY_ANNUAL_PER_PROP * (CC_SUPPLY_SEASON[month - 1] ?? 0) * activePropCount;
  const fixed =
    CC_FIXED_MONTHLY +
    marketingCost(year, month) +
    (month === CC_LISTING_MONTH ? CC_LISTING_ANNUAL : 0);
  return variable + fixed;
}

/**
 * Itemisation for the Recurring Monthly rows on /forecast.
 *
 * These are a PROPORTIONAL SPLIT of the month's card figure, so the weights
 * only have to hold their ratio to one another; the split rescales itself to
 * whatever ccOperatingCost returns. Values are a representative mid-season
 * month at the current fleet.
 */
export const CC_OPERATING_BREAKDOWN: ReadonlyArray<{
  label: string;
  monthly: number;
  info: string;
}> = [
  {
    label: 'Guest supplies & inventory',
    monthly: 6700,
    info: 'Amazon, Fix Linens, Target, HomeGoods. The dominant card line and the seasonal one: $236 per property in February against $1,492 in June. Bought the month before the guests arrive, which is why it leads the turnover curve.',
  },
  {
    label: 'Repairs & upkeep',
    monthly: 1660,
    info: 'Hardware stores, plumbing, propane and small contractor charges on the card. Rides the same per-property seasonal curve as supplies.',
  },
  {
    label: 'Vehicle & other insurance',
    monthly: 519,
    info: 'GEICO auto, $519 every month of 2026 and unchanged since March 2025. Separate from the Phillips commercial premium, which is an annual ACH out of the operating account.',
  },
  {
    label: 'Travel & other',
    monthly: 285,
    info: 'Flights, car rental, fuel, meals and miscellaneous admin. Averaged across the whole card record rather than 2026 alone, because one month (November 2025, $3,600) carries most of a year.',
  },
  {
    label: 'Marketing & advertising',
    monthly: 175,
    info: 'Facebook and Meta, plus occasional print. Ran $680/mo through May, then stepped down to roughly $175 from June. The cut is real and measured, not assumed.',
  },
  {
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
 * Flat monthly: shoots are scheduled against the content calendar, not
 * against turnover volume, so this does not ride the seasonality curve.
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
  const creative = month >= creativeStart ? CONTRACTOR_CREATIVE_MONTHLY : 0;
  const misc = CONTRACTOR_MISC_MONTHLY;
  return field + creative + misc;
}

/**
 * Hire economics, a SALARIED body, distinct from the 1099 bench above.
 *
 * The plan put a first hire at $5K/mo in August 2026. It did not happen
 * that way: Ryan built a contractor bench instead. Delaney started
 * 2026-07-07 and Cooper 2026-07-29, and between them they ran $7,958 in
 * the first 25 days of August alone, the hire budget, spent, and then
 * some. Carrying both lines in 2026 double-counts the same money, so
 * 2026's hire start moves past the end of the year (see getYearConfig).
 *
 * 2027 keeps a salaried hire from January. That is a forward planning
 * choice rather than something the bank data settles, and it sits on top
 * of the contractor line, not instead of it.
 */
export const HIRE_MONTHLY = 5000;
/** 13 = never within the year. 2026's hire became the 1099 bench instead. */
export const HIRE_START_MONTH = 13;
export const SECOND_HIRE_AT_PROP_COUNT = 20;

export function hireCost(month: number, hireStartMonth: number, activeCount: number): number {
  if (month < hireStartMonth) return 0;
  const numHires = activeCount >= SECOND_HIRE_AT_PROP_COUNT ? 2 : 1;
  return numHires * HIRE_MONTHLY;
}

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
 * Per-year configuration. `getYearConfig(2026)` returns the layout used by
 * the live model — 9 current + 5 pre-signed (May/Jun) + N new (Jun-Dec).
 * `getYearConfig(2027)` returns 14 active props (the 9 + 5 ex-presigned
 * carried forward) + N new spread across the year, no debt service, hire
 * continues all year.
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
  /** First month new hire shows up in the budget (1-12). */
  hireStartMonth: number;
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
export function getYearConfig(year: ForecastYear, rolledForward: number = 0): YearConfig {
  if (year === 2026) {
    // 2026 is the starting year; nothing to roll forward into it.
    return {
      year: 2026,
      current: CURRENT_2026,
      presigned: PRESIGNED_2026,
      newOrder: NEW_ORDER_2026,
      bookkeeperLastMonth: 5,
      hireStartMonth: HIRE_START_MONTH, // 13 = no salaried hire in 2026; the bench absorbed it
      officeStartMonth: 3,
    };
  }

  // Synthesize the rolled-forward properties as $25K/yr CA contracts
  // active from January 1 of the given year.
  const synth: ManagedProperty[] = Array.from({ length: rolledForward }, (_, i) => ({
    name: `Rolled fwd #${i + 1}`,
    fee: NEW_PROPERTY_FEE,
    type: NEW_PROPERTY_TYPE,
    start: 1,
  }));

  if (year === 2027) {
    return {
      year: 2027,
      current: [...ACTIVE_2027, ...synth],
      presigned: [],
      newOrder: NEW_ORDER_2027,
      bookkeeperLastMonth: null,
      hireStartMonth: 1,
      officeStartMonth: 1,
    };
  }

  // 2028 — same 14-property baseline as 2027 plus all rollovers.
  return {
    year: 2028,
    current: [...ACTIVE_2027, ...synth],
    presigned: [],
    newOrder: NEW_ORDER_2028,
    bookkeeperLastMonth: null,
    hireStartMonth: 1,
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
  /** Operating CC pass-through (median of trailing 12 mo). */
  exp_cc_ops: number;
  /** 1099 contractor bench, field labor + creative + misc. */
  exp_contractors: number;
  /** New hire from Oct. */
  exp_hire: number;
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
  exp_hire: number;
  exp_onboard_presigned: number;
  exp_onboard_new: number;
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
  statementRevenueByMonth?: ReadonlyMap<number, number>
): YearResult {
  const config = getYearConfig(year, rolledForward ?? 0);
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
        a.exp_hire +
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
        exp_contractors: a.exp_contractors,
        exp_hire: a.exp_hire,
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
      // Smart Forecast owns the current 9 portfolio. Presigned + new
      // remain on seasonality because they aren't in Guesty yet.
      rev_current = smartFee;
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

    // Active property count this month — drives CC scaling + 2nd-hire
    // trigger.
    let activeCount = 0;
    for (const p of config.current) if (m >= p.start) activeCount += 1;
    for (const p of config.presigned) if (m >= p.start) activeCount += 1;
    for (const start of newStartMonths) if (m >= start) activeCount += 1;

    const exp_office = officeCost(m, config.officeStartMonth);
    const exp_software = softwareCost(year, m);
    const exp_debt = bookkeeperCost(m, config.bookkeeperLastMonth);
    const exp_insurance = m === INSURANCE_MONTH ? INSURANCE_ANNUAL : 0;
    const exp_accounting = m === ACCOUNTING_MONTH ? ACCOUNTING_ANNUAL : ACCOUNTING_MONTHLY;
    const exp_bank = BANK_FEES_MONTHLY;
    const exp_cc_ops = ccOperatingCost(activeCount, year, m);
    const exp_contractors = contractorCost(year, m, activeCount, dist.CA);
    const exp_hire = hireCost(m, config.hireStartMonth, activeCount);
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
      exp_hire +
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
      exp_contractors,
      exp_hire,
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
