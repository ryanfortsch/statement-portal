/**
 * The management fee /revenue shows for a range containing closed months.
 *
 * A closed month's statement is canonical: it is the document that billed the
 * owner. /revenue's post-pass already swaps the statement's revenue, nights,
 * stays, cleaning, repairs and tax into the card, and then threw away the one
 * figure the statement exists to state. The fee was re-derived as
 * `revenue x live management_fee_pct`, which cannot reproduce it, because the
 * fee base is not rental revenue: add-ons enter it, an operator's refund
 * ruling can re-base it, and the rate is snapshotted at ingest rather than
 * read live.
 *
 * Measured on Apr-Aug 2026, the rate was identical on all 58 statements and
 * the recompute still came out $284.57 low, with nine property-months wrong
 * by more than fifty cents. The worst was 4 Brier Neck's August, $5,832.10
 * against the $5,321.81 that was actually billed: the recompute silently
 * undid the refund fee-basis ruling. /forecast reads the real column, so the
 * two surfaces disagreed about the same five months.
 *
 * So: take the fee from the statements for the months the swap actually
 * fired, and derive only the remainder.
 *
 *     fee = sum(statement fees) + (revenue outside those months) x rate
 *
 * Pure. No I/O, no imports. Unit-tested in
 * src/lib/__tests__/revenue-statement-fee.test.ts, with a database parity
 * harness in scripts/revenue_statement_fee_parity.mjs.
 */

export type StatementFeeInput = {
  /** Every YYYY-MM the range covers. */
  segmentMonths: readonly string[];
  /** Months the statement swap ACTUALLY fired for. Not "months with a statement". */
  statementMonths: readonly string[];
  /** Months the pacing projection claimed. */
  pacedMonths: readonly string[];
  /** Months left on their booked or pro-rated contribution. */
  bookedMonths: readonly string[];
  /** Summed `management_fee` across those statements. */
  statementFee: number;
  /** Summed `rental_revenue` across those same statements. */
  statementRevenue: number;
  /** The card's final revenue figure, all months included. */
  totalRevenue: number;
  /** The property's live fee fraction, e.g. 0.25. */
  mgmtFraction: number;
};

/**
 * How far below zero the remainder may fall before it is read as a real
 * disagreement rather than rounding.
 *
 * The card's revenue is rounded to cents before the statement's own revenue is
 * subtracted from it, so on an all-statement range the remainder lands a
 * fraction of a cent either side of zero rather than exactly on it. A strict
 * `< 0` test therefore fell back or did not depending on which way the last
 * cent rounded: 19 Rackliffe and 84 Thatcher billed their statements while
 * 4 Brier Neck silently reverted to the recompute it was meant to replace,
 * showing $5,832.10 against the $5,321.81 it had billed. A dollar is far above
 * that noise and far below any disagreement worth honouring.
 */
export const REMAINDER_TOLERANCE = 1;

export type StatementFeeResult = {
  /** The fee to display. */
  fee: number;
  /** Whether any statement's own fee was used, rather than a pure recompute. */
  usedStatementFee: boolean;
  /**
   * Whether the month arrays account for the range exactly: every segment
   * month claimed by exactly one branch, nothing claimed twice, nothing
   * outside the range. The analogue of forecast-fy-total's `coversYear`.
   */
  tilesRange: boolean;
};

/**
 * Do the month arrays account for the range exactly?
 *
 * This must be built from the branch that RAN, never from a second lookup of
 * which months have a statement on file. The two disagree in at least two
 * live ways. September 2026 already carries statements while still being the
 * current month, so the swap never fires and its fee must not be substituted
 * onto revenue nobody swapped. And a month clipped by a range edge, as June
 * is under Last 90 Days, has a statement on file that the swap skips because
 * the segment is partial; pasting a whole month's fee onto a few days of
 * revenue would print a fee larger than the revenue beneath it.
 */
function tiles(
  segmentMonths: readonly string[],
  parts: ReadonlyArray<readonly string[]>,
): boolean {
  const segments = new Set(segmentMonths);
  const seen = new Set<string>();
  for (const part of parts) {
    for (const m of part) {
      if (!segments.has(m)) return false; // claimed a month outside the range
      if (seen.has(m)) return false; // claimed twice, which would double count
      seen.add(m);
    }
  }
  return seen.size === segments.size;
}

/**
 * Resolve the fee, falling back to the whole-range recompute whenever the
 * statement half cannot be trusted.
 *
 * Deliberately conservative: an unaccounted range, no statement month, or a
 * negative remainder all fall back rather than guess. The fallback is exactly
 * the expression this replaced, so every range without a closed statement
 * month is unchanged to the cent.
 */
export function resolveManagementFee(input: StatementFeeInput): StatementFeeResult {
  const {
    segmentMonths, statementMonths, pacedMonths, bookedMonths,
    statementFee, statementRevenue, totalRevenue, mgmtFraction,
  } = input;

  const recompute = totalRevenue * mgmtFraction;
  const tilesRange = tiles(segmentMonths, [statementMonths, pacedMonths, bookedMonths]);

  if (statementMonths.length === 0 || !tilesRange) {
    return { fee: recompute, usedStatementFee: false, tilesRange };
  }

  // Revenue belonging to the months no statement covered. Meaningfully
  // negative means the card's revenue and the statements disagree about their
  // own months, which is not a situation to paper over with arithmetic. A
  // hair below zero is just the rounding described on REMAINDER_TOLERANCE,
  // and clamping it is what keeps an all-statement range billing its
  // statements no matter which way the last cent went.
  const remainder = totalRevenue - statementRevenue;
  if (remainder < -REMAINDER_TOLERANCE) {
    return { fee: recompute, usedStatementFee: false, tilesRange };
  }

  return {
    fee: statementFee + Math.max(0, remainder) * mgmtFraction,
    usedStatementFee: true,
    tilesRange,
  };
}
