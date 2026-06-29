/**
 * Shared Guesty Open API client.
 *
 * Extracted from src/app/api/sync-guesty/route.ts so on-demand server
 * actions (e.g. the property-page Guesty backfill) can hit the API
 * without duplicating the OAuth token cache logic. Both code paths
 * share the `guesty_auth` Supabase row, so token re-use stays coherent
 * across cron + interactive callers.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const GUESTY_API = 'https://open-api.guesty.com';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

let _supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw new Error('Supabase URL / service role key not configured');
  _supabase = createClient(url, key);
  return _supabase;
}

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

export async function getGuestyToken(): Promise<string> {
  const now = Date.now();
  if (memTok && now < memTok.expiresAt - 60_000) return memTok.token;

  const sb = getSupabase();
  const { data: row } = await sb
    .from('guesty_auth')
    .select('access_token, expires_at')
    .eq('id', 1)
    .maybeSingle();
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
    {
      id: 1,
      access_token: fresh.token,
      expires_at: new Date(fresh.expiresAt).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );
  return fresh.token;
}

export async function guestyGet<T = unknown>(
  path: string,
  params?: Record<string, string | number>,
): Promise<T> {
  const token = await getGuestyToken();
  const qs = params
    ? '?' + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))
    : '';
  const url = `${GUESTY_API}${path}${qs}`;
  const delays = [0, 2000, 5000, 10000];
  let lastStatus = 0;
  let lastBody = '';
  for (const d of delays) {
    if (d) await sleep(d);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (res.status === 429) {
      lastStatus = 429;
      lastBody = await res.text();
      continue;
    }
    if (!res.ok) throw new Error(`Guesty GET ${path} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }
  throw new Error(`Guesty GET ${path} rate-limited after retries (${lastStatus}): ${lastBody}`);
}

/**
 * Subset of fields the /v1/listings/{id} endpoint returns that we use to
 * backfill a property row. Guesty returns a much larger object — this is
 * just the typed slice. Kept narrow on purpose so unrelated Guesty schema
 * changes don't break our typings.
 */
export type GuestyListingDetail = {
  _id: string;
  nickname?: string;
  title?: string;
  bedrooms?: number;
  bathrooms?: number;
  accommodates?: number;
  propertyType?: string;
  address?: {
    full?: string;
    street?: string;
    city?: string;
    state?: string;
    country?: string;
    lat?: number;
    lng?: number;
  };
  /** Some Guesty accounts populate this; many don't. Treated as best-effort. */
  area?: number;
  /** Guest-facing copy blocks. summary ~ tagline; space ~ the "About" body. */
  publicDescription?: {
    summary?: string;
    space?: string;
    neighborhood?: string;
    [k: string]: unknown;
  };
  pictures?: Array<{ original?: string; caption?: string }>;
  amenities?: string[];
};

/** Pull the full detail record for one Guesty listing. */
export async function getGuestyListing(listingId: string): Promise<GuestyListingDetail> {
  return guestyGet<GuestyListingDetail>(`/v1/listings/${listingId}`);
}

/**
 * A single photo on a Guesty listing/property, as returned by the
 * property-photos API. `original` / `thumbnail` are public CDN URLs (no
 * auth needed to load them in an <img> or to fetch them for the vision
 * model).
 */
export type GuestyPhoto = {
  _id: string;
  source?: string;
  original?: string;
  thumbnail?: string;
  caption?: string;
  index?: number;
};

/**
 * Guesty's property-photos resource. The path really does double the
 * "property-photos" segment, and the id is Guesty's PROPERTY id (for our
 * single-unit STR listings the listing `_id` doubles as the property id;
 * if a property ever 404s here, fetch the listing detail to map it).
 *
 * NOTE: this is NOT under /v1/listings/{id}/photos — that path routes to a
 * non-existent /api/v2 upstream and 404s (observed live 2026-06-26). The
 * real path is the properties-api one below.
 */
function propertyPhotosPath(propertyId: string, photoId?: string): string {
  const base = `/v1/properties-api/property-photos/property-photos/${propertyId}`;
  return photoId ? `${base}/${photoId}` : base;
}

/** Raw picture shape on a listing's `pictures` array. Guesty documents
 *  original/thumbnail/regular/large/caption; `_id` is present in practice
 *  even though the public schema omits it. */
type RawListingPicture = {
  _id?: string;
  original?: string;
  thumbnail?: string;
  regular?: string;
  large?: string;
  caption?: string;
  index?: number;
};

/**
 * List every photo on a listing, in Guesty's display order.
 *
 * Reads the listing object's `pictures` array (GET /v1/listings/{id}) —
 * the same source sync-guesty uses for hero images. We do NOT use a
 * `/listings/{id}/photos` sub-resource (it 404s) nor the property-photos
 * GET (keyed by a property id our listings don't expose; it comes back
 * empty). The picture `_id` (when present) doubles as the photoId for the
 * caption write.
 */
export async function getListingPhotos(listingId: string): Promise<GuestyPhoto[]> {
  const listing = await guestyGet<{ pictures?: RawListingPicture[] }>(`/v1/listings/${listingId}`);
  const pics = Array.isArray(listing.pictures) ? listing.pictures : [];
  return pics.map((p, i) => ({
    _id: (p._id && p._id.trim()) || String(i),
    original: p.original,
    thumbnail: p.thumbnail ?? p.regular ?? p.large ?? p.original,
    caption: p.caption,
    index: typeof p.index === 'number' ? p.index : i,
  }));
}

/**
 * JSON write helper (POST/PATCH/PUT) sharing guestyGet's token cache +
 * 429 backoff. The GET-only guestyGet can't mutate.
 */
async function guestyWrite<T = unknown>(
  method: 'POST' | 'PATCH' | 'PUT',
  path: string,
  body: unknown,
): Promise<T> {
  const token = await getGuestyToken();
  const url = `${GUESTY_API}${path}`;
  const delays = [0, 2000, 5000, 10000];
  let lastStatus = 0;
  let lastBody = '';
  for (const d of delays) {
    if (d) await sleep(d);
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.status === 429) {
      lastStatus = 429;
      lastBody = await res.text();
      continue;
    }
    if (!res.ok) throw new Error(`Guesty ${method} ${path} failed: ${res.status} ${await res.text()}`);
    // The caption edit answers 201 with the updated photo array; some
    // Guesty mutations answer 204 empty. We don't depend on the body (the
    // caption is what we sent), so tolerate a non-JSON 200 instead of
    // throwing a parse error.
    const text = await res.text();
    if (!text) return null as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return null as T;
    }
  }
  throw new Error(`Guesty ${method} ${path} rate-limited after retries (${lastStatus}): ${lastBody}`);
}

/**
 * Edit one photo's caption.
 * POST /v1/properties-api/property-photos/property-photos/{id}/{photoId}
 * with { caption }. (Yes, POST, not PATCH — Guesty's property-photos API
 * uses POST for the caption/replace edit.) Order and room assignment are
 * preserved; only the caption changes. Returns the updated photo array
 * Guesty echoes back on 201 (best-effort; may be null).
 */
export async function updatePhotoCaption(
  propertyId: string,
  photoId: string,
  caption: string,
): Promise<GuestyPhoto[] | null> {
  return guestyWrite<GuestyPhoto[] | null>(
    'POST',
    propertyPhotosPath(propertyId, photoId),
    { caption },
  );
}

/**
 * The guest-facing listing fields Helm can fill from its own property data.
 * All top-level on the Guesty listing object, confirmed against Guesty's
 * "Property Location & Details" docs (open-api-docs.guesty.com/docs/listing-location).
 * These double as auto-message variables on the Guesty side.
 */
export type GuestyGuestFields = {
  wifiName: string;
  wifiPassword: string;
  parkingInstructions: string;
  trashCollectedOn: string;
};

export const GUESTY_GUEST_FIELD_KEYS: (keyof GuestyGuestFields)[] = [
  'wifiName',
  'wifiPassword',
  'parkingInstructions',
  'trashCollectedOn',
];

/**
 * Read the current values of the guest-facing fields off a listing.
 * Anything Guesty leaves unset comes back as '' so the diff UI can treat it
 * as empty without null-juggling.
 */
export async function getListingGuestFields(listingId: string): Promise<GuestyGuestFields> {
  const l = await guestyGet<Partial<Record<keyof GuestyGuestFields, unknown>>>(
    `/v1/listings/${listingId}`,
  );
  const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
  return {
    wifiName: str(l.wifiName),
    wifiPassword: str(l.wifiPassword),
    parkingInstructions: str(l.parkingInstructions),
    trashCollectedOn: str(l.trashCollectedOn),
  };
}

/**
 * Write a partial set of guest-facing fields to a listing.
 * PUT /v1/listings/{id} with ONLY the provided keys — Guesty merges the body,
 * so omitted fields are left untouched (never clobbered). No-op when nothing
 * is supplied. If Guesty ever rejects PUT here, guestyWrite also speaks PATCH.
 */
export async function updateListingGuestFields(
  listingId: string,
  fields: Partial<GuestyGuestFields>,
): Promise<void> {
  const body: Record<string, string> = {};
  for (const k of GUESTY_GUEST_FIELD_KEYS) {
    const v = fields[k];
    if (v != null) body[k] = String(v);
  }
  if (Object.keys(body).length === 0) return;
  await guestyWrite('PUT', `/v1/listings/${listingId}`, body);
}
