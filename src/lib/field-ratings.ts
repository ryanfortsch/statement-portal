/**
 * Inspector reputation, tied to the GUEST rating of the stay each inspection
 * prepped. An inspector readies a home; the guest who stays next rates their
 * stay; that star rating becomes the inspector's review.
 *
 * Chain (all derived — no new table):
 *   contractor  ← inspection_packets.awarded_contractor_id
 *               ← packet_stops (completed, with a booking_id)
 *               → bookings.external_booking_id  (the Guesty reservation)
 *               → reviews.reservation_id → overall_rating
 *
 * Tiers run off CUMULATIVE 5-star review totals:
 *   25 → Bronze, 50 → Silver, 100 → Gold.
 *   (fiveStreak is a separate "in a row" flourish, not what drives the tier.)
 *   Unrated until MIN_RATED reviews exist.
 */
import 'server-only';
import { fieldDb } from '@/lib/field-db';

export type RatingTier = 'unrated' | 'bronze' | 'silver' | 'gold';
export const TIER_RANK: Record<RatingTier, number> = { gold: 3, silver: 2, bronze: 1, unrated: 0 };
export const MIN_RATED = 5; // reviews needed before we show a score at all
const NEXT_TIER_AT: Record<Exclude<RatingTier, 'gold'>, number> = { unrated: 25, bronze: 50, silver: 100 };

export type ContractorRating = {
  count: number;
  avg: number | null;
  fiveStarTotal: number; // cumulative 5-star reviews — drives the tier (reachable)
  fiveStreak: number; // consecutive 5-star from the most recent review back (flourish only)
  tier: RatingTier;
  rated: boolean; // has enough reviews to show a score
  toNextTier: number | null; // 5-star reviews still needed for the next tier (null at gold)
};

// Tiers are CUMULATIVE 5-star reviews, not a consecutive streak: a single 4-star
// (often about WiFi/noise, not the inspector) shouldn't zero months of work, and
// VRBO/direct stays that never generate a rating shouldn't stall someone forever.
// The "in a row" streak is kept as a flourish, not the gate.
function tierFor(fiveStarTotal: number): RatingTier {
  if (fiveStarTotal >= 100) return 'gold';
  if (fiveStarTotal >= 50) return 'silver';
  if (fiveStarTotal >= 25) return 'bronze';
  return 'unrated';
}

export async function getContractorRatings(): Promise<Map<string, ContractorRating>> {
  const db = fieldDb();

  // packet -> contractor
  const { data: pkts } = await db
    .from('inspection_packets')
    .select('id, awarded_contractor_id')
    .not('awarded_contractor_id', 'is', null);
  const packetContractor = new Map<string, string>();
  for (const p of (pkts ?? []) as { id: string; awarded_contractor_id: string }[]) {
    packetContractor.set(p.id, p.awarded_contractor_id);
  }
  if (packetContractor.size === 0) return new Map();

  // completed stops carrying the stay they prepped
  const { data: stops } = await db
    .from('packet_stops')
    .select('packet_id, booking_id, status')
    .in('packet_id', [...packetContractor.keys()])
    .not('booking_id', 'is', null);
  const stopRows = ((stops ?? []) as { packet_id: string; booking_id: string; status: string }[]).filter(
    (s) => s.status === 'complete' || s.status === 'skipped',
  );
  const bookingIds = [...new Set(stopRows.map((s) => s.booking_id))];
  if (bookingIds.length === 0) return new Map();

  // booking -> Guesty reservation id
  const { data: bks } = await db.from('bookings').select('id, external_booking_id').in('id', bookingIds);
  const bookingExt = new Map<string, string>();
  for (const b of (bks ?? []) as { id: string; external_booking_id: string | null }[]) {
    if (b.external_booking_id) bookingExt.set(b.id, b.external_booking_id);
  }
  const extIds = [...new Set([...bookingExt.values()])];
  if (extIds.length === 0) return new Map();

  // reservation -> guest review rating (latest, if more than one)
  const { data: revs } = await db
    .from('reviews')
    .select('reservation_id, overall_rating, review_created_at')
    .in('reservation_id', extIds)
    .not('overall_rating', 'is', null);
  const reviewByExt = new Map<string, { rating: number; at: string }>();
  for (const r of (revs ?? []) as { reservation_id: string; overall_rating: number; review_created_at: string | null }[]) {
    const at = r.review_created_at ?? '';
    const cur = reviewByExt.get(r.reservation_id);
    if (!cur || at > cur.at) reviewByExt.set(r.reservation_id, { rating: r.overall_rating, at });
  }
  if (reviewByExt.size === 0) return new Map();

  // collect each inspector's reviews
  const byContractor = new Map<string, Array<{ rating: number; at: string }>>();
  for (const s of stopRows) {
    const cid = packetContractor.get(s.packet_id);
    const ext = bookingExt.get(s.booking_id);
    if (!cid || !ext) continue;
    const rev = reviewByExt.get(ext);
    if (!rev) continue;
    const arr = byContractor.get(cid) ?? [];
    arr.push(rev);
    byContractor.set(cid, arr);
  }

  const out = new Map<string, ContractorRating>();
  for (const [cid, list] of byContractor) {
    const sorted = list.slice().sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)); // oldest → newest
    const count = sorted.length;
    const avg = count ? sorted.reduce((s, r) => s + r.rating, 0) / count : null;
    const fiveStarTotal = sorted.filter((r) => r.rating >= 5).length;
    let streak = 0;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].rating >= 5) streak++;
      else break;
    }
    const tier = tierFor(fiveStarTotal);
    const toNextTier = tier === 'gold' ? null : Math.max(0, NEXT_TIER_AT[tier] - fiveStarTotal);
    out.set(cid, { count, avg, fiveStarTotal, fiveStreak: streak, tier, rated: count >= MIN_RATED, toNextTier });
  }
  return out;
}
