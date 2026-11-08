/**
 * An inspector's guest rating, the rules (2026-11-07). Pure.
 *
 * The chain field-ratings.ts draws for a Field contractor (packet, stop,
 * booking, the guest's review of that stay) is drawn here for ANY inspector
 * from the walks themselves, so a teammate's staff walks and the packets
 * they ran as a contractor before joining read as one record:
 *
 *   inspections (completed, inspector_email in theirs)
 *     -> the stay it prepped: the packet stop's booking when the walk was a
 *        Field stop, else the next canonical check-in at that home within
 *        NEXT_STAY_DAYS of the walk
 *     -> bookings.external_booking_id (the Guesty reservation)
 *     -> reviews.reservation_id -> overall_rating
 *
 * One review per stay, however many walks touched it.
 */

/** A check-in this many days after the walk still counts as the stay it prepped. */
export const NEXT_STAY_DAYS = 10;

export type WalkLite = {
  id: string;
  property_id: string;
  /** ISO timestamp; the walk's Eastern day is derived by the caller. */
  completed_at: string;
  /** Eastern calendar day, YYYY-MM-DD. */
  walkDate: string;
};

export type StayLite = {
  id: string;
  property_id: string;
  check_in: string;
  external_booking_id: string | null;
};

/**
 * Which stay each walk prepped: the stop's booking where one is known, else
 * the first canonical check-in at the home on or after the walk day, within
 * the window. Returns walk id -> booking id.
 */
export function matchWalksToStays(
  walks: readonly WalkLite[],
  stopBookingByWalk: ReadonlyMap<string, string>,
  stays: readonly StayLite[],
): Map<string, string> {
  const byHome = new Map<string, StayLite[]>();
  for (const s of stays) {
    const list = byHome.get(s.property_id) ?? [];
    list.push(s);
    byHome.set(s.property_id, list);
  }
  for (const list of byHome.values()) list.sort((a, b) => a.check_in.localeCompare(b.check_in));

  const out = new Map<string, string>();
  for (const w of walks) {
    const known = stopBookingByWalk.get(w.id);
    if (known) {
      out.set(w.id, known);
      continue;
    }
    const limit = addDays(w.walkDate, NEXT_STAY_DAYS);
    const next = (byHome.get(w.property_id) ?? []).find((s) => s.check_in >= w.walkDate && s.check_in <= limit);
    if (next) out.set(w.id, next.id);
  }
  return out;
}

export type ReviewLite = {
  reservation_id: string;
  overall_rating: number;
  review_created_at: string | null;
};

export type InspectorReview = {
  reservationId: string;
  bookingId: string;
  propertyId: string;
  rating: number;
  at: string;
};

/**
 * The inspector's reviews: one per reservation, the latest review where a
 * stay has more than one, newest first.
 */
export function collectInspectorReviews(
  walkToBooking: ReadonlyMap<string, string>,
  bookings: ReadonlyMap<string, StayLite>,
  reviews: readonly ReviewLite[],
): InspectorReview[] {
  const latest = new Map<string, ReviewLite>();
  for (const r of reviews) {
    const cur = latest.get(r.reservation_id);
    if (!cur || (r.review_created_at ?? '') > (cur.review_created_at ?? '')) latest.set(r.reservation_id, r);
  }
  const seen = new Set<string>();
  const out: InspectorReview[] = [];
  for (const bookingId of walkToBooking.values()) {
    const b = bookings.get(bookingId);
    const ext = b?.external_booking_id;
    if (!b || !ext || seen.has(ext)) continue;
    const r = latest.get(ext);
    if (!r) continue;
    seen.add(ext);
    out.push({ reservationId: ext, bookingId: b.id, propertyId: b.property_id, rating: r.overall_rating, at: r.review_created_at ?? '' });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export type RatingSummary = { count: number; avg: number | null; fiveStar: number };

export function summarizeRatings(reviews: ReadonlyArray<{ rating: number }>): RatingSummary {
  const count = reviews.length;
  const sum = reviews.reduce((s, r) => s + r.rating, 0);
  return { count, avg: count ? Math.round((sum / count) * 100) / 100 : null, fiveStar: reviews.filter((r) => r.rating >= 5).length };
}

/** `ymd` plus `days`, at noon UTC so no zone moves it. */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12) + days * 86_400_000).toISOString().slice(0, 10);
}
