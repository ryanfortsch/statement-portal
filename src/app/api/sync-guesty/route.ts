import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { recordSyncFailure, recordSyncSuccess } from '@/lib/sync-status';

const GUESTY_API = 'https://open-api.guesty.com';

// Keep this in sync with PROPERTY_DETAILS[*].listing_match in statements/render/page.tsx
//
// Sub-unit needles MUST be a superstring of their parent's needle (e.g. the
// downstairs apartment's '53 rocky neck (down' contains '53 rocky neck');
// matching picks the LONGEST needle that hits, so the most specific property
// wins and a sub-unit listing can never be absorbed by its parent.
const LISTING_MATCH: Record<string, string> = {
  '3_south_st':    '3 south',
  '21_horton':     '21 horton',
  '53_rocky_neck': '53 rocky neck',
  // Guesty nickname is "53 Rocky Neck (DOWN)" — the downstairs apartment,
  // tracked as its own Helm property since 2026-07-07.
  '53_rocky_neck_2': '53 rocky neck (down',
  '4_brier_neck':  '4 brier neck',
  '30_woodward':   '30 woodward',
  '20_hammond':    '20 hammond',
  '20_enon':       '20 enon',
  '73_rocky_neck': '73 rocky neck',
  '17_beach_rd':   '17 beach',
  '65_calderwood': '65 calderwood',
  '3_locust':      '3 locust',
  '3246_ne_27th':  '3246 ne 27th',
  '36_granite':    '36 granite',
  '79_main':       '79 main',
  '16_waterman':   '16 waterman',
  '19_rackliffe':  '19 rackliffe',
  '84_thatcher':   '84 thatcher',
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
    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After');
      lastErr = `oauth2/token 429 Retry-After=${retryAfter ?? 'n/a'}`;
      // Honor Retry-After if it's a reasonable (<=60s) hint.
      const hint = retryAfter ? parseInt(retryAfter, 10) : NaN;
      if (!Number.isNaN(hint) && hint > 0 && hint <= 60) await sleep(hint * 1000);
      continue;
    }
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

type ListingRow = { listing_id: string; property_id: string; nickname: string | null; address: string | null; hero_url: string | null };
type UnmatchedListing = { listing_id: string; nickname: string | null; address: string | null };

async function refreshListingMap(
  token: string,
): Promise<{ rows: ListingRow[]; unmatched: UnmatchedListing[] }> {
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
  const unmatched: UnmatchedListing[] = [];
  for (const l of all) {
    const nickname: string = (l.nickname || l.title || '').toString();
    const address: string = (l.address?.full || l.address?.street || '').toString();
    const haystack = `${nickname} ${address}`.toLowerCase();

    // Longest matching needle wins, not insertion order: a sub-unit listing
    // ("53 Rocky Neck (DOWN)") contains its parent's needle too, and order-
    // based first-match silently absorbed the downstairs apartment into the
    // main unit — every downstairs reservation credited to 53_rocky_neck
    // (found 2026-07-20 via the revenue page showing the sub-unit empty).
    let matched: string | null = null;
    let matchedLen = 0;
    for (const [propId, needle] of Object.entries(LISTING_MATCH)) {
      if (needle.length > matchedLen && haystack.includes(needle)) {
        matched = propId;
        matchedLen = needle.length;
      }
    }
    if (!matched) {
      for (const [propId, hint] of Object.entries(NICKNAME_HINTS)) {
        if (hint.length > matchedLen && haystack.includes(hint)) {
          matched = propId;
          matchedLen = hint.length;
        }
      }
    }
    if (!matched) {
      unmatched.push({ listing_id: l._id, nickname: nickname || null, address: address || null });
      continue;
    }

    // Guesty puts the cover photo first in `pictures`. `original` is
    // the full-res CDN URL (e.g. https://assets.guesty.com/.../original.jpg)
    // which is what staycapeann.com renders on the listing page too, so
    // emails stay consistent.
    const heroUrl: string | null =
      Array.isArray(l.pictures) && l.pictures.length > 0
        ? (l.pictures[0]?.original ?? l.pictures[0]?.thumbnail ?? null)
        : null;

    rows.push({
      listing_id: l._id,
      property_id: matched,
      nickname: nickname || null,
      address: address || null,
      hero_url: heroUrl,
    });
  }

  if (rows.length > 0) {
    const { error } = await getSupabase().from('guesty_listings').upsert(
      rows.map(r => ({ ...r, updated_at: new Date().toISOString() })),
      { onConflict: 'listing_id' },
    );
    if (error) throw new Error(`Failed to upsert guesty_listings: ${error.message}`);
  }
  return { rows, unmatched };
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

  // Link any unmatched reviews to audience_contacts by guest_name.
  // Guesty doesn't give us the guest's email on the review payload, so
  // the join has to go through normalized first+last names. Idempotent
  // and bounded — runs only against rows where contact_id is null, so
  // already-linked reviews stay put even if the contact changes name.
  await linkReviewsToContacts();

  return { fetched: reviews.length, upserted: rows.length, skipped };
}

/**
 * Sets reviews.contact_id for any rows that don't have one yet, by
 * case-insensitive "first_name last_name" against audience_contacts.
 * Mirrors the backfill UPDATE in the contact_id migration so every
 * sync run picks up new contacts that joined since the last sync.
 */
async function linkReviewsToContacts(): Promise<void> {
  // The match SQL would be cleaner as a stored function, but we don't
  // have one set up. Two round trips: pull the small contact set,
  // then issue per-name UPDATEs against reviews. Cardinality is low
  // (~hundreds of contacts, ~thousands of reviews) so this is fine.
  const sb = getSupabase();
  const { data: contacts } = await sb
    .from('audience_contacts')
    .select('id, first_name, last_name')
    .not('first_name', 'is', null)
    .not('last_name', 'is', null);
  if (!contacts || contacts.length === 0) return;

  // Build a name -> contact_id map (most-recent wins on collision; we
  // can't enforce uniqueness on names, so just pick one).
  const byName = new Map<string, string>();
  for (const c of contacts as Array<{ id: string; first_name: string | null; last_name: string | null }>) {
    const full = `${(c.first_name || '').trim()} ${(c.last_name || '').trim()}`.toLowerCase().trim();
    if (!full) continue;
    if (!byName.has(full)) byName.set(full, c.id);
  }
  if (byName.size === 0) return;

  // Pull the still-unlinked reviews and their guest_names.
  const { data: unlinked } = await sb
    .from('reviews')
    .select('id, guest_name')
    .is('contact_id', null)
    .not('guest_name', 'is', null);
  if (!unlinked || unlinked.length === 0) return;

  // Group review ids by the contact they should link to. One UPDATE
  // per contact (vs one per review) keeps the round-trip count down.
  const idsByContact = new Map<string, string[]>();
  for (const r of unlinked as Array<{ id: string; guest_name: string | null }>) {
    const name = (r.guest_name || '').toLowerCase().trim();
    const contactId = name ? byName.get(name) : undefined;
    if (!contactId) continue;
    if (!idsByContact.has(contactId)) idsByContact.set(contactId, []);
    idsByContact.get(contactId)!.push(r.id);
  }

  for (const [contactId, ids] of idsByContact) {
    await sb.from('reviews').update({ contact_id: contactId }).in('id', ids);
  }
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
  // The `money` block is requested in `fields`; Guesty returns the whole
  // sub-document, so invoiceItems (the guest folio line items -- extra
  // services / Resolution Center charges included) ride along here even
  // though we historically only read hostPayout.
  money?: { hostPayout?: number; invoiceItems?: unknown[] };
};

async function fetchAllReservations(token: string, sinceIso?: string): Promise<GuestyReservation[]> {
  const all: GuestyReservation[] = [];
  let skip = 0;
  const limit = 100;
  const sinceMs = sinceIso ? new Date(sinceIso).getTime() : null;
  // Guesty omits the `money` block by default; we need to request it explicitly
  // to populate host_payout. Without this every row's host_payout comes back
  // null and the Revenue dashboard reads zero across the board.
  const fields = '_id listingId checkIn checkOut status money nightsCount guestsCount guest confirmationCode integration source channel guestId';
  // ignoreStatusFilter=true keeps canceled/inquiry/declined/expired rows in
  // the response. Without this, Guesty defaults to filtering them out, so a
  // reservation that flips to canceled AFTER its first sync never gets
  // re-upserted -- guesty_reservations.status stays "confirmed" forever and
  // owner statements leak the cancelled stay. See memory
  // project_guesty_cancelled_reservation_leak.
  while (true) {
    const page = await guestyGet('/v1/reservations', token, { limit, skip, fields, ignoreStatusFilter: 'true' });
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
      // Store the raw folio line items so we can see the real shape and
      // build automatic extra-revenue capture against it. null when Guesty
      // doesn't return any (e.g. some channels) so the column stays clean.
      folio_items: Array.isArray(r.money?.invoiceItems) && r.money.invoiceItems.length > 0
        ? r.money.invoiceItems
        : null,
      synced_at: new Date().toISOString(),
    });
  }

  if (rows.length > 0) {
    const sb = getSupabase();
    const { error } = await sb.from('guesty_reservations').upsert(rows, { onConflict: 'guesty_reservation_id' });
    if (error) {
      // Tolerate the folio_items column not existing yet (migration unrun):
      // retry without it so the sync -- and its cron safety-net -- keeps
      // working. Everything else still persists; folio capture turns on
      // once supabase-schema-guesty-folio-items.sql is applied.
      const missingFolioCol = error.code === 'PGRST204'
        || /folio_items|column .*folio/i.test(error.message || '');
      if (!missingFolioCol) throw new Error(`guesty_reservations upsert failed: ${error.message}`);
      const stripped = rows.map(r => { const copy = { ...r }; delete copy.folio_items; return copy; });
      const { error: retryErr } = await sb.from('guesty_reservations').upsert(stripped, { onConflict: 'guesty_reservation_id' });
      if (retryErr) throw new Error(`guesty_reservations upsert failed: ${retryErr.message}`);
    }
  }
  return { fetched: reservations.length, upserted: rows.length, skipped: skippedNoProp };
}

// ---- Calendar blocks ----

/**
 * Fetch Guesty's per-day calendar for one listing and return the dates
 * Guesty marks as `blocked` (not booked / not reserved — those are
 * paid reservations we already capture). Seasonal closures (e.g.
 * 4 Brier Neck off-season) come through this path.
 */
async function fetchBlockedDays(
  listingId: string,
  token: string,
  startDate: string,
  endDate: string,
): Promise<string[]> {
  const params = { startDate, endDate };
  const path = `/v1/availability-pricing/api/calendar/listings/${listingId}`;
  const data = await guestyGet(path, token, params);
  // Guesty returns either `{ days: [...] }` or `{ data: { days: [...] } }`
  // depending on API version. Be defensive.
  const days = (data?.days ?? data?.data?.days ?? []) as Array<{
    date?: string;
    status?: string;
    listingStatus?: string;
  }>;
  const blocked: string[] = [];
  for (const day of days) {
    if (!day?.date) continue;
    const status = (day.status || day.listingStatus || '').toString().toLowerCase();
    if (status === 'blocked') blocked.push(day.date.slice(0, 10));
  }
  return blocked;
}

async function syncCalendarBlocks(
  token: string,
  listingMap: Record<string, string>,
  startDate: string,
  endDate: string,
) {
  const sb = getSupabase();
  const listings = Object.entries(listingMap); // [listingId, propertyId]
  let totalBlocked = 0;
  let listingsTouched = 0;
  const errors: string[] = [];

  // Build the full set of (property_id, date) rows we observe so we can
  // truthfully refresh the window: delete any rows in window that aren't
  // still blocked, then upsert the current blocked set.
  const observedByProperty = new Map<string, Set<string>>();

  for (const [listingId, propertyId] of listings) {
    try {
      const blocked = await fetchBlockedDays(listingId, token, startDate, endDate);
      observedByProperty.set(propertyId, new Set(blocked));
      totalBlocked += blocked.length;
      listingsTouched += 1;
      // Light pacing to be polite to Guesty's API.
      await sleep(150);
    } catch (err) {
      errors.push(`${propertyId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Reconcile: for each property we saw, clear stale blocks within the
  // window and upsert the current set.
  const now = new Date().toISOString();
  for (const [propertyId, dates] of observedByProperty.entries()) {
    const { error: delErr } = await sb
      .from('property_calendar_blocks')
      .delete()
      .eq('property_id', propertyId)
      .gte('date', startDate)
      .lte('date', endDate);
    if (delErr) {
      errors.push(`delete ${propertyId}: ${delErr.message}`);
      continue;
    }
    if (dates.size === 0) continue;
    const rows = Array.from(dates).map((date) => ({
      property_id: propertyId,
      date,
      synced_at: now,
    }));
    const { error: upErr } = await sb
      .from('property_calendar_blocks')
      .upsert(rows, { onConflict: 'property_id,date' });
    if (upErr) errors.push(`upsert ${propertyId}: ${upErr.message}`);
  }

  return {
    listings_touched: listingsTouched,
    blocked_days_total: totalBlocked,
    window: { startDate, endDate },
    errors: errors.length > 0 ? errors : undefined,
  };
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

    // Listings. Wrapped in its own try/catch so a refreshListingMap throw
    // (an expired Guesty token, a scope reduction, a 5xx) no longer cascades
    // and silently aborts reviews + reservations + calendar with NO sync
    // failure recorded for ANY guesty-* source. On a listings failure we
    // record the failure, fall back to the cached listingMap, and continue
    // with the rest of the sync so the rest of the dashboards stay current.
    let mapped = 0;
    let listingMap: Record<string, string> = {};
    let unmatchedListings: UnmatchedListing[] = [];
    if (refreshMap) {
      try {
        const { rows, unmatched } = await refreshListingMap(token);
        mapped = rows.length;
        unmatchedListings = unmatched;
        rows.forEach(r => { listingMap[r.listing_id] = r.property_id; });
        await recordSyncSuccess('guesty-listings', { mapped, unmatched_count: unmatched.length, unmatched });
      } catch (err) {
        await recordSyncFailure('guesty-listings', err);
        // Fall back to the cached map so reviews/reservations/calendar still run.
        listingMap = await loadListingMap();
        mapped = Object.keys(listingMap).length;
      }
    } else {
      listingMap = await loadListingMap();
      mapped = Object.keys(listingMap).length;
    }

    // Reviews
    let reviewsResult: Record<string, unknown> = { skipped_reason: 'not_attempted' };
    try {
      reviewsResult = await syncReviews(token, listingMap, sinceReviewsIso);
      await recordSyncSuccess('guesty-reviews', reviewsResult);
    } catch (err) {
      reviewsResult = { error: err instanceof Error ? err.message : String(err) };
      await recordSyncFailure('guesty-reviews', err);
    }

    // Auto-create work slips for any actionable reviews (below-five or
    // with private feedback) that don't already have one. Idempotent
    // via work_slips.from_review_id unique partial index.
    let reviewsToSlipsResult: Record<string, unknown> = { skipped_reason: 'not_attempted' };
    try {
      const { createSlipsFromActionableReviews } = await import('@/lib/reviews-to-slips');
      reviewsToSlipsResult = await createSlipsFromActionableReviews(sb) as unknown as Record<string, unknown>;
    } catch (err) {
      reviewsToSlipsResult = { error: err instanceof Error ? err.message : String(err) };
    }

    // Reservations (may fail on scope — don't take down the whole sync)
    let reservationsResult: Record<string, unknown> = { skipped_reason: 'not_attempted' };
    try {
      reservationsResult = await syncReservations(token, listingMap, sinceReservationsIso);
      await recordSyncSuccess('guesty-reservations', reservationsResult);
    } catch (err) {
      reservationsResult = { error: err instanceof Error ? err.message : String(err) };
      await recordSyncFailure('guesty-reservations', err);
    }

    // Calendar blocks (seasonal closures, manual date blocks). Pull a
    // window of 3 months back through 12 months forward — enough for any
    // current/future Revenue range we care about.
    let calendarResult: Record<string, unknown> = { skipped_reason: 'not_attempted' };
    try {
      const calStart = new Date();
      calStart.setMonth(calStart.getMonth() - 3);
      calStart.setDate(1);
      const calEnd = new Date();
      calEnd.setMonth(calEnd.getMonth() + 12);
      calEnd.setDate(28); // safe last-day-of-month proxy
      const startDate = calStart.toISOString().slice(0, 10);
      const endDate = calEnd.toISOString().slice(0, 10);
      calendarResult = await syncCalendarBlocks(token, listingMap, startDate, endDate);
      await recordSyncSuccess('guesty-calendar', calendarResult);
    } catch (err) {
      calendarResult = { error: err instanceof Error ? err.message : String(err) };
      await recordSyncFailure('guesty-calendar', err);
    }

    return NextResponse.json({
      success: true,
      listings_mapped: mapped,
      unmatched_listings: unmatchedListings,
      reviews: reviewsResult,
      reviews_to_slips: reviewsToSlipsResult,
      reservations: reservationsResult,
      calendar: calendarResult,
    });
  } catch (err) {
    console.error('sync-guesty error:', err);
    return NextResponse.json(
      { ...result, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
