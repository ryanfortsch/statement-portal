/**
 * Does an open slip belong on a Field visit, judged by its scheduled date?
 *
 * Pure, so the rule is testable without a database. The Field packet lists
 * every open slip at the home (lib/field-packets.ts loadOpenSlipsForStops),
 * but a slip dated for a later day waits: it shows from the day before its
 * date onward, overdue included, because overdue work still needs doing.
 * That gate is Ryan's: gear for a July 31 guest must not ride a July 25
 * visit and get set up for whoever stays in between.
 *
 * A guest gear slip is dated the eve of its stay, and that date is a
 * deadline, not a start. When no visit lands on the eve, the plain gate hid
 * the slip from every visit before the family arrived. Delaney's 20 Hammond
 * packet on 2026-10-01 had no pack 'n play or high chair for the 10/05
 * check-in; the slip first showed on her next visit, after the guests were in.
 *
 * So a gear slip also rides an earlier visit when no OTHER guest arrives at
 * the home between that visit and its date: that visit is the last one
 * before the family. Ryan's case still waits, because the guest in between
 * arrives first. When the arrivals could not be read, the gear rides: a
 * missed crib is worse than an early one, and the row names its date.
 */
export const GEAR_KEY_PREFIX = 'gear:';

export type WindowSlip = {
  from_guest_request_key: string | null;
  scheduled_date?: string | null;
  /** The Guesty reservation the slip is pinned to, so the gear stay's own
   *  arrival is never counted as somebody else's. */
  guesty_reservation_id?: string | null;
};

/** A guest arrival at the home, with every id the booking answers to
 *  (bookings.id and its external_booking_id, which holds the Guesty id). */
export type HomeArrival = { check_in: string; ids: string[] };

function addDays(base: string, n: number): string {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** True when a dated gear slip sits past the plain window, so the caller
 *  knows the home's arrivals are worth reading. */
export function gearNeedsArrivals(slip: WindowSlip, visitDate: string): boolean {
  return (
    !!slip.from_guest_request_key?.startsWith(GEAR_KEY_PREFIX) &&
    !!slip.scheduled_date &&
    slip.scheduled_date > addDays(visitDate, 1)
  );
}

/**
 * @param arrivals the home's guest arrivals from the visit day on, or null
 *   when they could not be read.
 */
export function slipInVisitWindow(slip: WindowSlip, visitDate: string, arrivals: HomeArrival[] | null): boolean {
  const due = slip.scheduled_date;
  if (!due || due <= addDays(visitDate, 1)) return true;
  if (!slip.from_guest_request_key?.startsWith(GEAR_KEY_PREFIX)) return false;
  if (arrivals === null) return true;
  const own = slip.guesty_reservation_id ?? null;
  return !arrivals.some((a) => a.check_in >= visitDate && a.check_in <= due && !(own && a.ids.includes(own)));
}
