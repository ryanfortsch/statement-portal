/**
 * Helm Reviews — read-side queries against the public.reviews table that
 * sync-guesty populates from the Guesty API.
 *
 * Schema (informal, mirrors what sync-guesty writes):
 *   id, guesty_review_id (uniq), listing_id, property_id (FK to properties),
 *   reservation_id, guest_id, guest_name, channel, guesty_channel_id,
 *   overall_rating (1-5), public_review (text), private_feedback (text),
 *   category_cleanliness, category_accuracy, category_checkin,
 *   category_communication, category_location, category_value,
 *   review_created_at, synced_at
 */

import { supabaseAdmin as supabase, isServiceConfigured as isConfigured } from './supabase-admin';

export type ReviewRow = {
  id: string;
  property_id: string | null;
  reservation_id: string | null;
  /**
   * Link to the unified guest record on public.audience_contacts. Set
   * by the Guesty sync when a review's guest_name matches a known
   * contact (case-insensitive first+last). null when no match — the
   * review still renders on /reviews, it just doesn't deep-link to a
   * guest detail page.
   */
  contact_id: string | null;
  guest_name: string | null;
  channel: string | null;
  overall_rating: number | null;
  public_review: string | null;
  private_feedback: string | null;
  category_cleanliness: number | null;
  category_accuracy: number | null;
  category_checkin: number | null;
  category_communication: number | null;
  category_location: number | null;
  category_value: number | null;
  review_created_at: string | null;
};

export type ReviewWindowStats = {
  /** Rated reviews for Helm-managed properties received in the window. */
  total: number;
  /** Of those, how many were 5-star (overall_rating >= 5). */
  fiveStar: number;
  /** Of those, how many were rated below 5 (overall_rating < 5). */
  belowFive: number;
  /** Average overall rating (1-5), null if no rated reviews. */
  avg: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Active Helm-managed property ids. Every review stat scopes to this set.
 * The Guesty reviews feed includes Ryan's personal properties (65
 * Calderwood, 3246 NE 27th) that Helm does not manage and that are absent
 * from the properties table, so without this filter the home tile and the
 * Reviews tab would report on rentals Helm doesn't run. There is no FK
 * between reviews.property_id and properties.id, so we filter in app code
 * with an in() list rather than a PostgREST embed.
 */
async function getActivePropertyIds(): Promise<string[]> {
  if (!isConfigured) return [];
  try {
    const { data, error } = await supabase
      .from('properties')
      .select('id')
      .eq('is_active', true);
    if (error) throw error;
    return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  } catch {
    return [];
  }
}

/**
 * Stats for the rolling N-day window ending now. Default 7 days, matches
 * "this week" semantics for the home dashboard. We count by
 * review_created_at, the moment the review landed, not the stay date.
 *
 * Scoped two ways so the rate is trustworthy: only Helm-managed
 * properties (getActivePropertyIds), and only rated reviews. Guesty emits
 * empty placeholder rows (null rating, no text) for some VRBO stays;
 * those are not reviews and would wrongly drag the five-star rate down if
 * they sat in the denominator, so total excludes them.
 */
export async function getReviewWindowStats(days = 7): Promise<ReviewWindowStats> {
  const empty: ReviewWindowStats = { total: 0, fiveStar: 0, belowFive: 0, avg: null };
  if (!isConfigured) return empty;
  try {
    const propertyIds = await getActivePropertyIds();
    if (propertyIds.length === 0) return empty;
    const sinceISO = new Date(Date.now() - days * DAY_MS).toISOString();
    const { data, error } = await supabase
      .from('reviews')
      .select('overall_rating')
      .gte('review_created_at', sinceISO)
      .not('overall_rating', 'is', null)
      .in('property_id', propertyIds);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ overall_rating: number | null }>;
    if (rows.length === 0) return empty;

    let total = 0;
    let fiveStar = 0;
    let belowFive = 0;
    let sum = 0;
    for (const r of rows) {
      const o = r.overall_rating;
      if (o == null) continue; // defensive; query already excludes nulls
      total += 1;
      sum += o;
      if (o >= 5) fiveStar += 1;
      else belowFive += 1;
    }
    return {
      total,
      fiveStar,
      belowFive,
      avg: total > 0 ? sum / total : null,
    };
  } catch {
    return empty;
  }
}

export type ReviewListFilters = {
  /** Limit by overall_rating bucket. "5" = 5-star only, "below" = 1-4, undefined = all. */
  rating?: '5' | 'below';
  /** Restrict to reviews for one property. */
  propertyId?: string;
  /** Channel name as Helm normalizes it ("Airbnb", "VRBO", "Booking.com"). */
  channel?: string;
  /** Free-text search against guest_name + public_review. */
  search?: string;
  /**
   * Rolling-window scope in days. When set, only reviews whose
   * review_created_at lands within the last N days are returned. Must
   * match the window the page's stat strip uses (getReviewWindowStats)
   * so the list and the stats never disagree. A 30-day stat strip
   * sitting above an all-time list was the original "0 below five next
   * to a 4-star review" bug. Undefined = no date floor (all-time).
   */
  days?: number;
  /** Page size, default 50. */
  limit?: number;
};

export async function listReviews(filters: ReviewListFilters = {}): Promise<ReviewRow[]> {
  if (!isConfigured) return [];
  try {
    let q = supabase
      .from('reviews')
      .select(
        'id, property_id, reservation_id, contact_id, guest_name, channel, overall_rating, public_review, private_feedback, category_cleanliness, category_accuracy, category_checkin, category_communication, category_location, category_value, review_created_at',
      )
      .order('review_created_at', { ascending: false })
      .not('overall_rating', 'is', null)
      .limit(filters.limit ?? 50);

    // Scope to Helm-managed properties so personal-property reviews and
    // empty placeholder rows never show. A selected property is already
    // one of ours (the dropdown lists only active Helm properties), so
    // eq() suffices; otherwise restrict to the whole active set. Same
    // basis as getReviewWindowStats, so the list and the strip agree.
    if (filters.propertyId) {
      q = q.eq('property_id', filters.propertyId);
    } else {
      const ids = await getActivePropertyIds();
      if (ids.length === 0) return [];
      q = q.in('property_id', ids);
    }

    if (filters.days != null && filters.days > 0) {
      const sinceISO = new Date(Date.now() - filters.days * DAY_MS).toISOString();
      q = q.gte('review_created_at', sinceISO);
    }
    if (filters.rating === '5') q = q.gte('overall_rating', 5);
    else if (filters.rating === 'below') q = q.lt('overall_rating', 5);
    if (filters.channel) q = q.eq('channel', filters.channel);
    if (filters.search) {
      const s = filters.search.trim();
      if (s) q = q.or(`guest_name.ilike.%${s}%,public_review.ilike.%${s}%`);
    }

    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as ReviewRow[];
  } catch {
    return [];
  }
}

/**
 * Distinct channels that show up in the reviews table — used for the
 * filter dropdown on /reviews. Cached at request time.
 */
export async function listReviewChannels(): Promise<string[]> {
  if (!isConfigured) return [];
  try {
    const { data } = await supabase
      .from('reviews')
      .select('channel')
      .not('channel', 'is', null);
    const set = new Set<string>();
    for (const r of (data ?? []) as Array<{ channel: string | null }>) {
      if (r.channel) set.add(r.channel);
    }
    return [...set].sort();
  } catch {
    return [];
  }
}

/**
 * Reviews authored by a specific guest (matched to audience_contacts via
 * the contact_id link). Used on /guests/[id] to show "what this person
 * said about their stays" alongside their email history.
 *
 * Returns most-recent first. Limit defaults to 25 because a single
 * guest's review count is bounded by their stay count; the cap is
 * defensive only.
 */
export async function listReviewsForContact(contactId: string, limit = 25): Promise<ReviewRow[]> {
  if (!isConfigured) return [];
  try {
    const { data, error } = await supabase
      .from('reviews')
      .select(
        'id, property_id, reservation_id, contact_id, guest_name, channel, overall_rating, public_review, private_feedback, category_cleanliness, category_accuracy, category_checkin, category_communication, category_location, category_value, review_created_at',
      )
      .eq('contact_id', contactId)
      .order('review_created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as ReviewRow[];
  } catch {
    return [];
  }
}
