import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { recordSyncFailure, recordSyncSuccess } from '@/lib/sync-status';
import { syncCalendarDays } from '@/lib/calendar-days';
import { reconcileStaleReservations } from '@/lib/reservation-reconcile';
import { cancelGhostBookings } from '@/lib/ghost-booking-reconcile';
import { backfillReservationGaps } from '@/lib/reservation-gap-backfill';
import {
  RESERVATION_FIELDS,
  mapReservationRow,
  upsertGuestyReservations,
  type GuestyReservation,
} from '@/lib/guesty-reservations';
import { backfillGuestyToBookings } from '@/lib/guesty-backfill';
import { guestNameFromRawReview, normalizeGuestyReview } from '@/lib/guesty-review-normalize';

const GUESTY_API = 'https://open-api.guesty.com';

// The FLOOR of the needle map, not the whole of it. `listingNeedles()` below
// overlays every `properties.listing_match` in the database on top of this, so
// an ordinary new property needs no entry here: stamping the column when the
// property is created is enough.
//
// This object is still required, because two mapped listings have no
// properties row at all (65 Calderwood and 3246 NE 27th, both RT-owned and
// out of the management fleet). Without them the DB-only map would drop
// listings that are mapped today.
//
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
  // Guesty listing 6a79f91a320f1200145873de, external title "Stay in
  // Central Gloucester" (the only "Stay in" title). Missing from this map
  // until 2026-08-24, so its reservations landed in `unmatched` every sync.
  '225_washington': '225 washington',
  '3_windward':    '3 windward',
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
  '225_washington': 'central gloucester',
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

/**
 * Needles to match a Guesty listing against, property id to needle.
 *
 * The hardcoded LISTING_MATCH is the floor; every non-empty
 * `properties.listing_match` in the database is layered on top and wins.
 *
 * Why this is not a hardcoded map any more: 4 Middle Road went live in
 * Guesty as listing 6a8f8eaca4a9df0011764b00 ("4 Middle", 4 Middle Rd,
 * Rockport) and its own properties row already carried listing_match
 * '4 middle', but the sync read only the hardcoded object, so the listing
 * fell into `unmatched` on every run while the sync recorded status "ok".
 * Helm therefore held zero reservations, zero bookings and zero statements
 * for a home that was taking bookings, and the forecast projected it off the
 * portfolio average. The same failure hid 225 Washington until 2026-08-24,
 * which is why it is fixed at the source rather than by adding one more line.
 *
 * A DB read failure is not fatal: the floor still matches every listing that
 * matched before this function existed.
 */
async function listingNeedles(): Promise<Record<string, string>> {
  const needles: Record<string, string> = { ...LISTING_MATCH };
  try {
    const { data, error } = await getSupabase()
      .from('properties')
      .select('id, listing_match');
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const needle = (row.listing_match ?? '').toString().trim().toLowerCase();
      if (row.id && needle) needles[row.id] = needle;
    }
  } catch (err) {
    console.error('[sync-guesty] listing_match read failed, using the hardcoded floor:', err);
  }
  return needles;
}

async function refreshListingMap(
  token: string,
): Promise<{ rows: ListingRow[]; unmatched: UnmatchedListing[] }> {
  const needles = await listingNeedles();
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
    for (const [propId, needle] of Object.entries(needles)) {
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

    // Stamp the resolved id onto the property row itself, fill-empty-only.
    // properties.guesty_listing_id is what the SCA launch form prefills and
    // what the launch checklist's listing-match derive reads, but nothing
    // populated it (0 of 19 active rows on 2026-08-03), so every SCA launch
    // hand-hunted the Mongo id from a Guesty URL. Only single-listing
    // properties are stamped: a property with several mapped listings in
    // this run has no unambiguous canonical id, and an operator-set value
    // is never overwritten either way.
    const byProp = new Map<string, string[]>();
    for (const r of rows) {
      const arr = byProp.get(r.property_id) ?? [];
      arr.push(r.listing_id);
      byProp.set(r.property_id, arr);
    }
    for (const [propId, ids] of byProp) {
      if (ids.length !== 1) continue;
      const { error: stampErr } = await getSupabase()
        .from('properties')
        .update({ guesty_listing_id: ids[0] })
        .eq('id', propId)
        .is('guesty_listing_id', null);
      if (stampErr) console.warn('[sync-guesty] listing-id stamp skipped:', propId, stampErr.message);
    }

    // Fill-empty the per-property default CHECKOUT time from the listing's
    // own defaultCheckOutTime ("10:00" / "11:00" strings in Guesty). This
    // feeds the cleaner checkout schedule (lib/checkout-schedule.ts); an
    // operator-set value on /turnovers/schedule is never overwritten, same
    // contract as the listing-id stamp above.
    //
    // CHECK-IN is deliberately NOT synced. Guesty carries each listing's
    // guest-facing arrival time (16:00 fleet-wide), but the cleaner schedule
    // guides to 15:00 on purpose (Dotti, 2026-08-24): the home has to be
    // ready BEFORE the guest lands, and the hour is the margin. Filling this
    // column from Guesty put "next guest in at 4 PM" in front of the
    // cleaners and silently reverted the 3 PM guidance once already, so the
    // house rule lives in the DB and nothing here touches it.
    const timesByListing = new Map<string, { in: string | null; out: string | null }>();
    for (const l of all) {
      timesByListing.set(l._id, {
        in: typeof l.defaultCheckInTime === 'string' ? l.defaultCheckInTime : null,
        out: typeof l.defaultCheckOutTime === 'string' ? l.defaultCheckOutTime : null,
      });
    }
    const asHHMM = (raw: string | null): string | null => {
      const m = raw ? /^(\d{1,2}):(\d{2})/.exec(raw.trim()) : null;
      if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
      return `${m[1].padStart(2, '0')}:${m[2]}`;
    };
    for (const [propId, ids] of byProp) {
      if (ids.length !== 1) continue;
      const t = timesByListing.get(ids[0]);
      const checkout = asHHMM(t?.out ?? null);
      if (checkout) {
        await getSupabase()
          .from('properties')
          .update({ default_checkout_time: checkout })
          .eq('id', propId)
          .is('default_checkout_time', null);
      }
    }
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
  // Reviews whose payload yielded no rating and no text, by channel. An
  // empty row is normal (Guesty opens one when a stay completes, before
  // the guest writes anything), but a channel that is ALL empties is the
  // signature of a payload shape the normalizer does not speak yet, which
  // is how VRBO went unnoticed for two years. Surfaced in sync_status.
  const unparsedByChannel: Record<string, number> = {};

  for (const r of reviews) {
    const propertyId = r.listingId ? listingMap[r.listingId] : undefined;
    if (!propertyId) { skipped++; continue; }
    // Guesty's guest record wins when it exists; 42 of the VRBO reviews on
    // file carry no guestId at all, and their payload names the guest.
    const guestName =
      (r.guestId ? await resolveGuestName(r.guestId, token, nameCache) : null) ||
      guestNameFromRawReview(r.channelId, r.rawReview);
    // Guesty hands back the channel's own review payload verbatim and
    // normalizes nothing, so each channel needs its own reader. Parsing
    // Airbnb's shape alone is what left every VRBO and Booking.com review
    // stored with a null rating and null text, invisible everywhere.
    const parsed = normalizeGuestyReview(r.channelId, r.rawReview);
    if (parsed.overall_rating === null && !parsed.public_review && !parsed.private_feedback) {
      unparsedByChannel[r.channelId || 'unknown'] = (unparsedByChannel[r.channelId || 'unknown'] || 0) + 1;
    }

    rows.push({
      guesty_review_id: r._id,
      listing_id: r.listingId || null,
      property_id: propertyId,
      reservation_id: r.reservationId || null,
      guest_id: r.guestId || null,
      guest_name: guestName,
      channel: channelFromGuesty(r.channelId),
      guesty_channel_id: r.channelId || null,
      ...parsed,
      raw_review: r.rawReview ?? null,
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

  return { fetched: reviews.length, upserted: rows.length, skipped, unparsed_by_channel: unparsedByChannel };
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

async function fetchAllReservations(token: string, sinceIso?: string): Promise<GuestyReservation[]> {
  const all: GuestyReservation[] = [];
  let skip = 0;
  const limit = 100;
  const fields = RESERVATION_FIELDS;
  // THE FLOOR MUST BE SERVER-SIDE. Probed live 2026-08-25: this endpoint
  // silently returns only reservations whose checkIn is today or later --
  // 122 rows unfiltered, vs 264 with a checkOut floor, and every one of the
  // 31 stays IN PROGRESS right now missing from the unfiltered set. So a
  // stay that was booked and started between two syncs never landed at all
  // (225 Washington's Andrea Richmond, Aug 22-29, booked the morning she
  // arrived), and the "3 months back (completed)" this function claimed to
  // pull never arrived either. A checkOut $gte filter returns in-progress
  // and recently-finished stays alike. The old client-side floor could not
  // do this: it only ever discarded rows, and its early `hitFloor` break
  // truncated pagination on an ordering the feed never promised.
  const floor = sinceIso ? sinceIso.slice(0, 10) : null;
  const filters = floor
    ? JSON.stringify([{ field: 'checkOut', operator: '$gte', value: floor }])
    : null;
  // ignoreStatusFilter=true is a PROVEN no-op on this endpoint (identical
  // response either way), kept only to match the verified working query.
  // Rows the feed drops once they leave `confirmed` are healed by
  // reconcileStaleReservations() after each pull, via the per-code
  // confirmationCode filter. See memory guesty-sync-pagination-debt.
  let useFilters = !!filters;
  while (true) {
    const params: Record<string, string | number> = { limit, skip, fields, ignoreStatusFilter: 'true' };
    if (useFilters && filters) params.filters = filters;
    let page;
    try {
      page = await guestyGet('/v1/reservations', token, params);
    } catch (err) {
      // If Guesty ever rejects the filter shape, fall back to the unfiltered
      // feed rather than syncing nothing — degraded (no in-progress stays)
      // beats empty. Only retried once, on the first page.
      if (useFilters && skip === 0) {
        console.warn('[sync-guesty] checkOut filter rejected, falling back to unfiltered feed', err);
        useFilters = false;
        continue;
      }
      throw err;
    }
    const batch: GuestyReservation[] = page.data || page.results || [];
    if (batch.length === 0) break;
    for (const r of batch) {
      // Belt-and-braces: the server filter is the real floor, this just drops
      // anything stray that slipped under it. NEVER breaks pagination.
      const ref = r.checkOut || r.checkIn;
      if (floor && ref && ref.slice(0, 10) < floor) continue;
      all.push(r);
    }
    if (batch.length < limit) break;
    skip += limit;
    if (skip > 10000) break;
  }
  return all;
}

async function syncReservations(token: string, listingMap: Record<string, string>, sinceIso: string) {
  const reservations = await fetchAllReservations(token, sinceIso);
  const rows: ReturnType<typeof mapReservationRow>[] = [];
  let skippedNoProp = 0;

  const syncedAt = new Date().toISOString();

  for (const r of reservations) {
    const propertyId = r.listingId ? listingMap[r.listingId] : undefined;
    if (!propertyId) { skippedNoProp++; continue; }
    rows.push(mapReservationRow(r, propertyId, syncedAt));
  }

  await upsertGuestyReservations(getSupabase(), rows);
  return { fetched: reservations.length, upserted: rows.length, skipped: skippedNoProp };
}

// ---- Stale-reservation cancel reconcile ----
// Phase 2 of the cancelled-reservation-leak fix lives in
// lib/reservation-reconcile.ts (shared-lib pattern, same as calendar-days):
// rows the list feed stops returning get verified per-code against the live
// API and flipped when Guesty reports them cancelled. Wired into POST below,
// after a successful reservations pull.

// ---- Calendar days ----
// The per-day availability/pricing sync (hold notes, prices, min-stay, and
// the real-hold rollup into property_calendar_blocks) lives in
// lib/calendar-days.ts, shared with the 30-minute channels-sync cron. The
// old in-route version filtered days on status === 'blocked', a value the
// API never returns (it says 'unavailable'), so it synced nothing.

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

    // Stale-row cancel reconcile (Phase 2 of the cancel-leak fix). Only
    // after a successful pull: if the pull itself failed, every row looks
    // stale and the per-code probes would burn rate limit for nothing.
    let reconcileResult: Record<string, unknown> = { skipped_reason: 'reservations_sync_failed' };
    if (!('error' in reservationsResult)) {
      try {
        reconcileResult = await reconcileStaleReservations();
        await recordSyncSuccess('guesty-cancel-reconcile', reconcileResult);
      } catch (err) {
        reconcileResult = { error: err instanceof Error ? err.message : String(err) };
        await recordSyncFailure('guesty-cancel-reconcile', err);
      }
    }

    // Phase 3: cancel bookings that BOTH the calendar mirror and the
    // (already API-probed) reservation record say are not real stays.
    // Runs after phase 2 so it reads the freshest reservation statuses,
    // and after the calendar sync above so the mirror is current.
    let ghostResult: Record<string, unknown> = { skipped_reason: 'reservations_sync_failed' };
    if (!('error' in reservationsResult)) {
      try {
        ghostResult = { ...(await cancelGhostBookings()) };
        await recordSyncSuccess('guesty-ghost-bookings', ghostResult);
      } catch (err) {
        ghostResult = { error: err instanceof Error ? err.message : String(err) };
        await recordSyncFailure('guesty-ghost-bookings', err);
      }
    }

    // Carry the pull the rest of the way into `bookings`. syncReservations
    // only fills the guesty_reservations CACHE; the copy into the Helm-native
    // bookings table is a separate step that ran on its own cron 15 minutes
    // later. So the dashboard's "Syncing bookings…" button truthfully synced
    // nothing a booking-reading page could see until the next morning
    // (2026-08-25: Andrea Richmond's stay reached the cache at 2:37 PM and
    // still wasn't in `bookings`). Idempotent, and skipped when the pull
    // failed — there'd be nothing new to copy.
    let backfillResult: Record<string, unknown> = { skipped_reason: 'reservations_sync_failed' };
    if (!('error' in reservationsResult)) {
      try {
        backfillResult = await backfillGuestyToBookings({}) as unknown as Record<string, unknown>;
        await recordSyncSuccess('guesty-bookings-backfill', backfillResult);
      } catch (err) {
        backfillResult = { error: err instanceof Error ? err.message : String(err) };
        await recordSyncFailure('guesty-bookings-backfill', err);
      }
    }

    // Calendar blocks (seasonal closures, manual date blocks). Pull a
    // window of 3 months back through 12 months forward — enough for any
    // current/future Revenue range we care about.
    let calendarResult: Record<string, unknown> = { skipped_reason: 'not_attempted' };
    const calStart = new Date();
    calStart.setMonth(calStart.getMonth() - 3);
    calStart.setDate(1);
    const calEnd = new Date();
    calEnd.setMonth(calEnd.getMonth() + 12);
    calEnd.setDate(28); // safe last-day-of-month proxy
    const calWindow = {
      startDate: calStart.toISOString().slice(0, 10),
      endDate: calEnd.toISOString().slice(0, 10),
    };
    try {
      const { startDate, endDate } = calWindow;
      calendarResult = await syncCalendarDays(listingMap, startDate, endDate);
      await recordSyncSuccess('guesty-calendar', calendarResult);
    } catch (err) {
      calendarResult = { error: err instanceof Error ? err.message : String(err) };
      await recordSyncFailure('guesty-calendar', err);
    }

    // Reservation gap backfill. Runs LAST because it audits the two steps
    // above against each other: every night the calendar mirror calls sold,
    // matched to the reservation that should be behind it. What is left over
    // is a stay this pull did not return. The 90-day floor #1334 gave the feed
    // is a floor, not a guarantee, and nothing else in the sync would ever
    // notice a stay it silently skipped. Records its own sync_status; never
    // throws.
    let reservationGapsResult: Record<string, unknown> = { skipped_reason: 'calendar_sync_failed' };
    if (!('error' in calendarResult)) {
      reservationGapsResult = (await backfillReservationGaps({
        startDate: calWindow.startDate,
        endDate: calWindow.endDate,
      })) as unknown as Record<string, unknown>;
    }

    return NextResponse.json({
      success: true,
      listings_mapped: mapped,
      unmatched_listings: unmatchedListings,
      reviews: reviewsResult,
      reviews_to_slips: reviewsToSlipsResult,
      reservations: reservationsResult,
      reservations_reconcile: reconcileResult,
      ghost_bookings: ghostResult,
      bookings_backfill: backfillResult,
      calendar: calendarResult,
      reservation_gaps: reservationGapsResult,
    });
  } catch (err) {
    console.error('sync-guesty error:', err);
    return NextResponse.json(
      { ...result, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
