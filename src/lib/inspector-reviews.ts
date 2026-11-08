import 'server-only';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { selectAllPaged } from '@/lib/paged-select';
import { etDateOf } from '@/lib/vendor-visit-dates';
import {
  addDays,
  collectInspectorReviews,
  matchWalksToStays,
  summarizeRatings,
  NEXT_STAY_DAYS,
  type InspectorReview,
  type RatingSummary,
  type ReviewLite,
  type StayLite,
  type WalkLite,
} from '@/lib/inspector-reviews-core';

/**
 * An inspector's guest rating, the reads (docs/cleaning-reviews.md). The
 * rules are in inspector-reviews-core.ts; this file only fetches. It reads
 * through the service role: inspections and reviews are RLS-locked.
 */

export type InspectorReviewRow = InspectorReview & {
  propertyName: string;
  guestName: string | null;
  channel: string | null;
  text: string | null;
};

export type InspectorRecord = {
  summary: RatingSummary;
  /** Newest first. */
  reviews: InspectorReviewRow[];
  /** Completed walks under these addresses, all time. */
  walks: number;
  /** Completed walks since `monthStart`. */
  walksThisMonth: number;
};

const EMPTY: InspectorRecord = { summary: { count: 0, avg: null, fiveStar: 0 }, reviews: [], walks: 0, walksThisMonth: 0 };

export async function loadInspectorRecord(emails: string[], now: Date = new Date()): Promise<InspectorRecord> {
  const list = [...new Set(emails.map((e) => e.toLowerCase().trim()).filter(Boolean))];
  if (list.length === 0) return EMPTY;

  const walkRows = await selectAllPaged<{ id: string; property_id: string; completed_at: string; inspector_email: string }>(
    (from, to) =>
      supabaseAdmin
        .from('inspections')
        .select('id, property_id, completed_at, inspector_email')
        .in('inspector_email', list)
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: false })
        .order('id')
        .range(from, to),
    { label: 'Inspector walks' },
  );
  const walks: WalkLite[] = walkRows.map((w) => ({ id: w.id, property_id: w.property_id, completed_at: w.completed_at, walkDate: etDateOf(w.completed_at) }));
  const monthStart = etDateOf(now).slice(0, 7) + '-01';
  const walksThisMonth = walks.filter((w) => w.walkDate >= monthStart).length;
  if (walks.length === 0) return { ...EMPTY };

  // The stop's own booking, where the walk was a Field stop.
  const walkIds = walks.map((w) => w.id);
  const stops = await selectAllPaged<{ inspection_id: string; booking_id: string | null }>(
    (from, to) =>
      supabaseAdmin
        .from('packet_stops')
        .select('inspection_id, booking_id')
        .in('inspection_id', walkIds)
        .not('booking_id', 'is', null)
        .order('inspection_id')
        .range(from, to),
    { label: 'Walk stops' },
  );
  const stopBookingByWalk = new Map(stops.filter((s) => s.booking_id).map((s) => [s.inspection_id, s.booking_id as string]));

  // Candidate stays: canonical bookings at the walked homes inside each
  // walk's window. One range read per home set, bounded by the oldest walk.
  const homeIds = [...new Set(walks.map((w) => w.property_id))];
  const oldest = walks.reduce((min, w) => (w.walkDate < min ? w.walkDate : min), walks[0].walkDate);
  const newest = walks.reduce((max, w) => (w.walkDate > max ? w.walkDate : max), walks[0].walkDate);
  const stays = await selectAllPaged<StayLite>(
    (from, to) =>
      supabaseAdmin
        .from('bookings')
        .select('id, property_id, check_in, external_booking_id')
        .in('property_id', homeIds)
        .is('duplicate_of', null)
        .in('status', ['confirmed', 'completed'])
        .gte('check_in', oldest)
        .lte('check_in', addDays(newest, NEXT_STAY_DAYS))
        .order('check_in')
        .order('id')
        .range(from, to),
    { label: 'Walked stays' },
  );
  // The stop bookings may sit outside that window (a stop keyed on a stay
  // the walk ran late for); read any not already in hand.
  const known = new Set(stays.map((s) => s.id));
  const missing = [...new Set([...stopBookingByWalk.values()])].filter((id) => !known.has(id));
  if (missing.length > 0) {
    const { data } = await supabaseAdmin.from('bookings').select('id, property_id, check_in, external_booking_id').in('id', missing);
    for (const b of (data ?? []) as StayLite[]) stays.push(b);
  }
  const bookings = new Map(stays.map((s) => [s.id, s]));

  const walkToBooking = matchWalksToStays(walks, stopBookingByWalk, stays);
  const extIds = [...new Set([...walkToBooking.values()].map((id) => bookings.get(id)?.external_booking_id).filter((x): x is string => !!x))];
  if (extIds.length === 0) return { ...EMPTY, walks: walks.length, walksThisMonth };

  const reviewRows = await selectAllPaged<ReviewLite & { property_id: string | null; guest_name: string | null; channel: string | null; public_review: string | null }>(
    (from, to) =>
      supabaseAdmin
        .from('reviews')
        .select('reservation_id, overall_rating, review_created_at, property_id, guest_name, channel, public_review')
        .in('reservation_id', extIds)
        .not('overall_rating', 'is', null)
        .order('review_created_at', { ascending: false })
        .order('id')
        .range(from, to),
    { label: 'Walked reviews' },
  );
  const detail = new Map(reviewRows.map((r) => [r.reservation_id, r]));
  const reviews = collectInspectorReviews(walkToBooking, bookings, reviewRows);

  const { data: props } = await supabaseAdmin.from('properties').select('id, name').in('id', homeIds);
  const names = new Map(((props ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));

  return {
    summary: summarizeRatings(reviews),
    reviews: reviews.map((r) => {
      const d = detail.get(r.reservationId);
      return {
        ...r,
        propertyName: names.get(r.propertyId) ?? r.propertyId,
        guestName: d?.guest_name ?? null,
        channel: d?.channel ?? null,
        text: d?.public_review ?? null,
      };
    }),
    walks: walks.length,
    walksThisMonth,
  };
}
