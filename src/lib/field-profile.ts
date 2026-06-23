/**
 * The inspector's own profile: one consolidated self-view assembled from the
 * pieces already computed elsewhere (pay ledger, reliability, guest-rating
 * reputation) plus their guest reviews + work history. All derived — no new
 * tables. Read only via the service-role Field client.
 */
import 'server-only';
import { fieldDb } from '@/lib/field-db';
import {
  getContractorPayStats,
  getContractorReliability,
  type ContractorPayStats,
  type ReliabilityStats,
} from '@/lib/field-packets';
import { getContractorRatings, type ContractorRating } from '@/lib/field-ratings';

export type ContractorReview = {
  rating: number;
  propertyName: string;
  date: string | null;
  text: string | null;
};

export type ContractorHistoryItem = {
  id: string;
  date: string;
  title: string;
  trade: string;
  payCents: number;
  status: string;
  paid: boolean;
};

export type ContractorProfile = {
  payStats: ContractorPayStats | undefined;
  reliability: ReliabilityStats | undefined;
  rating: ContractorRating | undefined;
  reviews: ContractorReview[];
  history: ContractorHistoryItem[];
};

/** Guest reviews of the stays this inspector prepped (newest first). Same
 *  derivation chain as getContractorRatings, scoped to one contractor and
 *  returning the individual reviews + the home + the public text. */
async function loadContractorReviews(contractorId: string): Promise<ContractorReview[]> {
  const db = fieldDb();
  const { data: pkts } = await db
    .from('inspection_packets')
    .select('id')
    .eq('awarded_contractor_id', contractorId);
  const packetIds = ((pkts ?? []) as { id: string }[]).map((p) => p.id);
  if (packetIds.length === 0) return [];

  const { data: stops } = await db
    .from('packet_stops')
    .select('property_id, booking_id, status')
    .in('packet_id', packetIds)
    .not('booking_id', 'is', null);
  const stopRows = ((stops ?? []) as { property_id: string; booking_id: string; status: string }[]).filter(
    (s) => s.status === 'complete' || s.status === 'skipped',
  );
  const bookingIds = [...new Set(stopRows.map((s) => s.booking_id))];
  if (bookingIds.length === 0) return [];

  const { data: bks } = await db.from('bookings').select('id, external_booking_id').in('id', bookingIds);
  const extByBooking = new Map<string, string>();
  for (const b of (bks ?? []) as { id: string; external_booking_id: string | null }[]) {
    if (b.external_booking_id) extByBooking.set(b.id, b.external_booking_id);
  }
  const extIds = [...new Set([...extByBooking.values()])];
  if (extIds.length === 0) return [];

  const { data: revs } = await db
    .from('reviews')
    .select('reservation_id, overall_rating, public_review, review_created_at, property_id')
    .in('reservation_id', extIds)
    .not('overall_rating', 'is', null);
  type Rev = { reservation_id: string; overall_rating: number; public_review: string | null; review_created_at: string | null; property_id: string | null };
  const reviewByExt = new Map<string, Rev>();
  for (const r of (revs ?? []) as Rev[]) {
    const cur = reviewByExt.get(r.reservation_id);
    if (!cur || (r.review_created_at ?? '') > (cur.review_created_at ?? '')) reviewByExt.set(r.reservation_id, r);
  }

  const propIds = [...new Set([...reviewByExt.values()].map((r) => r.property_id).filter((v): v is string => !!v))];
  const propName = new Map<string, string>();
  if (propIds.length) {
    const { data: props } = await db.from('properties').select('id, name').in('id', propIds);
    for (const p of (props ?? []) as { id: string; name: string }[]) propName.set(p.id, p.name);
  }

  const out: ContractorReview[] = [];
  const seen = new Set<string>();
  for (const s of stopRows) {
    const ext = extByBooking.get(s.booking_id);
    if (!ext || seen.has(ext)) continue;
    const rev = reviewByExt.get(ext);
    if (!rev) continue;
    seen.add(ext);
    out.push({
      rating: rev.overall_rating,
      propertyName: propName.get(rev.property_id ?? s.property_id) ?? propName.get(s.property_id) ?? 'A home',
      date: rev.review_created_at,
      text: rev.public_review,
    });
  }
  out.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  return out.slice(0, 20);
}

/** The inspector's worked packets (claimed onward), newest first. */
async function loadContractorHistory(contractorId: string): Promise<ContractorHistoryItem[]> {
  const { data } = await fieldDb()
    .from('inspection_packets')
    .select('id, visit_date, title, trade, posted_price_cents, status, paid_at')
    .eq('awarded_contractor_id', contractorId)
    .in('status', ['in_progress', 'submitted', 'approved'])
    .order('visit_date', { ascending: false })
    .limit(30);
  return ((data ?? []) as Array<{
    id: string;
    visit_date: string;
    title: string;
    trade: string;
    posted_price_cents: number;
    status: string;
    paid_at: string | null;
  }>).map((p) => ({
    id: p.id,
    date: p.visit_date,
    title: p.title,
    trade: p.trade,
    payCents: p.posted_price_cents,
    status: p.status,
    paid: !!p.paid_at,
  }));
}

export async function loadContractorProfile(contractorId: string): Promise<ContractorProfile> {
  const [payMap, relMap, ratingMap, reviews, history] = await Promise.all([
    getContractorPayStats(),
    getContractorReliability(),
    getContractorRatings(),
    loadContractorReviews(contractorId),
    loadContractorHistory(contractorId),
  ]);
  return {
    payStats: payMap.get(contractorId),
    reliability: relMap.get(contractorId),
    rating: ratingMap.get(contractorId),
    reviews,
    history,
  };
}
