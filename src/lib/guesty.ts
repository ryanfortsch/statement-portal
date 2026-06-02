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
