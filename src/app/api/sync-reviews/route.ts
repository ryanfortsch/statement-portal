import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, serviceRoleKey);

const GUESTY_CLIENT_ID = process.env.GUESTY_CLIENT_ID || '';
const GUESTY_CLIENT_SECRET = process.env.GUESTY_CLIENT_SECRET || '';
const GUESTY_API = 'https://open-api.guesty.com';

// Same mapping the statement page uses. Nickname matches are lowercase substring.
// Keep this in sync with PROPERTY_DETAILS in src/app/statement/page.tsx.
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

// Guesty nicknames use marketing names. Substring-match against them.
const NICKNAME_HINTS: Record<string, string> = {
  '3_south_st':    'old garden beach',
  '21_horton':     'rocky neck',            // "Stay at Rocky Neck" = 21 Horton
  '53_rocky_neck': 'the neck',              // "Stay at The Neck" = 53 Rocky Neck
  '4_brier_neck':  'brier neck',
  '30_woodward':   'little river',
  '20_hammond':    'east gloucester',
  '20_enon':       'beverly shops',
  '73_rocky_neck': 'smith cove',
  '17_beach_rd':   'niles beach',           // guess: 17 Beach Rd near Niles
  '65_calderwood': 'black rock harbor',
  '3_locust':      'niles beach',           // note: also niles in CLAUDE.md for 3_locust
  '3246_ne_27th':  'lighthouse point',
};

function channelFromGuesty(channelId?: string): string {
  if (!channelId) return 'Direct';
  const c = channelId.toLowerCase();
  if (c.startsWith('airbnb')) return 'Airbnb';
  if (c.startsWith('homeaway') || c === 'vrbo') return 'VRBO';
  if (c === 'bookingcom' || c.startsWith('booking')) return 'Booking.com';
  return 'Direct';
}

// ---- Guesty auth ----

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getGuestyToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
  const basic = Buffer.from(`${GUESTY_CLIENT_ID}:${GUESTY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${GUESTY_API}/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'open-api' }),
  });
  if (!res.ok) throw new Error(`Guesty auth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 86400) * 1000,
  };
  return cachedToken.token;
}

async function guestyGet(path: string, token: string, params?: Record<string, string | number>) {
  const qs = params ? '?' + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])) : '';
  const res = await fetch(`${GUESTY_API}${path}${qs}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Guesty GET ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// ---- Listing map ----

type ListingRow = { listing_id: string; property_id: string; nickname: string | null; address: string | null };

async function refreshListingMap(token: string): Promise<ListingRow[]> {
  // Pull all listings (paginate) and match each to a property_id.
  const all: any[] = [];
  let skip = 0;
  const limit = 100;
  while (true) {
    const page = await guestyGet('/v1/listings', token, { limit, skip });
    const batch = page.results || page.data || [];
    all.push(...batch);
    if (batch.length < limit) break;
    skip += limit;
    if (skip > 2000) break; // safety
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
    const { error } = await supabase.from('guesty_listings').upsert(
      rows.map(r => ({ ...r, updated_at: new Date().toISOString() })),
      { onConflict: 'listing_id' },
    );
    if (error) throw new Error(`Failed to upsert guesty_listings: ${error.message}`);
  }
  return rows;
}

async function loadListingMap(): Promise<Record<string, string>> {
  const { data } = await supabase.from('guesty_listings').select('listing_id, property_id');
  const map: Record<string, string> = {};
  (data || []).forEach(r => { map[r.listing_id] = r.property_id; });
  return map;
}

// ---- Guest names (cached per run) ----

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

// ---- Reviews pull ----

type GuestyReview = {
  _id: string;
  listingId?: string;
  reservationId?: string;
  guestId?: string;
  channelId?: string;
  createdAt: string;
  rawReview?: {
    overall_rating?: number | string;
    public_review?: string | null;
    private_feedback?: string | null;
    category_ratings_cleanliness?: number | string;
    category_ratings_accuracy?: number | string;
    category_ratings_checkin?: number | string;
    category_ratings_communication?: number | string;
    category_ratings_location?: number | string;
    category_ratings_value?: number | string;
  };
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

    // Reviews come back newest-first, so we can short-circuit once a batch drops below `since`.
    let hitFloor = false;
    for (const r of batch) {
      if (sinceMs && new Date(r.createdAt).getTime() < sinceMs) { hitFloor = true; continue; }
      all.push(r);
    }
    if (hitFloor) break;
    if (batch.length < limit) break;
    skip += limit;
    if (skip > 5000) break; // safety
  }
  return all;
}

function toNumber(n: unknown): number | null {
  if (n === null || n === undefined || n === '') return null;
  const v = typeof n === 'number' ? n : parseFloat(String(n));
  return Number.isFinite(v) ? v : null;
}

export async function POST(request: NextRequest) {
  try {
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, { status: 500 });
    }
    if (!GUESTY_CLIENT_ID || !GUESTY_CLIENT_SECRET) {
      return NextResponse.json({ error: 'GUESTY_CLIENT_ID / GUESTY_CLIENT_SECRET not configured' }, { status: 500 });
    }

    const body = await request.json().catch(() => ({}));
    // Optional: `since=YYYY-MM-DD` to short-circuit pagination. Defaults to 2 years back.
    const since: string | undefined = body.since || new Date(Date.now() - 2 * 365 * 86400_000).toISOString();
    const refreshMap: boolean = body.refreshMap !== false; // default true

    const token = await getGuestyToken();

    let listingMap: Record<string, string> = {};
    let mappedCount = 0;
    if (refreshMap) {
      const rows = await refreshListingMap(token);
      mappedCount = rows.length;
      rows.forEach(r => { listingMap[r.listing_id] = r.property_id; });
    } else {
      listingMap = await loadListingMap();
      mappedCount = Object.keys(listingMap).length;
    }

    const reviews = await fetchAllReviews(token, since);

    const nameCache = new Map<string, string>();
    const rows: any[] = [];
    let skippedNoProperty = 0;

    for (const r of reviews) {
      const propertyId = r.listingId ? listingMap[r.listingId] : undefined;
      if (!propertyId) { skippedNoProperty++; continue; }

      const guestName = r.guestId ? await resolveGuestName(r.guestId, token, nameCache) : null;
      const rw = r.rawReview || {};

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
        public_review: rw.public_review || null,
        private_feedback: rw.private_feedback || null,
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
      const { error } = await supabase.from('reviews').upsert(rows, { onConflict: 'guesty_review_id' });
      if (error) throw new Error(`reviews upsert failed: ${error.message}`);
    }

    return NextResponse.json({
      success: true,
      since,
      listings_mapped: mappedCount,
      reviews_fetched: reviews.length,
      reviews_upserted: rows.length,
      skipped_no_property: skippedNoProperty,
    });
  } catch (err) {
    console.error('sync-reviews error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : JSON.stringify(err) },
      { status: 500 },
    );
  }
}
