import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const GUESTY_API = 'https://open-api.guesty.com';

// Keep this in sync with PROPERTY_DETAILS[*].listing_match in statement/page.tsx
const LISTING_MATCH: Record<string, string> = {
  '3_south_st':    '3 south',
  '21_horton':     '21 horton',
  '53_rocky_neck': '53 rocky neck',
  '4_brier_neck':  '4 brier neck',
  '30_woodward':   '30 woodward',
  '20_hammond':    '20 hammond',
  '20_enon':       '20 enon',
  '73_rocky_neck': '73 rocky neck',
  '17_beach_rd':   '17 beach',
  '65_calderwood': '65 calderwood',
  '3_locust':      '3 locust',
  '3246_ne_27th':  '3246 ne 27th',
};
const NICKNAME_HINTS: Record<string, string> = {
  '3_south_st':    'old garden beach',
  '21_horton':     'rocky neck',
  '53_rocky_neck': 'the neck',
  '4_brier_neck':  'brier neck',
  '30_woodward':   'little river',
  '20_hammond':    'east gloucester',
  '20_enon':       'beverly shops',
  '73_rocky_neck': 'smith cove',
  '17_beach_rd':   'niles beach',
  '65_calderwood': 'black rock harbor',
  '3_locust':      'niles beach',
  '3246_ne_27th':  'lighthouse point',
};

function channelFromGuesty(raw?: string): string {
  if (!raw) return 'Direct';
  const c = raw.toLowerCase();
  if (c.startsWith('airbnb')) return 'Airbnb';
  if (c.startsWith('homeaway') || c === 'vrbo') return 'VRBO';
  if (c === 'bookingcom' || c.startsWith('booking')) return 'Booking.com';
  if (c === 'manual' || c === 'direct') return 'Direct';
  return 'Direct';
}

function toNumber(n: unknown): number | null {
  if (n === null || n === undefined || n === '') return null;
  const v = typeof n === 'number' ? n : parseFloat(String(n));
  return Number.isFinite(v) ? v : null;
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// ---- Supabase ----
let _supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw new Error('Supabase URL / service role key not configured');
  _supabase = createClient(url, key);
  return _supabase;
}

// ---- Guesty auth (persistent + in-memory cache + 429 backoff) ----

let memTok: { token: string; expiresAt: number } | null = null;

async function fetchNewGuestyToken(): Promise<{ token: string; expiresAt: number }> {
  const clientId = process.env.GUESTY_CLIENT_ID || '';
  const clientSecret = process.env.GUESTY_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) throw new Error('Guesty credentials not configured');
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const delays = [0, 2000, 5000, 10000];
  let lastErr = '';
  for (const d of delays) {
    if (d) await sleep(d);
    const res = await fetch(`${GUESTY_API}/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'open-api' }),
    });
    if (res.status === 429) { lastErr = 'oauth2/token 429'; continue; }
    if (!res.ok) throw new Error(`Guesty auth failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    const token = data.access_token as string;
    const expiresAt = Date.now() + (data.expires_in ?? 86400) * 1000;
    return { token, expiresAt };
  }
  throw new Error(`Guesty auth rate-limited after retries: ${lastErr}`);
}

async function getGuestyToken(): Promise<string> {
  const now = Date.now();
  if (memTok && now < memTok.expiresAt - 60_000) return memTok.token;

  const sb = getSupabase();
  const { data: row } = await sb
    .from('guesty_auth').select('access_token, expires_at').eq('id', 1).maybeSingle();
  if (row) {
    const exp = new Date(row.expires_at).getTime();
    if (now < exp - 60_000) {
      memTok = { token: row.access_token, expiresAt: exp };
      return row.access_token;
    }
  }

  const fresh = await fetchNewGuestyToken();
  memTok = fresh;
  await sb.from('guesty_auth').upsert(
    { id: 1, access_token: fresh.token, expires_at: new Date(fresh.expiresAt).toISOString(), updated_at: new Date().toISOString() },
    { onConflict: 'id' },
  );
  return fresh.token;
}

async function guestyGet(path: string, token: string, params?: Record<string, string | number>) {
  const qs = params ? '?' + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])) : '';
  const url = `${GUESTY_API}${path}${qs}`;
  const delays = [0, 2000, 5000, 10000];
  let lastStatus = 0;
  let lastBody = '';
  for (const d of delays) {
    if (d) await sleep(d);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (res.status === 429) { lastStatus = 429; lastBody = await res.text(); continue; }
    if (!res.ok) throw new Error(`Guesty GET ${path} failed: ${res.status} ${await res.text()}`);
    return res.json();
  }
  throw new Error(`Guesty GET ${path} rate-limited after retries (${lastStatus}): ${lastBody}`);
}

// ---- Listing map ----

type ListingRow = { listing_id: string; property_id: string; nickname: string | null; address: string | null };

async function refreshListingMap(token: string): Promise<ListingRow[]> {
  const all: any[] = [];
  let skip = 0;
  const limit = 100;
  while (true) {
    const page = await guestyGet('/v1/listings', token, { limit, skip });
    const batch = page.results || page.data || [];
    all.push(...batch);
    if (batch.length < limit) break;
    skip += limit;
    if (skip > 2000) break;
  }

  const rows: ListingRow[] = [];
  for (const l of all) {
    const nickname: string = (l.nickname || l.title || '').toString();
    const address: string = (l.address?.full || l.address?.street || '').toString();
    const haystack = `${nickname} ${address}`.toLowerCase();

    let matched: string | null = null;
    for (const [propId, needle] of Object.entries(LISTING_MATCH)) {
      if (haystack.includes(needle)) { matched = propId; break; }
    }
    if (!matched) {
      for (const [propId, hint] of Object.entries(NICKNAME_HINTS)) {
        if (haystack.includes(hint)) { matched = propId; break; }
      }
    }
    if (!matched) continue;

    rows.push({
      listing_id: l._id,
      property_id: matched,
      nickname: nickname || null,
      address: address || null,
    });
  }

  if (rows.length > 0) {
    const { error } = await getSupabase().from('guesty_listings').upsert(
      rows.map(r => ({ ...r, updated_at: new Date().toISOString() })),
      { onConflict: 'listing_id' },
    );
    if (error) throw new Error(`Failed to upsert guesty_listings: ${error.message}`);
  }
  return rows;
}

async function loadListingMap(): Promise<Record<string, string>> {
  const { data } = await getSupabase().from('guesty_listings').select('listing_id, property_id');
  const map: Record<string, string> = {};
  (data || []).forEach(r => { map[r.listing_id] = r.property_id; });
  return map;
}

// ---- Guest names (per-run cache) ----

async function resolveGuestName(guestId: string, token: string, cache: Map<string, string>): Promise<string | null> {
  if (cache.has(guestId)) return cache.get(guestId)!;
  try {
    const g = await guestyGet(`/v1/guests/${guestId}`, token);
    const name = g.fullName || [g.firstName, g.lastName].filter(Boolean).join(' ') || null;
    if (name) cache.set(guestId, name);
    return name;
  } catch {
    return null;
  }
}

// ---- Reviews ----

type GuestyReview = {
  _id: string;
  listingId?: string;
  reservationId?: string;
  guestId?: string;
  channelId?: string;
  createdAt: string;
  rawReview?: Record<string, unknown>;
};

async function fetchAllReviews(token: string, sinceIso?: string): Promise<GuestyReview[]> {
  const all: GuestyReview[] = [];
  let skip = 0;
  const limit = 100;
  const sinceMs = sinceIso ? new Date(sinceIso).getTime() : null;

  while (true) {
    const page = await guestyGet('/v1/reviews', token, { limit, skip });
    const batch: GuestyReview[] = page.data || page.results || [];
    if (batch.length === 0) break;
    let hitFloor = false;
    for (const r of batch) {
      if (sinceMs && new Date(r.createdAt).getTime() < sinceMs) { hitFloor = true; continue; }
      all.push(r);
    }
    if (hitFloor) break;
    if (batch.length < limit) break;
    skip += limit;
    if (skip > 5000) break;
  }
  return all;
}

async function syncReviews(token: string, listingMap: Record<string, string>, sinceIso: string) {
  const reviews = await fetchAllReviews(token, sinceIso);
  const nameCache = new Map<string, string>();
  const rows: any[] = [];
  let skipped = 0;

  for (const r of reviews) {
    const propertyId = r.listingId ? listingMap[r.listingId] : undefined;
    if (!propertyId) { skipped++; continue; }
    const guestName = r.guestId ? await resolveGuestName(r.guestId, token, nameCache) : null;
    const rw = (r.rawReview || {}) as Record<string, unknown>;

    rows.push({
      guesty_review_id: r._id,
      listing_id: r.listingId || null,
      property_id: propertyId,
      reservation_id: r.reservationId || null,
      guest_id: r.guestId || null,
      guest_name: guestName,
      channel: channelFromGuesty(r.channelId),
      guesty_channel_id: r.channelId || null,
      overall_rating: toNumber(rw.overall_rating),
      public_review: (rw.public_review as string) || null,
      private_feedback: (rw.private_feedback as string) || null,
      category_cleanliness: toNumber(rw.category_ratings_cleanliness),
      category_accuracy: toNumber(rw.category_ratings_accuracy),
      category_checkin: toNumber(rw.category_ratings_checkin),
      category_communication: toNumber(rw.category_ratings_communication),
      category_location: toNumber(rw.category_ratings_location),
      category_value: toNumber(rw.category_ratings_value),
      review_created_at: r.createdAt,
      synced_at: new Date().toISOString(),
    });
  }

  if (rows.length > 0) {
    const { error } = await getSupabase().from('reviews').upsert(rows, { onConflict: 'guesty_review_id' });
    if (error) throw new Error(`reviews upsert failed: ${error.message}`);
  }
  return { fetched: reviews.length, upserted: rows.length, skipped };
}

// ---- Reservations ----

type GuestyReservation = {
  _id: string;
  listingId?: string;
  guestId?: string;
  guest?: { fullName?: string; firstName?: string; lastName?: string };
  confirmationCode?: string;
  checkIn?: string;
  checkOut?: string;
  nightsCount?: number;
  status?: string;
  source?: string;
  integration?: { platform?: string };
  channel?: string;
  money?: { hostPayout?: number };
};

async function fetchAllReservations(token: string, sinceIso?: string): Promise<GuestyReservation[]> {
  const all: GuestyReservation[] = [];
  let skip = 0;
  const limit = 100;
  const sinceMs = sinceIso ? new Date(sinceIso).getTime() : null;
  while (true) {
    const page = await guestyGet('/v1/reservations', token, { limit, skip });
    const batch: GuestyReservation[] = page.data || page.results || [];
    if (batch.length === 0) break;
    let hitFloor = false;
    for (const r of batch) {
      const ref = r.checkIn || r.checkOut;
      if (sinceMs && ref && new Date(ref).getTime() < sinceMs) { hitFloor = true; continue; }
      all.push(r);
    }
    if (hitFloor) break;
    if (batch.length < limit) break;
    skip += limit;
    if (skip > 10000) break;
  }
  return all;
}

async function syncReservations(token: string, listingMap: Record<string, string>, sinceIso: string) {
  const reservations = await fetchAllReservations(token, sinceIso);
  const rows: any[] = [];
  let skippedNoProp = 0;

  for (const r of reservations) {
    const propertyId = r.listingId ? listingMap[r.listingId] : undefined;
    if (!propertyId) { skippedNoProp++; continue; }

    const checkIn = r.checkIn ? r.checkIn.slice(0, 10) : null;
    const checkOut = r.checkOut ? r.checkOut.slice(0, 10) : null;
    const rawChannel = r.integration?.platform || r.source || r.channel;
    const guestName = r.guest?.fullName || [r.guest?.firstName, r.guest?.lastName].filter(Boolean).join(' ') || null;

    rows.push({
      guesty_reservation_id: r._id,
      listing_id: r.listingId || null,
      property_id: propertyId,
      guest_id: r.guestId || null,
      guest_name: guestName,
      confirmation_code: r.confirmationCode || null,
      check_in: checkIn,
      check_out: checkOut,
      nights: r.nightsCount ?? null,
      channel: channelFromGuesty(rawChannel),
      guesty_channel_id: rawChannel || null,
      status: r.status || null,
      host_payout: toNumber(r.money?.hostPayout),
      synced_at: new Date().toISOString(),
    });
  }

  if (rows.length > 0) {
    const { error } = await getSupabase().from('guesty_reservations').upsert(rows, { onConflict: 'guesty_reservation_id' });
    if (error) throw new Error(`guesty_reservations upsert failed: ${error.message}`);
  }
  return { fetched: reservations.length, upserted: rows.length, skipped: skippedNoProp };
}

// ---- POST ----

export async function POST(request: NextRequest) {
  const result: Record<string, unknown> = { success: false };
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }
    if (!process.env.GUESTY_CLIENT_ID || !process.env.GUESTY_CLIENT_SECRET) {
      return NextResponse.json({ error: 'GUESTY_CLIENT_ID / GUESTY_CLIENT_SECRET not configured' }, { status: 500 });
    }

    const body = await request.json().catch(() => ({}));
    const refreshMap: boolean = body.refreshMap !== false;
    const sinceReviewsIso: string = body.sinceReviews || new Date(Date.now() - 2 * 365 * 86400_000).toISOString();
    // Pull reservations from 3 months back (completed) through far future.
    const sinceReservationsIso: string = body.sinceReservations || new Date(Date.now() - 90 * 86400_000).toISOString();

    const token = await getGuestyToken();
    const sb = getSupabase();

    // Listings
    let mapped = 0;
    let listingMap: Record<string, string> = {};
    if (refreshMap) {
      const rows = await refreshListingMap(token);
      mapped = rows.length;
      rows.forEach(r => { listingMap[r.listing_id] = r.property_id; });
      await sb.from('sync_status').upsert(
        { source: 'guesty-listings', last_synced_at: new Date().toISOString(), last_result: { mapped } },
      );
    } else {
      listingMap = await loadListingMap();
      mapped = Object.keys(listingMap).length;
    }

    // Reviews
    let reviewsResult: Record<string, unknown> = { skipped_reason: 'not_attempted' };
    try {
      reviewsResult = await syncReviews(token, listingMap, sinceReviewsIso);
      await sb.from('sync_status').upsert(
        { source: 'guesty-reviews', last_synced_at: new Date().toISOString(), last_result: reviewsResult },
      );
    } catch (err) {
      reviewsResult = { error: err instanceof Error ? err.message : String(err) };
    }

    // Reservations (may fail on scope — don't take down the whole sync)
    let reservationsResult: Record<string, unknown> = { skipped_reason: 'not_attempted' };
    try {
      reservationsResult = await syncReservations(token, listingMap, sinceReservationsIso);
      await sb.from('sync_status').upsert(
        { source: 'guesty-reservations', last_synced_at: new Date().toISOString(), last_result: reservationsResult },
      );
    } catch (err) {
      reservationsResult = { error: err instanceof Error ? err.message : String(err) };
    }

    return NextResponse.json({
      success: true,
      listings_mapped: mapped,
      reviews: reviewsResult,
      reservations: reservationsResult,
    });
  } catch (err) {
    console.error('sync-guesty error:', err);
    return NextResponse.json(
      { ...result, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
