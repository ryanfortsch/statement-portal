/**
 * The statement-month gate: whether a row on Guesty's owner-statement PDF
 * is recognized on THIS month's statement. Pure, no imports.
 *
 * Revenue is recognized at checkout (CLAUDE.md, "Recognition"). Guesty's
 * PDF does not use that basis: it lists a booking in the month the guest
 * paid, so a stay checking out next month rides in on this month's PDF,
 * and an entire wrong-month PDF dropped into the wrong slot lists nothing
 * but another month's stays. The gate holds those out.
 *
 * The one sanctioned cross-month case is an operator-created installment
 * split (reservation_installments): each month with a slice recognizes
 * its nights-in-month share through ingest's installment fork, and a
 * month WITHOUT a slice recognizes nothing, because the slice months
 * already carry the whole stay. The canonical shape is a long stay
 * checking out on the 1st: zero nights in its checkout month, so no slice
 * there, but the PDF lists the booking in that month at full value
 * (recognition at checkout). Until 2026-09 the gate passed that row,
 * since its checkout month IS the statement month, and the owner was
 * paid the whole stay a second time (Kate Bacon, 17 Beach, June 27 to
 * August 1 2026: $62,464.40 split over June and July, and the August PDF
 * carried it again at full value). refresh-statement and fill-gap already
 * skip any installment-coded booking; this makes ingest agree with them.
 *
 * Both of ingest's passes over the PDF rows (the guest-name loop that
 * files the informational gap, and the recognition loop that books
 * money) call this one function, so they cannot disagree about a row.
 */

export type MonthGateVerdict =
  /** Book it: either it checks out this month, or this month has its slice (the fork books the share). */
  | 'recognize'
  /** Checks out in another month and is not split: held out, named in the out-of-month gap. */
  | 'out_of_month'
  /** Split via installments with no slice for this month: fully recognized on the slice months' statements. */
  | 'recognized_elsewhere';

export function monthGate(input: {
  /** YYYY-MM of the row's checkout; '' when unknown (an unknown checkout is not held out). */
  checkOutMonth: string;
  /** YYYY-MM of the statement being built. */
  month: string;
  /** The code has an installment slice for THIS month. */
  hasSliceThisMonth: boolean;
  /** The code has installment slices in any month, this one included. */
  hasSlicesAnywhere: boolean;
}): MonthGateVerdict {
  if (input.hasSliceThisMonth) return 'recognize';
  if (input.hasSlicesAnywhere) return 'recognized_elsewhere';
  if (input.checkOutMonth && input.checkOutMonth !== input.month) return 'out_of_month';
  return 'recognize';
}
