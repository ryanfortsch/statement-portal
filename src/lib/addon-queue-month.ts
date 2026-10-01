// Which statement month a paid add-on link belongs to.
//
// Revenue is recognized at checkout, so an add-on paid BEFORE the stay (a pet
// fee paid in September for a November stay) belongs on the stay's own
// checkout month, not the month the card was charged. Filing it under the
// charge month hid Christie Cheyne's and Lida Stifel's pet fees from the
// statement they belonged to (Dotti, 2026-10-01).
//
// Never moves a row EARLIER: an add-on paid after checkout (damage, a late
// replacement charge) stays in the charge month, because the stay's own
// statement may already be sent.
export function addonQueueMonth(chargeMonth: string, stayCheckOut: string | null | undefined): string {
  const checkoutMonth = (stayCheckOut || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(checkoutMonth)) return chargeMonth;
  return checkoutMonth > chargeMonth ? checkoutMonth : chargeMonth;
}
