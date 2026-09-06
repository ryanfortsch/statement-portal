/**
 * What a cancelled stay means for the statement. Pure, no imports.
 *
 * "Cancelled" does not mean "never paid". Airbnb (and Booking.com) apply
 * the host's cancellation policy and pay the host whatever it retains;
 * Guesty records that as host_payout and its owner statement lists the
 * retained net. Catherine Dixon, 20 Hammond, cancelled August 10 2026 for
 * an October stay: the policy kept $775.29, Guesty's PDF listed $775.29,
 * and Helm's cancel check said "never paid, remove it". The row was
 * removed from the sent August statement. The owner was short $581.47.
 *
 * So a cancelled stay is one of three things, and only the first is
 * "remove it":
 *   never_paid        nothing was retained: the row is a phantom
 *   retained_matches  the statement carries exactly what was retained
 *   retained_differs  something was retained and the statement carries
 *                     a different amount (stale cache, hand edit, or a
 *                     refund after the sync): correct the AMOUNT, do not
 *                     remove the row
 *
 * `retained` must be Guesty's LIVE money.hostPayout for the booking, read
 * after the cancel. The cached column is written only by the full nightly
 * sync, so for any booking cancelled since it is the PRE-cancel figure,
 * and on a full-refund cancel that figure equals the statement line: a
 * classifier fed the cache would call the phantom "retained, matches" and
 * go quiet, which is the exact leak the cancel guard exists to catch.
 * When the live figure is not available the verdict is retained_unknown,
 * which is loud. Absence of data is never a fact.
 *
 * Airbnb only. Airbnb's hostPayout equals the PDF's rental income line to
 * the cent (accommodation plus cleaning, less the host fee, taxes excluded,
 * because Airbnb remits the tax). Booking.com's is tax-inclusive where the
 * host remits, so it does not compare to the PDF line; a Booking.com
 * cancellation is retained_unknown until someone reads the folio.
 */

const EPS = 0.005;
const round2 = (n: number) => Math.round(n * 100) / 100;

export type CancelledStayVerdict =
  | { kind: 'never_paid'; statementAmount: number }
  | { kind: 'retained_matches'; statementAmount: number; retained: number }
  | { kind: 'retained_differs'; statementAmount: number; retained: number; delta: number }
  | { kind: 'retained_unknown'; statementAmount: number; reason: 'no_live_figure' | 'channel_basis' };

export const isAirbnb = (platform: string | null | undefined): boolean => (platform || '').toUpperCase() === 'AIRBNB';

export function classifyCancelledStay(input: {
  statementAmount: number | null | undefined;
  /** Guesty's LIVE money.hostPayout. Null = Guesty did not return it. */
  retained: number | null | undefined;
  platform: string | null | undefined;
}): CancelledStayVerdict {
  const statementAmount = round2(Number(input.statementAmount) || 0);
  if (!isAirbnb(input.platform)) return { kind: 'retained_unknown', statementAmount, reason: 'channel_basis' };
  if (input.retained === null || input.retained === undefined || !Number.isFinite(Number(input.retained))) {
    return { kind: 'retained_unknown', statementAmount, reason: 'no_live_figure' };
  }
  const retained = round2(Number(input.retained));
  if (retained <= EPS) return { kind: 'never_paid', statementAmount };
  const delta = round2(statementAmount - retained);
  if (Math.abs(delta) <= EPS) return { kind: 'retained_matches', statementAmount, retained };
  return { kind: 'retained_differs', statementAmount, retained, delta };
}

/**
 * The data_gaps row for a verdict, or null when there is nothing to do.
 *
 * `retained_matches` files NOTHING on purpose. The statement is right, so a
 * flag would be a standing notice with no action, and ingest would re-file
 * it on every rebuild. The close-review count has no severity filter, so
 * one correct cancellation would have blocked "Month is clear" forever.
 */
export function cancelledStayGap(
  v: CancelledStayVerdict,
  guest: string,
  code: string,
  matchNote = '',
): { gap_type: string; description: string; severity: string; expected_data: string } | null {
  const money = (n: number) => `$${n.toFixed(2)}`;
  switch (v.kind) {
    case 'never_paid':
      return {
        gap_type: 'cancelled_reservation',
        description: `${guest} CANCELLED in Guesty, and Guesty reports $0.00 retained under the cancellation policy, but the stay is still on this statement at ${money(v.statementAmount)}. Remove it -- this booking never paid.${matchNote}`,
        severity: 'critical',
        expected_data: `reservation:${code}`,
      };
    case 'retained_matches':
      return null;
    case 'retained_differs':
      return {
        gap_type: 'cancelled_reservation_retained',
        description: `${guest} CANCELLED in Guesty; the cancellation policy retained ${money(v.retained)} but this statement carries ${money(v.statementAmount)} (${v.delta > 0 ? '+' : ''}${money(v.delta)}). The retained amount is the owner's revenue: correct the amount, do NOT remove the row.${matchNote}`,
        severity: 'warning',
        expected_data: `reservation:${code} retained:${v.retained.toFixed(2)}`,
      };
    case 'retained_unknown':
      return {
        gap_type: 'cancelled_reservation',
        description: v.reason === 'channel_basis'
          ? `${guest} CANCELLED in Guesty and is still on this statement at ${money(v.statementAmount)}. Helm cannot tell what a Booking.com cancellation retained (the channel's payout figure includes tax), so check the folio in Guesty: if money was retained the statement should carry that amount; if nothing was, remove it.${matchNote}`
          : `${guest} CANCELLED in Guesty and is still on this statement at ${money(v.statementAmount)}, and Helm could not read what the cancellation policy retained. Do NOT remove it until you have checked the payout in Airbnb or Guesty: a retained amount is the owner's revenue.${matchNote}`,
        severity: 'critical',
        expected_data: `reservation:${code} retained:unknown`,
      };
  }
}
