/**
 * A link into the Stripe lookup (/payments) for one guest, prefilled so the
 * question "did they pay?" is one click from where it is asked: the guest
 * card in Messaging and the booking record.
 *
 * Searches by email (the surest match), or by name when there is no email.
 * The window ends at checkout and starts the day before the booking was
 * made when that is known; otherwise the lookup's own default lookback
 * (400 days before the end) covers a deposit taken at booking.
 *
 * Owners only, like the page: callers render it for an owner session.
 * Pure, no imports.
 */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function stripeLookupHref(guest: {
  email?: string | null;
  name?: string | null;
  /** When the booking was made: a timestamp or a YYYY-MM-DD day. */
  bookedAt?: string | null;
  checkOut?: string | null;
}): string | null {
  const p = new URLSearchParams();
  const email = (guest.email ?? '').trim();
  const name = (guest.name ?? '').trim();
  if (email) p.set('email', email);
  else if (name) p.set('q', name);
  else return null;
  const booked = (guest.bookedAt ?? '').slice(0, 10);
  // The day before, so an evening booking stamped in UTC still falls inside
  // a window the lookup reads in Cape Ann time.
  if (ISO_DAY.test(booked)) p.set('from', dayBefore(booked));
  const to = (guest.checkOut ?? '').slice(0, 10);
  if (ISO_DAY.test(to)) p.set('to', to);
  return `/payments?${p.toString()}`;
}
