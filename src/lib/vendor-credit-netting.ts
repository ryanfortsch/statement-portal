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

/**
 * Which vendor family a stored cleaning_events row belongs to, for the
 * purpose of matching a preserved credit back to its rebuilt charge.
 *
 * 'matched', 'bank' and 'corroborated' are ALL the same Cape Ann Elite
 * bank charge: 'matched' vs 'bank' is only whether a checkout was found,
 * and /api/sync-invoices flips a matched/bank row to 'corroborated' in
 * place when it attaches the QuickBooks invoice. That flip is the routine
 * monthly close step, so a credit the operator applied to an
 * invoice-verified charge MUST still find its charge after a rebuild
 * re-inserts it as plain 'matched'/'bank'.
 */
const sourceFamily = (source: string): string =>
  (source === 'matched' || source === 'bank' || source === 'corroborated') ? 'cleaning' : source;

/**
 * The families a preserved credit can meaningfully belong to. Mirrors
 * CLEANING_MONEY_SOURCES in statement-totals.ts collapsed through
 * sourceFamily -- kept as a literal rather than an import so this module
 * stays dependency-free and loads bare under `node --test`.
 *
 * A credit on a source='invoice' row is NOT here on purpose. Invoice rows
 * are attribution, never money: deriveCleaningTotal skips them, so such a
 * credit bills nothing and its loss costs nothing. Orphaning it would file
 * a critical notice claiming the owner is now billed gross, which is false.
 */
const MONEY_FAMILIES = new Set(['cleaning', 'bank-linen', 'bank-laundry']);

const AUTO_NETTED_MARK = '(auto-netted at';

/**
 * Stable machine key for a preserved credit: date|charge|family|credit.
 *
 * The CREDIT amount is part of the key on purpose. Keyed on the charge
 * alone, two different notices about the same $250 charge (a $60 partial
 * and a $250 duplicate) collapse into one and the other is deleted, and a
 * $250 credit could answer a notice about a $60 one.
 */
export function orphanCreditKey(
  pc: Pick<PreservedCleaningCredit, 'bank_charge_date' | 'bank_charge_amount' | 'source' | 'credit_amount'>,
): string {
  const amt = Number(pc.bank_charge_amount);
  const charge = pc.bank_charge_amount !== null && Number.isFinite(amt) ? amt.toFixed(2) : '?';
  const cred = Number(pc.credit_amount);
  const credit = Number.isFinite(cred) ? cred.toFixed(2) : '?';
  return `${pc.bank_charge_date || '?'}|${charge}|${sourceFamily(pc.source)}|${credit}`;
}

/** Read the key back off a stored gap's expected_data. Null if absent. */
export function parseOrphanCreditKey(expectedData: string | null): string | null {
  const m = (expectedData || '').match(/key=([^\s]+)$/);
  return m ? m[1] : null;
}

/**
 * True when the rebuilt rows now contain the charge this key describes AND
 * that charge carries a credit again. That is the natural exit for a
 * carried `cleaning_credit_orphaned` notice: the operator re-applied the
 * credit, so the notice has answered itself and must not be re-filed.
 */
export function orphanCreditRestored<T extends CreditableInsert>(inserts: T[], key: string): boolean {
  return inserts.some(ins => {
    if (!ins.credit_amount) return false;
    // ONLY an operator credit answers the notice. A credit the netting
    // pass wrote this run is the pipeline's own work: counting it as the
    // operator's re-application is how a notice retired itself on the very
    // next ingest, since the auto-netted sibling that CAUSED the orphan
    // shares the orphaned credit's charge. Absence of the operator's
    // action is not evidence the operator acted.
    if ((ins.credit_reason || '').includes(AUTO_NETTED_MARK)) return false;
    return orphanCreditKey({
      bank_charge_date: ins.bank_charge_date,
      bank_charge_amount: ins.bank_charge_amount,
      source: ins.source,
      credit_amount: ins.credit_amount,
    }) === key;
  });
}

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
 *
 * Returns the orphans plus `applied`, the total credit actually re-applied.
 * Callers need that number: a caller that computed a cleaning total BEFORE
 * this pass (both /api/ingest and /api/fill-gap do) is holding a figure
 * that is gross by exactly `applied`, and comparing it to what the write
 * path derives from the rows would otherwise read as a real divergence.
 */
export function reapplyPreservedCredits<T extends CreditableInsert>(
  inserts: T[],
  preserved: PreservedCleaningCredit[],
): { orphaned: PreservedCleaningCredit[]; applied: number } {
  const orphaned: PreservedCleaningCredit[] = [];
  let applied = 0;
  for (const pc of preserved) {
    if ((pc.credit_reason || '').includes(AUTO_NETTED_MARK)) continue;
    // A credit on a non-money row (source='invoice') bills nothing, so it
    // is neither re-applied nor orphaned. Silently dropping it is correct:
    // the row it rode on is attribution that the rebuild re-derives.
    if (!MONEY_FAMILIES.has(sourceFamily(pc.source))) continue;
    const pcAmount = Number(pc.bank_charge_amount);
    if (!Number.isFinite(pcAmount) || pc.bank_charge_amount === null) { orphaned.push(pc); continue; }
    const candidates = inserts.filter(ins =>
      ins.bank_charge_date === pc.bank_charge_date &&
      Math.abs(ins.bank_charge_amount - pcAmount) <= 0.005 &&
      sourceFamily(ins.source) === sourceFamily(pc.source));
    // If a charge with this exact key already carries an AUTO-NETTED
    // credit, the vendor's refund has actually posted this round. The
    // operator's own credit was standing in for that refund, and applying
    // it to a sibling charge would zero a second, real charge: two $250
    // cleanings billed as $0 instead of $250. Orphan it and let a human
    // decide, rather than move money on a guess.
    if (candidates.some(ins => (ins.credit_reason || '').includes(AUTO_NETTED_MARK))) {
      orphaned.push(pc);
      continue;
    }
    const target = candidates.find(ins => !ins.credit_amount);
    if (target) {
      target.credit_amount = Math.round(Math.min(Number(pc.credit_amount) || 0, target.amount) * 100) / 100;
      target.credit_reason = pc.credit_reason || 'Operator credit (preserved across re-ingest)';
      applied = Math.round((applied + target.credit_amount) * 100) / 100;
    } else if (candidates.length === 0) {
      orphaned.push(pc);
    }
    // candidates exist but every one already carries a credit: the refund
    // is netted this round; nothing to add and nothing to flag.
  }
  return { orphaned, applied };
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
  const hasAmount = pc.bank_charge_amount !== null && Number.isFinite(chargeAmt);
  const chargeLabel = `${pc.vendor || pc.source} charge${hasAmount ? ` of $${chargeAmt.toFixed(2)}` : ' of an unrecorded amount'} on ${pc.bank_charge_date || 'an unknown date'}`;
  return {
    gap_type: 'cleaning_credit_orphaned',
    description: `The rebuild could not re-apply the $${creditAmt} credit the operator had placed on the ${chargeLabel}${pc.credit_reason ? ` ("${pc.credit_reason}")` : ''}: no matching charge in the re-uploaded bank CSV. cleaning_total currently bills WITHOUT it. Re-apply the credit on the right row (Mark Duplicate) or confirm the charge is gone, then resolve.`,
    severity: 'critical',
    // The trailing key= token is machine-read by the re-ingest carry so a
    // notice can retire itself once the credit is demonstrably back.
    expected_data: `${chargeLabel} carrying a $${creditAmt} credit · key=${orphanCreditKey(pc)}`,
  };
}
