/**
 * THE single computation of a statement's money columns.
 *
 * Until this module, eleven sites each re-derived owner_payout with their
 * own copy of the formula, their own reads, their own error posture and
 * their own guard placement. The audit's meta-lesson (2026-09-01) was that
 * defects scaled with the number of those decision points, not with their
 * difficulty: two remediation phases created ~40 new sites and review found
 * a defect at about one in three. This module exists to make the count one.
 *
 * Two layers, deliberately separated:
 *
 *   computeStatementTotals(inputs)      pure. No I/O, no imports. Unit-tested
 *                                       in src/lib/__tests__/statement-totals.test.ts
 *                                       and run by `npm test` on every change.
 *
 *   writeStatementTotals(...)           (statement-totals-write.ts) the ONLY
 *                                       function permitted to write
 *                                       a money column on property_statements.
 *                                       Loads canonical inputs, fails CLOSED on
 *                                       any read error, runs the finality guard
 *                                       BEFORE writing, writes every money
 *                                       column at once so the stored row can
 *                                       never be internally inconsistent.
 *
 * The formula (src/lib/statement-addons.ts remains its documented home):
 *
 *   fee_base       = rental_revenue + add_ons_mgmt_base
 *   management_fee = round2(fee_base * management_fee_pct / 100)
 *   owner_payout   = round2(rental_revenue + add_ons_revenue - management_fee
 *                           - cleaning_total - repairs_total
 *                           - attributed_debits - reserve_holdback)
 *
 * Which terms are DERIVED from rows and which are OWNED (read from the
 * stored column unless the caller overrides) is not arbitrary and must not
 * drift:
 *
 *   rental_revenue          derived: SUM(reservations.adjusted_revenue)
 *   add_ons_revenue,
 *   add_ons_mgmt_base,
 *   attributed_debits       derived: loadAddOnTotals (status='attributed')
 *   num_stays,
 *   nights_booked           derived from reservations, checkout-month gated
 *   cleaning_total          derived: SUM over cleaning_events rows whose
 *                           source is bank-family, net of credit_amount.
 *                           (Invoice-only rows are attribution, never money:
 *                           the bank statement is the source of truth.)
 *   repairs_total           OWNED. Months ingested before repair_events
 *                           existed legally carry repairs_total > 0 with no
 *                           rows, so SUM(repair_events) would clobber them.
 *                           Read from the stored column; ingest/fill-gap/
 *                           receipts override it because they own it.
 *   reserve_holdback        OWNED. Operator-set; survives re-ingest by
 *                           design. Read from the stored column; the reserve
 *                           route overrides it.
 */

/**
 * PURE. This file has NO imports on purpose: it can be loaded by `node
 * --test` with nothing but Node, and nothing in it can touch a database.
 * The I/O half lives in statement-totals-write.ts.
 */

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * cleaning_events.source values that represent MONEY the bank actually
 * charged. Everything else on that table is attribution (an invoice waiting
 * for its ACH) and must not bill the owner. Filled from the scout of every
 * writer of cleaning_events.source -- see the test that pins this list.
 */
export const CLEANING_MONEY_SOURCES: ReadonlySet<string> = new Set([
  'bank', 'matched', 'corroborated', 'bank-linen', 'bank-laundry',
]);

export type ReservationInput = {
  adjusted_revenue: number | null;
  nights: number | null;
  check_out: string | null;
};

export type CleaningEventInput = {
  amount: number | null;
  credit_amount: number | null;
  source: string | null;
};

export type StatementInputs = {
  month: string;
  managementFeePct: number;
  reservations: ReservationInput[];
  cleaningEvents: CleaningEventInput[];
  addOns: { addOnsRevenue: number; addOnsMgmtBase: number; attributedDebits: number };
  repairsTotal: number;
  reserveHoldback: number;
};

export type StatementTotals = {
  rental_revenue: number;
  add_ons_revenue: number;
  attributed_debits_total: number;
  management_fee: number;
  cleaning_total: number;
  repairs_total: number;
  reserve_holdback: number;
  owner_payout: number;
  num_stays: number;
  nights_booked: number;
};

const n = (v: number | null | undefined): number => Number(v) || 0;

/** SUM of bank-charged cleaning, net of credits. Pure. */
export function deriveCleaningTotal(events: CleaningEventInput[]): number {
  let total = 0;
  for (const e of events) {
    if (!CLEANING_MONEY_SOURCES.has(String(e.source || ''))) continue;
    total += n(e.amount) - n(e.credit_amount);
  }
  return round2(total);
}

/**
 * The formula. Pure and total: any inputs in, one StatementTotals out.
 *
 * num_stays counts a booking ONCE, in the month it checks out, and only when
 * it carries revenue. Installment slices for months other than checkout
 * carry revenue here but check out elsewhere, so they contribute nights and
 * money without being counted as a stay -- the same gate every writer already
 * applies (#1273, #1436).
 */
export function computeStatementTotals(i: StatementInputs): StatementTotals {
  const rental_revenue = round2(i.reservations.reduce((s, r) => s + n(r.adjusted_revenue), 0));
  const add_ons_revenue = round2(n(i.addOns.addOnsRevenue));
  const add_ons_mgmt_base = round2(n(i.addOns.addOnsMgmtBase));
  const attributed_debits_total = round2(n(i.addOns.attributedDebits));
  const cleaning_total = deriveCleaningTotal(i.cleaningEvents);
  const repairs_total = round2(n(i.repairsTotal));
  const reserve_holdback = round2(n(i.reserveHoldback));

  const management_fee = round2((rental_revenue + add_ons_mgmt_base) * (n(i.managementFeePct) / 100));
  const owner_payout = round2(
    rental_revenue + add_ons_revenue - management_fee
    - cleaning_total - repairs_total - attributed_debits_total - reserve_holdback,
  );

  const num_stays = i.reservations.filter(
    r => n(r.adjusted_revenue) > 0 && (r.check_out || '').slice(0, 7) === i.month,
  ).length;
  const nights_booked = i.reservations.reduce((s, r) => s + n(r.nights), 0);

  return {
    rental_revenue, add_ons_revenue, attributed_debits_total, management_fee,
    cleaning_total, repairs_total, reserve_holdback, owner_payout,
    num_stays, nights_booked,
  };
}

