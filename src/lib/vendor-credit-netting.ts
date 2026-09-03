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
// Operator credits across a wipe-and-rebuild
// ---------------------------------------------------------------------------

/** A credit read off a cleaning_events row before the row is wiped. */
export type PreservedCleaningCredit = {
  bank_charge_date: string | null;   // ISO YYYY-MM-DD
  bank_charge_amount: number | null;
  source: string;
  vendor: string | null;
  credit_amount: number;
  credit_reason: string | null;
};

/** The shape of a cleaning_events insert the re-apply can write onto. */
export type CreditableInsert = {
  bank_charge_date: string | null;
  bank_charge_amount: number;
  amount: number;
  source: string;
  credit_amount?: number;
  credit_reason?: string;
};

const sourceFamily = (source: string): string =>
  (source === 'matched' || source === 'bank') ? 'cleaning' : source;

/**
 * Re-apply credits the operator had placed by hand onto the rebuilt rows,
 * BEFORE they are inserted. A credit rides on a charge, and a charge is
 * identified across rebuilds by bank date + amount + family ('matched' and
 * 'bank' are the same Cape Ann Elite charge whose checkout match may have
 * changed). Rules:
 *
 *   - auto-netted credits are skipped: the netting pass recomputes them
 *     fresh from this upload's rows
 *   - a charge that already carries a credit is left alone, so a refund
 *     is never counted twice
 *   - the credit is capped at the charge amount
 *   - a credit whose charge did not come back in the new CSV is returned
 *     so the caller files `cleaning_credit_orphaned`. Until the operator
 *     decides, the owner is billed the gross -- visibly, not silently.
 */
export function reapplyPreservedCredits<T extends CreditableInsert>(
  inserts: T[],
  preserved: PreservedCleaningCredit[],
): PreservedCleaningCredit[] {
  const orphaned: PreservedCleaningCredit[] = [];
  for (const pc of preserved) {
    if ((pc.credit_reason || '').includes('(auto-netted at')) continue;
    const pcAmount = Number(pc.bank_charge_amount);
    const candidates = inserts.filter(ins =>
      ins.bank_charge_date === pc.bank_charge_date &&
      Number.isFinite(pcAmount) && Math.abs(ins.bank_charge_amount - pcAmount) <= 0.005 &&
      sourceFamily(ins.source) === sourceFamily(pc.source));
    const target = candidates.find(ins => !ins.credit_amount);
    if (target) {
      target.credit_amount = Math.round(Math.min(Number(pc.credit_amount) || 0, target.amount) * 100) / 100;
      target.credit_reason = pc.credit_reason || 'Operator credit (preserved across re-ingest)';
    } else if (candidates.length === 0) {
      orphaned.push(pc);
    }
    // candidates exist but every one already carries a credit: the refund
    // is netted this round; nothing to add and nothing to flag.
  }
  return orphaned;
}

// ---------------------------------------------------------------------------
// The two gaps both pipelines raise, worded once
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

/** A hand-applied credit whose charge did not come back in the re-upload. */
export function orphanedCreditGap(pc: PreservedCleaningCredit): VendorGap {
  const chargeAmt = Number(pc.bank_charge_amount);
  const creditAmt = (Number(pc.credit_amount) || 0).toFixed(2);
  const chargeLabel = `${pc.vendor || pc.source} charge${Number.isFinite(chargeAmt) ? ` of $${chargeAmt.toFixed(2)}` : ''} on ${pc.bank_charge_date || 'an unknown date'}`;
  return {
    gap_type: 'cleaning_credit_orphaned',
    description: `The rebuild could not re-apply the $${creditAmt} credit the operator had placed on the ${chargeLabel}${pc.credit_reason ? ` ("${pc.credit_reason}")` : ''}: no matching charge in the re-uploaded bank CSV. cleaning_total currently bills WITHOUT it. Re-apply the credit on the right row (Mark Duplicate) or confirm the charge is gone, then resolve.`,
    severity: 'critical',
    expected_data: `${chargeLabel} carrying a $${creditAmt} credit`,
  };
}
