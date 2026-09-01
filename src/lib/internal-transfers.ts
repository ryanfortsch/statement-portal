/**
 * Recognizing Rising Tide's own money movements in a property's bank CSV.
 *
 * Every property has its own Chase account, and three kinds of internal
 * sweep leave it every month. None of them is an owner expense, but until
 * this module they all landed in the Unattributed Charges queue looking
 * exactly like one, and the operator dismissed them by hand every close.
 *
 *   TAX -> *9928           Occupancy tax collected on VRBO, Booking.com and
 *                          direct stays, swept to the centralized account
 *                          MassTaxConnect pays the state from. The tax was
 *                          never owner revenue (adjusted_revenue is computed
 *                          net of TOTAL_TAXES), so billing it to the owner
 *                          would charge them for money they never received.
 *
 *   VRBO COMMISSION -> *5130
 *                          VRBO deposits the guest gross INCLUDING its 5%
 *                          commission into the property account as part of
 *                          rental revenue, then charges that commission to
 *                          Rising Tide's corporate card (*3878) as one
 *                          portfolio-wide lump. The sweep reimburses the
 *                          card. The commission is already netted out of
 *                          adjusted_revenue via effective_commission, so
 *                          billing it again would double-charge the owner.
 *
 *   MANAGEMENT FEE -> *5130
 *                          The monthly settlement of the fee the statement
 *                          already charges on its own line.
 *
 * WHY THIS IS NOT JUST A DESCRIPTOR MATCH. *9928 is a tax-only account, so
 * its destination alone settles the question. *5130 is Rising Tide
 * operating and is genuinely ambiguous: alongside the two sweeps, real
 * expense reimbursements move there too, and three are already attributed
 * against live statements -- 53 Rocky Neck's $26.59 shower door handle,
 * 17 Beach's $49.99 trash can, 20 Hammond's $250.66 AC installation. A
 * blanket "transfer to *5130 is a sweep" rule would erase those from the
 * owners' Repairs lines. So the *5130 leg is decided by AMOUNT, against
 * figures Helm has already computed for itself.
 *
 * THE MONTH OFFSET IS THE WHOLE TRICK. A sweep executed in calendar month
 * M+1 pays month M's remittance sheet -- the MA room-occupancy filing falls
 * 30 days after period end, and the operator moves tax and commission
 * together on that day. Read against the month the row LANDS in, nothing
 * ties: 0 of 21 live tax transfers match. Read against M-1, 34 of 37
 * comparable transfers tie to $0.00. The operator's own worked example is
 * 19 Rackliffe's 2026-08-27 pair, $1,734.81 and $191.55, which is July's
 * sheet exactly ($1,734.81 / $191.55), not August's ($1,678.60 / $717.35).
 *
 * TOLERANCE IS ONE CENT, AND THAT IS NOT CONSERVATISM FOR ITS OWN SAKE.
 * Do not widen it. $10 of slack is already falsified on live data: 20
 * Hammond's $250.66 AC installation sits $8.41 from that property's $242.25
 * July commission sweep, so a dollars-wide tolerance eats a real repair.
 * The management-fee branch is safe for the same reason -- a fee is
 * 22-25% of a messy revenue number and is essentially never round -- NOT
 * because the amounts are large. Nothing here should be read as "big
 * numbers can afford slack".
 *
 * NOTHING IN THIS MODULE MOVES MONEY. A recognized sweep still lands in
 * bank_deposit_attributions with status='pending', which every payout
 * recompute site ignores (loadAddOnTotals filters status='attributed').
 * All recognition does is stamp `source` so the queue can file it out of
 * the operator's way. The escape hatch stays open in the UI: if the matcher
 * is ever wrong about a *5130 row, the operator can still attribute it as
 * an expense.
 */

/** The three internal movements Helm can recognize by amount. */
export type SweepKind = 'tax-sweep' | 'commission-sweep' | 'mgmt-fee-sweep';

/**
 * `bank_deposit_attributions.source` values. The column is unconstrained
 * TEXT (only `status` and `direction` carry CHECKs), so adding these needs
 * no migration.
 */
export const SWEEP_SOURCE: Record<SweepKind, string> = {
  'tax-sweep': 'internal-tax-sweep',
  'commission-sweep': 'internal-commission-sweep',
  'mgmt-fee-sweep': 'internal-mgmt-fee-sweep',
};

/** Every source value this module can stamp. Count queries and the review
 *  UI filter on this list, so it must stay the single definition. */
export const INTERNAL_SWEEP_SOURCES: string[] = Object.values(SWEEP_SOURCE);

export function isInternalSweepSource(source: string | null | undefined): boolean {
  return !!source && INTERNAL_SWEEP_SOURCES.includes(source);
}

/**
 * One cent, and compared as integer cents so the comparison itself cannot
 * drift -- `Math.abs(191.54 - 191.55)` is 0.010000000000019 in IEEE 754 and
 * fails a naive `<= 0.01`. The single cent absorbs rounding-order
 * differences between Helm's round2 and the amount the operator moved; it
 * is NOT a business tolerance and must not be widened. See the module
 * docblock for the $250.66 / $242.25 collision a wider window would eat.
 */
export const SWEEP_MATCH_CENTS = 1;

/** Sweeps fire on the filing date, late in the month. The month-start
 *  transfer is the management-fee settlement. Used only to steer which
 *  figure a row is tested against -- never to relax the amount test, since
 *  the AC installation fired one day before a real sweep date. */
const MGMT_FEE_MAX_DAY = 7;

/** What Helm computed for the month the transfer pays (M-1). */
export type SweepExpectations = {
  /** RemittanceRow.taxToRemit -- the wire to *9928. */
  taxToRemit: number;
  /** RemittanceRow.vrboCommissionSweep -- the wire to *5130. */
  vrboCommissionSweep: number;
  /** property_statements.management_fee for the same month. */
  managementFee: number | null;
  /** RemittanceRow.sweepEstimated: the commission base was inferred because
   *  a VRBO stay had no folio. Recorded so the UI can say so; it does not
   *  relax the match, which is exact either way. */
  sweepEstimated: boolean;
};

/** One outbound transfer row parsed out of the bank CSV. */
export type TransferCandidate = {
  /** Caller's identity for the row (the dedupe_key in /api/ingest). */
  key: string;
  /** Last four of the destination account. */
  last4: string;
  /** Positive magnitude of the debit. */
  amount: number;
  /** ISO yyyy-mm-dd posting date. */
  date: string;
};

export type SweepVerdict = {
  key: string;
  kind: SweepKind;
  source: string;
  /** The figure it was tested against; null when none could be computed. */
  expected: number | null;
  /** False when an expected figure existed and the amount did not tie. Only
   *  ever false on the tax leg, which classifies on destination alone. */
  reconciles: boolean;
  /** True when no M-1 figure was available at all, so "does not tie" would
   *  be a lie. Distinguishes a real discrepancy from a blind spot. */
  evaluated: boolean;
  /** Carried through from the remittance sheet for display. */
  estimated: boolean;
};

const ties = (a: number, b: number) =>
  Math.abs(Math.round(a * 100) - Math.round(b * 100)) <= SWEEP_MATCH_CENTS;

/** Day of month from an ISO date, parsed without touching the local zone. */
function isoDay(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? Number(m[3]) : 0;
}

/**
 * The month a transfer landing in `month` pays for: exactly M-1, never a
 * window. A range buys nothing at cent tolerance and doubles the collision
 * surface on the small commission figures (20 Hammond alone carries
 * $204.05 / $242.25 / $366.74 across adjacent months).
 */
export function remittanceMonthFor(landingMonth: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(landingMonth);
  if (!m) return landingMonth;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return mo === 1
    ? `${y - 1}-12`
    : `${y}-${String(mo - 1).padStart(2, '0')}`;
}

/**
 * Decide which outbound transfers are recognizable internal sweeps.
 *
 * Batch rather than per-row because two of the rules are cross-row: the
 * commission sweep requires a same-date tax sibling, and each expected
 * figure retires at most one transfer. Rows this returns no verdict for
 * stay in the operator's queue exactly as they do today -- the default is
 * always "a human looks at it".
 */
export function classifyInternalTransfers(
  candidates: TransferCandidate[],
  expected: SweepExpectations | null,
  accounts: { tax: string; operating: string },
): SweepVerdict[] {
  const verdicts: SweepVerdict[] = [];
  const outToTax = candidates.filter(c => c.last4 === accounts.tax);
  const outToOperating = candidates.filter(c => c.last4 === accounts.operating);

  // --- Tax leg. Destination authorizes it; the amount is a confidence
  // signal, not the permission. A tax-account transfer is never owner
  // money regardless of whether Helm's figure agrees, so it is always
  // classified -- but a disagreement is surfaced, because a sweep larger
  // than the computed tax means Helm is missing reservations for that
  // month. 16 Waterman moved $504.04 against a computed $0, which at the
  // 11.7% Cape Ann rate implies a ~$4,308 stay Helm never saw.
  if (outToTax.length > 0) {
    // Compare the SUM, so a tax wire split across two transfers still ties.
    const moved = outToTax.reduce((s, c) => s + c.amount, 0);
    const evaluated = expected !== null;
    const reconciles = evaluated && ties(moved, expected!.taxToRemit);
    for (const c of outToTax) {
      verdicts.push({
        key: c.key,
        kind: 'tax-sweep',
        source: SWEEP_SOURCE['tax-sweep'],
        expected: evaluated ? expected!.taxToRemit : null,
        reconciles,
        evaluated,
        estimated: false,
      });
    }
  }

  // --- Operating leg. Ambiguous, so nothing is classified without an
  // exact amount tie to a figure Helm computed for M-1. No figures means
  // "cannot evaluate", which leaves every row pending -- never "not a
  // sweep, therefore an expense".
  if (expected === null || outToOperating.length === 0) return verdicts;

  const taxDates = new Set(outToTax.map(c => c.date));

  // Each figure retires at most one transfer. If two rows tie the same
  // figure, neither is claimed: an ambiguous match is a human's problem,
  // not a coin flip.
  const claimOne = (
    pool: TransferCandidate[],
    figure: number,
    kind: SweepKind,
  ): void => {
    if (!(figure > 0)) return;
    const hits = pool.filter(c => ties(c.amount, figure));
    if (hits.length !== 1) return;
    verdicts.push({
      key: hits[0].key,
      kind,
      source: SWEEP_SOURCE[kind],
      expected: figure,
      reconciles: true,
      evaluated: true,
      estimated: kind === 'commission-sweep' ? expected.sweepEstimated : false,
    });
  };

  // Management-fee settlement: month-start, ties the fee the statement
  // already charged. 32 of 36 live rows tie to the cent.
  if (expected.managementFee !== null) {
    claimOne(
      outToOperating.filter(c => isoDay(c.date) <= MGMT_FEE_MAX_DAY),
      expected.managementFee,
      'mgmt-fee-sweep',
    );
  }

  // Commission sweep: filing-day, ties 5% of the month's VRBO pre-tax
  // folio, AND has a tax wire on the same date. The sibling test is what
  // makes this safe -- the operator moves tax and commission together in
  // one sitting, and none of the three known genuine reimbursements shares
  // a date with a tax transfer.
  const claimed = new Set(verdicts.map(v => v.key));
  claimOne(
    outToOperating.filter(c =>
      !claimed.has(c.key) &&
      isoDay(c.date) > MGMT_FEE_MAX_DAY &&
      taxDates.has(c.date),
    ),
    expected.vrboCommissionSweep,
    'commission-sweep',
  );

  return verdicts;
}
