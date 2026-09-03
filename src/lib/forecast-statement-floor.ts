/**
 * Statement run-rate floor for the smart forecast's annual gross.
 *
 * Part B of the smart forecast spreads a property's expected ANNUAL gross
 * across the year on the revenue-seasonality curve, and that annual figure is
 * built from forward bookings only: the months ahead, pace-corrected and
 * annualized. On 2026-09-02 the months ahead were September to December, the
 * shoulder and the off-season, still thin on the books and with the pacing
 * scale-up capped at 2.5x. What a property had just earned in July and
 * August never entered the calculation, so the homes onboarded in June, July
 * and August were projected to earn LESS next August than the August they
 * had just closed while still ramping. 84 Thatcher grossed about $32K in
 * August 2026 and was carrying an annual gross of $176K, when that one
 * August at the curve's 15.7% share implies $207K before it matures.
 *
 * This module turns closed statements into a floor on that annual gross.
 * The month's gross is the BILLED FEE BASE, management_fee / pct, loaded by
 * getStatementGrossByProperty: what the fee was actually charged on, add-ons
 * included. That is the quantity the fee on the ACT columns came from, so
 * "not projected below the August it earned" holds in fee terms, which is
 * how the operator reads the table.
 *
 * One basis caveat, documented rather than corrected here: the forward pace
 * this floor is compared against is built from guesty host_payout, which on
 * tax-inclusive channels runs 0 to 16% above the fee base (occupancy tax and
 * the Stripe fee ride inside it). The comparison is therefore conservative:
 * the floor bites slightly less often than it would on one basis, never
 * more. Netting the pace down is a change to the pacing model, not to this.
 *
 * The floor is the larger of two readings of the closed months:
 *
 *   run rate      the LATEST closed full month annualized on its own share.
 *                 This is the reading that answers "they were still ramping":
 *                 the latest month is the best evidence of where a property
 *                 has got to, and earlier ramp months are not averaged in.
 *                 By design it can rest on one month.
 *   whole record  every closed full month annualized together, minus the
 *                 property's first closed month once there are three or
 *                 more. A first month is never full evidence: onboardings
 *                 start mid-month, and the Statements module itself began in
 *                 April 2026, so the original six file a thin April. This
 *                 reading keeps the summer's information once the latest
 *                 month is a shoulder month, so the floor does not decay
 *                 through autumn.
 *
 * Guards, each of which only ever withholds a floor:
 *
 *   - at least MIN_STATEMENT_MONTHS closed full months, so a property's
 *     FIRST month never floors on its own (3 Windward and 225 Washington
 *     had one closed month in September 2026 and take no floor until
 *     September closes). A second month may: that is the run rate.
 *   - only months the property operated in full. The activation month of a
 *     mid-month onboarding is dropped when properties.activated_at says so
 *     (only 84 Thatcher carries it today), as is any month the operating
 *     window marks closed or partial;
 *   - a floor only raises. A property whose forward pace already implies a
 *     larger year keeps it. That comparison lives in forecast-smart.ts.
 *
 * Dependency-free on purpose so scripts/forecast_statement_floor_check.mjs
 * can import it directly.
 */

export const MIN_STATEMENT_MONTHS = 2;

export type StatementFloorInput = {
  /** YYYY-MM -> the gross the fee was billed on for that closed month. */
  grossByMonth: ReadonlyMap<string, number>;
  /** Revenue-seasonality share per month-of-year, index 0 = January, summing to 1. */
  revenueShare: readonly number[];
  /**
   * properties.activated_at, when known. A month before it is not the
   * property's, and the month of a mid-month activation is not a full month.
   */
  activatedAt?: string | null;
  /** Share of the month the property was open, 0 to 1. Defaults to 1. */
  operatingFactor?: (ym: string) => number;
};

export type StatementFloor = {
  /** Annual gross implied by the closed statements, or 0 when no floor applies. */
  annual: number;
  /** Closed full months that qualified, ascending. */
  months: string[];
  /** Annual implied by the latest qualifying month on its own. */
  latestAnnual: number;
  /** Annual implied by the qualifying months together, first month dropped once there are three. */
  recordAnnual: number;
};

const NONE: StatementFloor = { annual: 0, months: [], latestAnnual: 0, recordAnnual: 0 };

export function statementFloor(input: StatementFloorInput): StatementFloor {
  const { grossByMonth, revenueShare } = input;
  const factor = input.operatingFactor ?? (() => 1);
  const share = (ym: string) => revenueShare[parseInt(ym.slice(5, 7), 10) - 1] ?? 0;

  let activatedYM: string | null = null;
  let activatedDay = 1;
  if (input.activatedAt) {
    const d = input.activatedAt.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      activatedYM = d.slice(0, 7);
      activatedDay = parseInt(d.slice(8, 10), 10) || 1;
    }
  }

  const months = [...grossByMonth.keys()]
    .filter((ym) => /^\d{4}-\d{2}$/.test(ym))
    .filter((ym) => (grossByMonth.get(ym) ?? 0) > 0)
    .filter((ym) => share(ym) > 0)
    .filter((ym) => {
      if (activatedYM && ym < activatedYM) return false;
      if (activatedYM && ym === activatedYM && activatedDay > 1) return false;
      return factor(ym) >= 1;
    })
    .sort();

  if (months.length < MIN_STATEMENT_MONTHS) return NONE;

  // The first closed month is a ramp month (or the Statements module's own
  // thin first month), so it leaves the record reading once there is enough
  // record to spare it. With exactly two months the latest reading carries
  // anyway, since a ramp month can only drag the record below it.
  const recordMonths = months.length >= 3 ? months.slice(1) : months;
  let gross = 0;
  let shares = 0;
  for (const ym of recordMonths) {
    gross += grossByMonth.get(ym) ?? 0;
    shares += share(ym);
  }
  const recordAnnual = shares > 0 ? gross / shares : 0;
  const latest = months[months.length - 1];
  const latestAnnual = (grossByMonth.get(latest) ?? 0) / share(latest);
  return {
    annual: Math.max(recordAnnual, latestAnnual),
    months,
    latestAnnual,
    recordAnnual,
  };
}
