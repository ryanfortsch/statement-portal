// Is there real bank evidence that Booking.com paid this stay?
//
// Booking.com pays into the central *5623 account and we forward it to the
// property's checking as a plain "Online Transfer". A stay is corroborated
// only when a forwarded transfer's AMOUNT accounts for it: within $5 of the
// stay itself, or of all the month's Booking.com stays at the property
// together (one batched payout). The old rules ("any Booking.com text in the
// bank CSV", "any transfer to this property in the window") marked stays
// matched with no money behind them: Scott Carpenter, 20 Enon, Sept 2026,
// showed a check while no transfer to *1307 existed (Dotti, 2026-10-01).
export function bookingTransferCorroborates(
  stayIncome: number,
  monthBookingTotal: number,
  transferAmounts: number[],
): number | null {
  for (const t of transferAmounts) {
    const amt = Math.abs(t);
    if (Math.abs(amt - stayIncome) < 5) return amt;
    if (monthBookingTotal > stayIncome && Math.abs(amt - monthBookingTotal) < 5) return amt;
  }
  return null;
}
