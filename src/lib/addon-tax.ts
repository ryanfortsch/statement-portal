/**
 * Occupancy tax on guest add-on charges.
 *
 * A late checkout, an extra night, an early check-in, a pet fee: all of
 * that is rent for occupancy, and MA room occupancy excise is owed on it
 * exactly as it is on the nightly rate. Until 2026-08-27 the bridge minted
 * those payment links at the bare quoted fee, so the tax was never
 * collected from the guest and never reached the accountant's remittance
 * sheet. Ed Brooke's $250 late checkout on 73 Rocky Neck (June, recognized
 * on the July statement) is the case that surfaced it.
 *
 * The rule now: the guest pays fee + tax, and the tax rides separately
 * through the statements extras queue so month-close can remit it.
 *
 * Two kinds of link are deliberately NOT grossed up:
 *   - far-future booking deposits and balance charges (`ffdeposit:` /
 *     `ffbalcharge:` request keys). Those are stay PRINCIPAL, and the
 *     Stay Cape Ann quote that produced the number already includes
 *     occupancy tax. Taxing again would double-charge the guest.
 *   - anything the caller explicitly marks `taxable: false`, for the
 *     charge that is not rent: a damage reimbursement, a replacement
 *     cost, a lost-key fee.
 */

import { owedOccupancyTaxRate } from '@/lib/occupancy-tax';

/** Request keys whose amount is stay principal, already tax-inclusive. */
const PRINCIPAL_KEY = /^(ffdeposit|ffbalcharge):/;

export type AddOnTaxSplit = {
  /** The fee as quoted to the guest, in cents. */
  baseCents: number;
  /** Occupancy tax added on top, in cents. 0 when not taxable. */
  taxCents: number;
  /** What the card is actually charged, in cents. */
  totalCents: number;
  /** Rate used (0.117 / 0.147), or 0 when not taxable. */
  rate: number;
};

/**
 * Whether an add-on link should carry occupancy tax. `taxable` from the
 * caller wins when present; otherwise every non-principal add-on is taxed,
 * because an add-on fee is rent by default.
 */
export function addOnIsTaxable(args: {
  requestKey: string;
  saveCard: boolean;
  taxable?: boolean;
}): boolean {
  if (args.taxable === false) return false;
  if (args.saveCard || PRINCIPAL_KEY.test(args.requestKey)) return false;
  return true;
}

/**
 * Split a quoted fee into base + occupancy tax for one property on one
 * date. `chargeCreatedIso` drives the Community Impact Fee date gate in
 * lib/occupancy-tax.ts, so a rate that starts mid-history never rewrites
 * an older charge.
 */
export function splitAddOnTax(args: {
  propertyId: string;
  baseCents: number;
  chargeCreatedIso: string;
  taxable: boolean;
}): AddOnTaxSplit {
  const base = Math.round(args.baseCents);
  if (!args.taxable) {
    return { baseCents: base, taxCents: 0, totalCents: base, rate: 0 };
  }
  // OWED, not billed: a new add-on fee should carry the tax the property
  // actually owes even when its Guesty listing is mispriced, or we mint a
  // payment link that over-charges the guest the same way the folio does.
  const rate = owedOccupancyTaxRate(args.propertyId, args.chargeCreatedIso);
  const taxCents = Math.round(base * rate);
  return { baseCents: base, taxCents, totalCents: base + taxCents, rate };
}

/** "11.7%" / "14.7%" for guest-facing and operator-facing copy. */
export function formatTaxRate(rate: number): string {
  return `${(rate * 100).toFixed(1).replace(/\.0$/, '')}%`;
}

/**
 * The tax carried inside a paid add-on charge, derived from its
 * payment_link_requests row. Returns 0 for links minted before the
 * gross-up (tax_cents defaults to 0) and for non-bridge charges, which is
 * what keeps every historical statement's numbers identical.
 *
 * Capped at the net so a fully-fee-eaten micro-charge can never push the
 * owner's add-on revenue negative.
 */
export function taxPortionOfNet(args: { netCents: number; taxCents: number }): number {
  if (!Number.isFinite(args.taxCents) || args.taxCents <= 0) return 0;
  return Math.max(0, Math.min(Math.round(args.taxCents), Math.round(args.netCents)));
}
