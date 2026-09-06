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
 * `retained` is Guesty's cached host_payout. It can be stale, synced
 * before the cancel or before a later refund, in which case it is the
 * pre-cancel figure and the verdict is retained_differs: loud and naming
 * both numbers, never a silent pass. A null retained is treated as
 * unknown-and-zero, which is the direction that flags rather than hides.
 */

const EPS = 0.005;
const round2 = (n: number) => Math.round(n * 100) / 100;

export type CancelledStayVerdict =
  | { kind: 'never_paid'; statementAmount: number }
  | { kind: 'retained_matches'; statementAmount: number; retained: number }
  | { kind: 'retained_differs'; statementAmount: number; retained: number; delta: number };

export function classifyCancelledStay(input: {
  statementAmount: number | null | undefined;
  retained: number | null | undefined;
}): CancelledStayVerdict {
  const statementAmount = round2(Number(input.statementAmount) || 0);
  const retained = round2(Number(input.retained) || 0);
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
 * it on every rebuild. The close-review count has no severity filter and a
 * pipeline-owned flag offers no Resolve, so one correct cancellation would
 * have blocked "Month is clear" for that month forever.
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
        description: `${guest} CANCELLED in Guesty with nothing retained under the cancellation policy, but is still on this statement at ${money(v.statementAmount)}. Remove it -- this booking never paid.${matchNote}`,
        severity: 'critical',
        expected_data: `reservation:${code}`,
      };
    case 'retained_matches':
      return null;
    case 'retained_differs':
      return {
        gap_type: 'cancelled_reservation_retained',
        description: `${guest} CANCELLED in Guesty; the cancellation policy retained ${money(v.retained)} but this statement carries ${money(v.statementAmount)} (${v.delta > 0 ? '+' : ''}${money(v.delta)}). Correct the amount to what was retained. Do NOT remove the row: the retained amount is the owner's revenue. If Guesty's figure looks stale, run Sync Guesty first.${matchNote}`,
        severity: 'warning',
        expected_data: `reservation:${code} retained:${v.retained.toFixed(2)}`,
      };
  }
}
