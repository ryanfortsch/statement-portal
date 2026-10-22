import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { decideListingRetirement, type ListingRowLite } from '@/lib/listing-retirement';
import { NextRequest, NextResponse } from 'next/server';
import { recordSyncFailure, recordSyncSuccess, recordSyncResult } from '@/lib/sync-status';
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
import { loadHelmRunPropertyIds } from '@/lib/pms-guards';
import { selectAllPaged } from '@/lib/paged-select';
import {
  SYNC_BUDGET_MS,
  gateStep,
  parseRequestedSteps,
  planGuestySync,
  syncLogLine,
  waitingSteps,
  type GuestySyncStep,
  type StepOutcome,
} from '@/lib/guesty-sync-plan';

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
/** A listing that matched a property Helm now runs: deliberately not mapped. */
type HelmRunSkippedListing = { listing_id: string; property_id: string; nickname: string | null };

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

/**
 * Pull Guesty's listings and rebuild guesty_listings.
 *
 * `helmRunIds` are the properties whose calendar_authority is 'helm' (the
 * cutover switch, pms-guards). A listing that matches one of them is NOT an
 * unmatched listing (the LISTING_MATCH floor entry still names it, on
 * purpose, until the post-cutover cleanup) and it is NOT mapped either: it
 * is counted in `helm_run_skipped`, and any guesty_listings rows for those
 * properties are deleted after the upsert, so syncReviews, syncReservations
 * and the calendar mirror find no map entry for a home Guesty no longer
 * runs. Guesty credentials and the rest of the fleet are untouched.
 */
async function refreshListingMap(
  token: string,
  helmRunIds: ReadonlySet<string> = new Set(),
): Promise<{
  rows: ListingRow[];
  unmatched: UnmatchedListing[];
  helm_run_skipped: HelmRunSkippedListing[];
  removed: ListingRowLite[];
  held: ListingRowLite[];
}> {
  const needles = await listingNeedles();
  const all: any[] = [];
  let skip = 0;
  const limit = 100;
  // A pull is complete only when it reached a short page. Hitting the skip
  // guard means Guesty had more than we read, and an incomplete pull must
  // never be allowed to retire rows below.
  let pullComplete = false;
  while (true) {
    const page = await guestyGet('/v1/listings', token, { limit, skip });
    const batch = page.results || page.data || [];
    all.push(...batch);
    if (batch.length < limit) {
      pullComplete = true;
      break;
    }
    skip += limit;
    if (skip > 2000) break;
  }

  const rows: ListingRow[] = [];
  const unmatched: UnmatchedListing[] = [];
  const helmRunSkipped: HelmRunSkippedListing[] = [];
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
    // Helm runs this home now. Not unmatched, not mapped: skipped.
    if (helmRunIds.has(matched)) {
      helmRunSkipped.push({ listing_id: l._id, property_id: matched, nickname: nickname || null });
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
  // A home that flipped to Helm since the last run may still have its map
  // rows from before the flip (flip_calendar_authority deletes them too;
  // this is the belt to that brace, and it also catches a listing that was
  // mapped by hand). Their retirement below would refuse to act because
  // Guesty still returns the listing, so delete by property id explicitly.
  if (helmRunIds.size > 0) {
    const { error: helmDelErr } = await getSupabase()
      .from('guesty_listings')
      .delete()
      .in('property_id', [...helmRunIds]);
    if (helmDelErr) console.warn('[sync-guesty] helm-run guesty_listings delete failed:', helmDelErr.message);
  }

  // Retire rows Guesty no longer returns. The upsert above only ever added;
  // a listing removed on Guesty's side (17 Beach's Back Unit, gone since
  // 2026-06-02) stayed in the map for months, and every calendar refresh
  // 404'd on it. The guard (lib/listing-retirement.ts) refuses to act on an
  // incomplete pull, an implausibly small fleet, or a stale set bigger than
  // a quarter of the table, so a bad response can never wipe the map.
  let removed: ListingRowLite[] = [];
  let held: ListingRowLite[] = [];
  try {
    const { data: existingRows, error: existingErr } = await getSupabase()
      .from('guesty_listings')
      .select('listing_id, property_id, nickname');
    if (!existingErr && existingRows) {
      const decision = decideListingRetirement(
        existingRows as ListingRowLite[],
        all.map((l) => String(l._id)),
        { pullComplete },
      );
      held = decision.held;
      if (decision.retire.length > 0) {
        const { error: delErr } = await getSupabase()
          .from('guesty_listings')
          .delete()
          .in('listing_id', decision.retire.map((r) => r.listing_id));
        if (delErr) console.warn('[sync-guesty] listing retirement failed:', delErr.message);
        else removed = decision.retire;
      } else if (held.length > 0) {
        console.warn('[sync-guesty] stale listings held, not retired:', decision.reason, held.map((r) => r.listing_id));
      }
    }
  } catch (err) {
    console.warn('[sync-guesty] listing retirement skipped:', err instanceof Error ? err.message : String(err));
  }

  return { rows, unmatched, helm_run_skipped: helmRunSkipped, removed, held };
}

async function loadListingMap(): Promise<Record<string, string>> {
  const { data } = await getSupabase().from('guesty_listings').select('listing_id, property_id');
  const map: Record<string, string> = {};
  (data || []).forEach(r => { map[r.listing_id] = r.property_id; });
  return map;
}

// ---- Guest names (per-run cache) ----

/**
 * Guest names already on file, by Guesty guest id: the seed for the per-run
 * name cache, so a guest is looked up in Guesty only once, ever.
 *
 * Without it the reviews step asked Guesty for the guest behind every review
 * of the last two years on every run: about 465 calls against Guesty's
 * 120-a-minute limit, 60 to 78 of them answered 429 and retried after a 2-10s
 * sleep. That was about 190s of the nightly run's 237s (Vercel outbound
 * metrics, 2026-10-21) and the reason the sync hit the 300s limit whenever
 * two ran at once. An already-named guest keeps the name on file; a guest
 * with no name on file is still looked up every run until one sticks. A
 * failed read seeds nothing and every guest is looked up, as before.
 */
async function loadKnownGuestNames(): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  try {
    const rows = await selectAllPaged<{ guest_id: string | null; guest_name: string | null }>(
      (from, to) =>
        getSupabase()
          .from('reviews')
          .select('guest_id, guest_name')
          .not('guest_id', 'is', null)
          .not('guest_name', 'is', null)
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'sync-guesty known guest names' },
    );
    for (const r of rows) {
      if (r.guest_id && r.guest_name) names.set(r.guest_id, r.guest_name);
    }
  } catch (err) {
    console.warn('[sync-guesty] known guest names unread, looking every guest up:', err instanceof Error ? err.message : String(err));
  }
  return names;
}

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

/**
 * `deadlineMs` bounds the only open-ended part of the step, the guest
 * lookups. Past it, a review whose guest still needs a Guesty call is left
 * for the next run (counted in `deferred`) rather than written without its
 * name; reviews whose guest is already known are still written.
 */
async function syncReviews(
  token: string,
  listingMap: Record<string, string>,
  sinceIso: string,
  opts: { deadlineMs?: number } = {},
) {
  const reviews = await fetchAllReviews(token, sinceIso);
  const nameCache = await loadKnownGuestNames();
  const namesKnown = nameCache.size;
  let nameLookups = 0;
  let deferred = 0;
  const rows: Record<string, unknown>[] = [];
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
    const needsLookup = !!r.guestId && !nameCache.has(r.guestId);
    if (needsLookup && opts.deadlineMs !== undefined && Date.now() > opts.deadlineMs) {
      deferred++;
      continue;
    }
    if (needsLookup) nameLookups++;
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

  return {
    fetched: reviews.length,
    upserted: rows.length,
    skipped,
    names_known: namesKnown,
    name_lookups: nameLookups,
    deferred,
    unparsed_by_channel: unparsedByChannel,
  };
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

// The platform limit, also set on /api/cron/sync-guesty, which runs this
// handler in-process. Steps stop starting at SYNC_BUDGET_MS (a minute short
// of this, lib/guesty-sync-plan), so a slow run ends with a partial result
// naming what waited instead of dying mid-step.
export const maxDuration = 300;

type StepResult = Record<string, unknown>;

/**
 * Body, all optional:
 *   refreshMap         false reads the cached listing map instead of refreshing it
 *   steps              the steps to run (GUESTY_SYNC_STEPS in lib/guesty-sync-plan);
 *                      absent means all. The Revenue page asks for RESERVATION_STEPS.
 *   sinceReviews       ISO floor for reviews (default two years back)
 *   sinceReservations  ISO checkOut floor for reservations (default 90 days back)
 *
 * The response keeps one key per step, as before (a step that did not run
 * carries `skipped_reason`), plus `steps` (status and ms for each, in run
 * order), `waiting_steps` (what ran out of time and catches up on the next
 * run) and `partial`.
 */
export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const result: Record<string, unknown> = { success: false };
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }
    if (!process.env.GUESTY_CLIENT_ID || !process.env.GUESTY_CLIENT_SECRET) {
      return NextResponse.json({ error: 'GUESTY_CLIENT_ID / GUESTY_CLIENT_SECRET not configured' }, { status: 500 });
    }

    const body = await request.json().catch(() => ({}));
    const parsedSteps = parseRequestedSteps(body.steps);
    if (!parsedSteps.ok) return NextResponse.json({ error: parsedSteps.error }, { status: 400 });
    const requested = parsedSteps.steps;
    if (body.refreshMap === false) requested.delete('listings');
    const sinceReviewsIso: string = body.sinceReviews || new Date(Date.now() - 2 * 365 * 86400_000).toISOString();
    // Pull reservations from 3 months back (completed) through far future.
    const sinceReservationsIso: string = body.sinceReservations || new Date(Date.now() - 90 * 86400_000).toISOString();

    const token = await getGuestyToken();
    const sb = getSupabase();

    // The cutover switch. Homes Helm runs are dropped from the listing map
    // (so reviews / reservations / gaps never see them) and skipped by the
    // calendar mirror sync; the reconcilers and backfill filter themselves.
    // Empty on a failed read = skip nothing, today's behaviour.
    const helmRunIds = await loadHelmRunPropertyIds(sb);

    let mapped = 0;
    let listingMap: Record<string, string> = {};
    let unmatchedListings: UnmatchedListing[] = [];
    let helmRunSkipped: HelmRunSkippedListing[] = [];
    if (!requested.has('listings')) {
      listingMap = await loadListingMap();
      mapped = Object.keys(listingMap).length;
    }

    // Calendar blocks (seasonal closures, manual date blocks). Pull a
    // window of 3 months back through 12 months forward: enough for any
    // current/future Revenue range we care about.
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

    // One body per step. Each records its own sync_status and returns its
    // result; `{ error }` marks a failed step. Order, prerequisites and the
    // time budget are lib/guesty-sync-plan's, not these bodies'.
    const steps: Record<GuestySyncStep, () => Promise<StepResult>> = {
      // Listings. A refreshListingMap throw (an expired Guesty token, a
      // scope reduction, a 5xx) records the failure and falls back to the
      // cached listingMap, so the rest of the sync still runs.
      listings: async () => {
        try {
          const { rows, unmatched, helm_run_skipped, removed, held } = await refreshListingMap(token, helmRunIds);
          mapped = rows.length;
          unmatchedListings = unmatched;
          helmRunSkipped = helm_run_skipped;
          rows.forEach(r => { listingMap[r.listing_id] = r.property_id; });
          await recordSyncSuccess('guesty-listings', {
            mapped,
            unmatched_count: unmatched.length,
            unmatched,
            // Listings for homes Helm now runs: not unmatched, not mapped.
            helm_run_skipped,
            // Rows Guesty stopped returning that this run retired, and any
            // stale rows the guard held back for a human.
            removed: removed.map(r => ({ listing_id: r.listing_id, property_id: r.property_id, nickname: r.nickname })),
            held: held.map(r => ({ listing_id: r.listing_id, property_id: r.property_id, nickname: r.nickname })),
          });
          return { mapped, unmatched_count: unmatched.length };
        } catch (err) {
          await recordSyncFailure('guesty-listings', err);
          listingMap = await loadListingMap();
          mapped = Object.keys(listingMap).length;
          return { error: err instanceof Error ? err.message : String(err), used_cached_map: mapped };
        }
      },

      // Reservations (may fail on scope; the rest of the sync still runs).
      reservations: async () => {
        try {
          const r = await syncReservations(token, listingMap, sinceReservationsIso);
          await recordSyncSuccess('guesty-reservations', r);
          return r;
        } catch (err) {
          await recordSyncFailure('guesty-reservations', err);
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },

      // Stale-row cancel reconcile (Phase 2 of the cancel-leak fix). Runs
      // only after a successful pull: if the pull failed, every row looks
      // stale and the per-code probes would burn rate limit for nothing.
      cancel_reconcile: async () => {
        try {
          const r = await reconcileStaleReservations();
          await recordSyncSuccess('guesty-cancel-reconcile', r);
          return r;
        } catch (err) {
          await recordSyncFailure('guesty-cancel-reconcile', err);
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },

      // Phase 3: cancel bookings that BOTH the calendar mirror and the
      // (already API-probed) reservation record say are not real stays.
      // After phase 2 so it reads the freshest reservation statuses. The
      // mirror it reads is kept current by the 30-minute channels-sync, and
      // the step refuses a mirror older than 36 hours.
      ghost_bookings: async () => {
        try {
          const r = { ...(await cancelGhostBookings()) };
          await recordSyncSuccess('guesty-ghost-bookings', r);
          return r;
        } catch (err) {
          await recordSyncFailure('guesty-ghost-bookings', err);
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },

      // Carry the pull the rest of the way into `bookings`. syncReservations
      // only fills the guesty_reservations CACHE; the copy into the Helm-native
      // bookings table is a separate step that ran on its own cron 15 minutes
      // later. So the dashboard's "Syncing bookings…" button truthfully synced
      // nothing a booking-reading page could see until the next morning
      // (2026-08-25: Andrea Richmond's stay reached the cache at 2:37 PM and
      // still wasn't in `bookings`). Idempotent, and skipped when the pull
      // failed, as there would be nothing new to copy.
      bookings_backfill: async () => {
        try {
          const r = await backfillGuestyToBookings({}) as unknown as StepResult;
          await recordSyncSuccess('guesty-bookings-backfill', r);
          return r;
        } catch (err) {
          await recordSyncFailure('guesty-bookings-backfill', err);
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },

      calendar: async () => {
        try {
          const { startDate, endDate } = calWindow;
          // The map already excludes helm-run homes; the skip set is the
          // guarantee that their rows are never swept even if a stale map row
          // slipped through (the Helm mirror owns those tables for them).
          const cal = await syncCalendarDays(listingMap, startDate, endDate, { skipPropertyIds: helmRunIds });
          // A property whose refresh threw is swallowed inside syncCalendarDays.
          // Stamping unconditional success left sync_status 'ok' on a mirror
          // that had quietly stopped updating, while every downstream freshness
          // guard kept trusting it.
          await recordSyncResult('guesty-calendar', {
            processed: cal.listings_touched,
            failed: cal.properties_failed,
            firstError: cal.errors?.[0],
            result: cal,
          });
          return cal;
        } catch (err) {
          await recordSyncFailure('guesty-calendar', err);
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },

      // Reservation gap backfill. Runs right after the calendar because it
      // audits that step and the reservations against each other: every night
      // the calendar mirror calls sold, matched to the reservation that should
      // be behind it. What is left over is a stay this pull did not return.
      // The 90-day floor #1334 gave the feed is a floor, not a guarantee, and
      // nothing else in the sync would ever notice a stay it silently skipped.
      // Records its own sync_status; never throws.
      reservation_gaps: async () =>
        (await backfillReservationGaps({
          startDate: calWindow.startDate,
          endDate: calWindow.endDate,
        })) as unknown as StepResult,

      // Reviews. Only the guest lookups are open-ended, so they get the
      // budget's deadline; see syncReviews.
      reviews: async () => {
        try {
          const r = await syncReviews(token, listingMap, sinceReviewsIso, { deadlineMs: startedAt + SYNC_BUDGET_MS });
          await recordSyncSuccess('guesty-reviews', r);
          return r;
        } catch (err) {
          await recordSyncFailure('guesty-reviews', err);
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },

      // Auto-create work slips for any actionable reviews (below-five or
      // with private feedback) that don't already have one. Idempotent
      // via work_slips.from_review_id unique partial index, and it reads a
      // 45-day window, so a run that waits for time loses nothing.
      reviews_to_slips: async () => {
        try {
          const { createSlipsFromActionableReviews } = await import('@/lib/reviews-to-slips');
          return await createSlipsFromActionableReviews(sb) as unknown as StepResult;
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    };

    const results: Partial<Record<GuestySyncStep, StepResult>> = {};
    const outcomes: StepOutcome[] = [];
    const outcomeByStep = new Map<GuestySyncStep, StepOutcome>();
    for (const step of planGuestySync(requested, startedAt)) {
      const gate = gateStep(step, { elapsedMs: Date.now() - startedAt, outcomes: outcomeByStep });
      let outcome: StepOutcome;
      if (!gate.run) {
        results[step] = { skipped_reason: gate.reason };
        outcome = { step, status: 'skipped', ms: 0, reason: gate.reason };
      } else {
        const t0 = Date.now();
        let r: StepResult;
        try {
          r = await steps[step]();
        } catch (err) {
          r = { error: err instanceof Error ? err.message : String(err) };
        }
        results[step] = r;
        outcome = { step, status: 'error' in r ? 'error' : 'ok', ms: Date.now() - t0 };
      }
      outcomes.push(outcome);
      outcomeByStep.set(step, outcome);
    }

    const elapsedMs = Date.now() - startedAt;
    const waiting = waitingSteps(outcomes);
    console.log(syncLogLine(outcomes, elapsedMs));

    const stepResult = (step: GuestySyncStep): StepResult => results[step] ?? { skipped_reason: 'not_requested' };
    return NextResponse.json({
      success: true,
      partial: waiting.length > 0,
      waiting_steps: waiting,
      steps: outcomes,
      elapsed_ms: elapsedMs,
      budget_ms: SYNC_BUDGET_MS,
      listings_mapped: mapped,
      unmatched_listings: unmatchedListings,
      helm_run_skipped: helmRunSkipped,
      reviews: stepResult('reviews'),
      reviews_to_slips: stepResult('reviews_to_slips'),
      reservations: stepResult('reservations'),
      reservations_reconcile: stepResult('cancel_reconcile'),
      ghost_bookings: stepResult('ghost_bookings'),
      bookings_backfill: stepResult('bookings_backfill'),
      calendar: stepResult('calendar'),
      reservation_gaps: stepResult('reservation_gaps'),
    });
  } catch (err) {
    console.error('sync-guesty error:', err);
    return NextResponse.json(
      { ...result, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
