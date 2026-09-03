/**
 * Vendor-credit netting. Pure: no imports, no IO, so it loads under
 * `npm test` and is shared verbatim by /api/ingest and /api/fill-gap.
 *
 * Vendors bill us; they never pay us. A positive amount on a recognized
 * vendor descriptor in the bank CSV is a refund of one of that vendor's
 * own charges and must reduce what the owner is billed. The rule, from
 * /api/ingest where it was first written:
 *
 *   - a credit nets against a same-kind charge in the same month whose
 *     amount matches to the cent (within $0.005)
 *   - among several candidates the nearest bank date wins
 *   - each charge absorbs at most one credit
 *   - a matched charge keeps its row (audit trail) and carries
 *     credit_amount / credit_reason -- the same fields the operator's
 *     Mark Duplicate control writes -- so the row renders struck through
 *     and cleaning_total bills the net
 *   - only the cleaning family (cleaning, linen, laundry) auto-nets:
 *     repair_events has no credit columns, so a maintenance-vendor refund
 *     is returned unmatched and goes the loud route (critical gap)
 *   - a credit with no exact same-month match is NOT guessed at. It is
 *     returned so the caller raises `vendor_refund_unapplied`.
 *
 * Before this module, /api/fill-gap had none of this: a refund fell into
 * its deposit collector as an "other" deposit and the owner stayed billed
 * the gross (the $47.40 Laundry Plus refund on 20 Hammond, July 2026).
 */

export type VendorCharge = {
  date: string;          // bank posting date as it appears in the CSV, MM/DD/YYYY
  amount: number;        // positive: the charge as billed
  description: string;
  vendor: string;
  credit_amount?: number;
  credit_reason?: string;
};

export type VendorCreditKind = 'cleaning' | 'linen' | 'laundry' | 'repair';

export type VendorCredit = {
  kind: VendorCreditKind;
  vendor: string;
  date: string;          // MM/DD/YYYY
  amount: number;        // positive
  description: string;
};

export type VendorChargePools = {
  cleaning: VendorCharge[];
  linen: VendorCharge[];
  laundry: VendorCharge[];
};

const bankDateMs = (d: string): number => {
  const parts = d.split('/');
  if (parts.length !== 3) return NaN;
  return Date.UTC(Number(parts[2]), Number(parts[0]) - 1, Number(parts[1]));
};

/**
 * Net each credit against its own vendor family's charges, mutating the
 * matched charges in place. Returns the credits that found no match.
 * `nettedAt` names the pipeline in the stored reason ("ingest",
 * "bank re-upload") so a reader of the row knows which path wrote it.
 */
export function netVendorCredits(
  pools: VendorChargePools,
  credits: VendorCredit[],
  nettedAt: string,
): VendorCredit[] {
  const unmatched: VendorCredit[] = [];
  for (const credit of credits) {
    const pool: VendorCharge[] | null =
      credit.kind === 'cleaning' ? pools.cleaning :
      credit.kind === 'linen' ? pools.linen :
      credit.kind === 'laundry' ? pools.laundry : null;
    let target: VendorCharge | null = null;
    const creditMs = bankDateMs(credit.date);
    for (const ch of pool || []) {
      if (ch.credit_amount) continue;
      if (Math.abs(ch.amount - credit.amount) > 0.005) continue;
      if (!target) { target = ch; continue; }
      const a = Math.abs(bankDateMs(ch.date) - creditMs);
      const b = Math.abs(bankDateMs(target.date) - creditMs);
      if (!isNaN(a) && (isNaN(b) || a < b)) target = ch;
    }
    if (target) {
      target.credit_amount = credit.amount;
      target.credit_reason = `${credit.vendor} refund posted ${credit.date} (auto-netted at ${nettedAt})`;
    } else {
      unmatched.push(credit);
    }
  }
  return unmatched;
}

/** What the owner is billed for one charge: the amount net of its credit. */
export const vendorChargeNet = (c: VendorCharge): number => c.amount - (c.credit_amount || 0);

/** The credit columns to spread onto a cleaning_events insert. */
export const vendorCreditFields = (
  c: Pick<VendorCharge, 'credit_amount' | 'credit_reason'>,
): { credit_amount?: number; credit_reason?: string } =>
  c.credit_amount ? { credit_amount: c.credit_amount, credit_reason: c.credit_reason } : {};

// ---------------------------------------------------------------------------
// NOTE: operator-credit preservation across a wipe-and-rebuild used to live
// here and was REMOVED before merge. Matching a stored credit back to a
// rebuilt charge on (date, amount, family) is not sound: cleaning_events
// rows have no stable identity across a rebuild, credits have none at all,
// and this module's own auto-netting assigns credits to the same pool of
// charges by NEAREST date while the preservation matched on EXACT date. The
// two disagree, and an operator credit could then stand alongside the real
// refund it was standing in for, crediting one charge twice and over-paying
// the owner silently. Four rounds of review each closed one corner of that
// and opened another.
//
// The replacement is a durable operator-override row that survives the wipe
// and is re-applied every run, so a charge has exactly one credit and an
// override that cannot find its charge stays visible instead of being
// inferred. See the follow-up PR; do not re-add heuristic matching here.
// ---------------------------------------------------------------------------

export type VendorGap = { gap_type: string; description: string; severity: string; expected_data: string };

/** A vendor refund with no same-month exact-amount charge to net against. */
export function unappliedRefundGap(c: VendorCredit, opts: { parkedInQueue: boolean }): VendorGap {
  return {
    gap_type: 'vendor_refund_unapplied',
    description: `${c.vendor} sent money BACK: $${c.amount.toFixed(2)} credit on ${c.date} with no same-amount ${c.kind} charge this month to net it against. `
      + 'If it refunds a prior month\'s charge, apply a credit on that statement\'s row (Mark Duplicate)'
      + (opts.parkedInQueue ? '; the credit is also parked in the bank review queue.' : '.'),
    severity: 'critical',
    expected_data: `Matching ${c.vendor} charge for $${c.amount.toFixed(2)}`,
  };
}
