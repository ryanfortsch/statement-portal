/**
 * Recent stays for the Reviews tab: one row per checkout in the window, with
 * whether we asked for a review and whether one came in.
 *
 * Three sources, each answering what only it knows:
 * - `guesty_reservations`, the stays. The review ledger and the reviews table
 *   both key on the Guesty reservation id, so this is the one table all three
 *   join on. Read for names, dates and channel only, never money.
 * - `reviews`, whether a review arrived. It is what the Reviews list shows,
 *   so the two views agree.
 * - stay-concierge's review ledger (`getReviewAsks`), whether we asked. When
 *   it cannot be read, every row says "Ask history unavailable" rather than
 *   pretending nobody was asked.
 *
 * The phrasing is review-ask-state.ts; this file only loads and joins.
 */

import { supabaseAdmin as supabase, isServiceConfigured } from '@/lib/supabase-admin';
import { getReviewAsks } from '@/lib/stay-concierge';
import { todayInEastern, shiftIsoDay } from '@/lib/sca-quotes-types';
import {
  DEFAULT_ASK_SETTINGS,
  describeAsk,
  describeReview,
  firstName,
  realStays,
  windowCovering,
  type AskLine,
  type ReservationReviewAsk,
  type ReviewAskSettings,
  type ReviewLine,
  type StayReview,
} from '@/lib/review-ask-state';

export type RecentStay = {
  reservationId: string;
  propertyId: string;
  guestFirst: string;
  checkOut: string;
  channel: string;
  ask: AskLine;
  review: ReviewLine;
  /** The review row to link to, when the Reviews list shows it. */
  reviewLink: { id: string; days: number } | null;
};

export type RecentStaysResult = {
  stays: RecentStay[];
  /** False when the review ledger could not be read. */
  askHistory: boolean;
  /** More checkouts matched than the page shows. */
  truncated: boolean;
};

const MAX_ROWS = 200;

type StayDbRow = {
  guesty_reservation_id: string;
  property_id: string;
  guest_name: string | null;
  check_in: string | null;
  check_out: string;
  channel: string | null;
  status: string | null;
};

type ReviewDbRow = {
  id: string;
  reservation_id: string | null;
  overall_rating: number | null;
  review_created_at: string | null;
  source: string | null;
};

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** One review per reservation: a rated API row over a placeholder or a CSV twin. */
async function reviewsFor(reservationIds: string[]): Promise<Map<string, ReviewDbRow>> {
  const best = new Map<string, ReviewDbRow>();
  const score = (r: ReviewDbRow) => (r.overall_rating != null ? 2 : 0) + (r.source === 'csv-fallback' ? 0 : 1);
  for (const ids of chunks(reservationIds, 100)) {
    const { data, error } = await supabase
      .from('reviews')
      .select('id, reservation_id, overall_rating, review_created_at, source')
      .in('reservation_id', ids);
    if (error) throw error;
    for (const r of (data ?? []) as ReviewDbRow[]) {
      if (!r.reservation_id) continue;
      const cur = best.get(r.reservation_id);
      if (!cur || score(r) > score(cur)) best.set(r.reservation_id, r);
    }
  }
  return best;
}

export async function loadRecentStays(opts: {
  days: number;
  windows: readonly number[];
  activePropertyIds: string[];
  propertyId?: string;
  channel?: string;
  search?: string;
}): Promise<RecentStaysResult> {
  const empty: RecentStaysResult = { stays: [], askHistory: true, truncated: false };
  if (!isServiceConfigured) return empty;
  const propertyIds = opts.propertyId ? [opts.propertyId] : opts.activePropertyIds;
  if (propertyIds.length === 0) return empty;

  const today = todayInEastern();
  let q = supabase
    .from('guesty_reservations')
    .select('guesty_reservation_id, property_id, guest_name, check_in, check_out, channel, status')
    .in('property_id', propertyIds)
    .gte('check_out', shiftIsoDay(today, -opts.days))
    .lte('check_out', today)
    .order('check_out', { ascending: false })
    .order('guesty_reservation_id', { ascending: true })
    .limit(MAX_ROWS * 2);
  if (opts.channel) q = q.eq('channel', opts.channel);
  if (opts.search) q = q.ilike('guest_name', `%${opts.search}%`);
  const { data, error } = await q;
  if (error) throw error;

  const rows = realStays(
    ((data ?? []) as StayDbRow[]).map((r) => ({
      ...r,
      reservationId: r.guesty_reservation_id,
      propertyId: r.property_id,
      checkIn: r.check_in,
      checkOut: r.check_out,
    })),
  );
  const shown = rows.slice(0, MAX_ROWS);
  const ids = shown.map((r) => r.reservationId);

  const [reviews, asks] = await Promise.all([
    reviewsFor(ids),
    ids.length > 0 ? getReviewAsks(ids) : Promise.resolve(null),
  ]);

  let settings: ReviewAskSettings = DEFAULT_ASK_SETTINGS;
  let askById: Map<string, ReservationReviewAsk> | null = new Map();
  if (asks && asks.ok) {
    settings = asks.data;
    askById = new Map(asks.data.reservations.map((a) => [a.reservation_id, a]));
  } else if (asks) {
    askById = null; // unreadable: say so on every row
  }
  const excluded = new Set(settings.excluded_slugs ?? []);

  const stays: RecentStay[] = [];
  for (const r of shown) {
    if (excluded.has(r.propertyId)) continue; // not a Rising Tide home to ask for
    const rev = reviews.get(r.reservationId) ?? null;
    const review: StayReview = rev ? { rating: rev.overall_rating, createdAt: rev.review_created_at } : null;
    const facts = { checkOut: r.checkOut, channel: r.channel ?? '' };
    const ask = askById ? askById.get(r.reservationId) ?? null : 'unavailable';
    // The Reviews list hides unrated placeholder rows, so only a rated review
    // has a row to link to.
    const reviewLink =
      rev && rev.overall_rating != null && rev.review_created_at
        ? { id: rev.id, days: windowCovering(rev.review_created_at.slice(0, 10), today, opts.windows) }
        : null;
    stays.push({
      reservationId: r.reservationId,
      propertyId: r.propertyId,
      guestFirst: firstName(r.guest_name),
      checkOut: r.checkOut,
      channel: r.channel ?? '',
      ask: describeAsk(facts, ask, settings, today, review),
      review: describeReview(facts, review, today, ask !== 'unavailable' && !!ask?.guest_reported_review),
      reviewLink,
    });
  }
  return { stays, askHistory: askById !== null, truncated: rows.length > MAX_ROWS };
}

/** For each listed review, the window on the Recent stays view that holds its
 *  stay, so a review row can link to the stay and back. */
export async function stayWindowsForReviews(
  reservationIds: string[],
  windows: readonly number[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = [...new Set(reservationIds.filter(Boolean))];
  if (!isServiceConfigured || ids.length === 0) return out;
  const today = todayInEastern();
  const oldest = shiftIsoDay(today, -windows[windows.length - 1]);
  try {
    for (const chunk of chunks(ids, 100)) {
      const { data, error } = await supabase
        .from('guesty_reservations')
        .select('guesty_reservation_id, check_out')
        .in('guesty_reservation_id', chunk);
      if (error) throw error;
      for (const r of (data ?? []) as Array<{ guesty_reservation_id: string; check_out: string | null }>) {
        if (!r.check_out || r.check_out > today || r.check_out < oldest) continue;
        out.set(r.guesty_reservation_id, windowCovering(r.check_out, today, windows));
      }
    }
  } catch {
    // A missing link is the soft failure; the review still renders.
  }
  return out;
}
