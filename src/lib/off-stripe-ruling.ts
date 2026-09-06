/**
 * The "paid off Stripe" operator ruling, and how to re-apply it.
 *
 * Pure: no imports, no IO, so `node --test` loads it bare.
 *
 * When Stripe shows no charge for a stay, /api/resolve-gap lets the
 * operator rule that the guest paid by check, ACH or wire. That ruling
 * writes three things onto the reservation: `stripe_fee = 0`, the
 * reclaimed fee rolled back into `adjusted_revenue`, and
 * `bank_match_status = 'paid_off_stripe'`. resolve-gap is the ONLY writer
 * of that marker, and it deletes the gap afterwards, so the marker is the
 * single surviving record that the ruling was ever made.
 *
 * /api/ingest wipes and rebuilds every reservation from the Guesty PDF.
 * The rebuild recomputes `stripe_fee` from the 3.9% estimate and writes a
 * fresh `bank_match_status`, so without this module a re-ingest silently
 * reverses the ruling: the fee comes back, the payout drops, and the
 * marker that would have shown what happened is gone. On a $4,000 wired
 * Direct stay that is about $117 off the owner's payout at a 25% fee.
 *
 * What is re-applied is the RULING, not the old numbers. Zero the fee that
 * THIS run computed and roll THAT amount into THIS run's revenue, so a
 * corrected PDF still takes effect. Restoring the previous absolute values
 * would freeze the stay at whatever it was the day the operator ruled.
 */

export const OFF_STRIPE_STATUS = 'paid_off_stripe';

export type OffStripeRow = {
  confirmation_code: string;
  stripe_fee: number;
  adjusted_revenue: number;
  bank_match_status: string;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export type OffStripeOutcome = {
  /** Total fee reclaimed into revenue. Callers must add this to their revenue running total and subtract it from their fee total. */
  reclaimed: number;
};

/**
 * Re-apply the ruling in place to every rebuilt row whose confirmation
 * code was ruled off-Stripe. Keyed on the code because the ruling is about
 * the STAY: codes survive a rebuild, row ids do not.
 *
 * The marker is written UNCONDITIONALLY for a ruled code, including on a
 * row this run priced at no fee. That is the whole point: the marker IS
 * the record, so any path that skips writing it lets one rebuild delete
 * the ruling for good.
 *
 * The money is conditional only on whether THIS run actually computed a
 * fee. Deliberately NOT on the channel: ingest already made that decision
 * when it priced the row, and a second, slightly different channel test
 * here is exactly where the two drift apart (ingest accepts any platform
 * containing 'VRBO'; a stricter equality test here would refuse to
 * reclaim a fee ingest had just charged, and a run where the platform
 * resolved to 'Unknown' would drop the ruling entirely). Airbnb and
 * Booking.com rows are priced at no fee anyway, so they reclaim nothing.
 */
export function applyOffStripeRulings<T extends OffStripeRow>(
  rows: T[],
  ruledCodes: Set<string>,
): OffStripeOutcome {
  let reclaimed = 0;

  for (const row of rows) {
    if (!ruledCodes.has(row.confirmation_code)) continue;
    const fee = Number(row.stripe_fee) || 0;
    if (fee > 0) {
      row.adjusted_revenue = round2((Number(row.adjusted_revenue) || 0) + fee);
      row.stripe_fee = 0;
      reclaimed = round2(reclaimed + fee);
    }
    row.bank_match_status = OFF_STRIPE_STATUS;
  }

  return { reclaimed };
}
