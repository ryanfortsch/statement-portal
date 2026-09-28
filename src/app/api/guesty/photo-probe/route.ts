import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { getGuestyToken } from '@/lib/guesty';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * READ-ONLY diagnostic for the photo-caption write.
 *
 * The caption tool's self-verify reported the same thing on every photo of
 * 19 Rackliffe (2026-09-27): "Guesty accepted the update but the caption did
 * not appear on the listing." Guesty's docs say the edit endpoint is
 *
 *   POST /v1/properties-api/property-photos/property-photos/{propertyId}/{photoId}
 *
 * and that {propertyId} is a Guesty PROPERTY id. Helm has been passing the
 * LISTING id, on an assumption `guesty.ts` flagged in a comment but nobody
 * ever checked. A 201 against a property-photos record that isn't the one
 * backing this listing's `pictures` array looks exactly like what we saw.
 *
 * This route answers the question with live data and writes NOTHING:
 *   - which id-ish fields the listing object actually carries
 *   - what the property-photos GET returns for the listing id
 *   - what it returns for each candidate property id found on the listing
 *   - whether those photo _ids match the ones in `pictures`
 *
 * GET /api/guesty/photo-probe?propertyId=19_rackliffe
 * Session-gated by src/proxy.ts like every other /api route; the extra
 * auth() check below keeps it honest if the allowlist ever changes.
 */

const GUESTY_API = 'https://open-api.guesty.com';

type Probe = { path: string; status: number; note: string; sample?: unknown };

async function rawGet(path: string): Promise<Probe> {
  const token = await getGuestyToken();
  const res = await fetch(`${GUESTY_API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep the raw text */
  }
  if (!res.ok) {
    return { path, status: res.status, note: 'error', sample: String(text).slice(0, 400) };
  }
  const arr = Array.isArray(body)
    ? body
    : Array.isArray((body as { results?: unknown[] })?.results)
      ? (body as { results: unknown[] }).results
      : null;
  if (arr) {
    return {
      path,
      status: res.status,
      note: `array of ${arr.length}`,
      sample: arr.slice(0, 3).map((p) => {
        const o = p as Record<string, unknown>;
        return { _id: o._id, caption: o.caption, index: o.index, original: String(o.original ?? '').slice(0, 80) };
      }),
    };
  }
  return { path, status: res.status, note: 'object', sample: Object.keys(body as object).slice(0, 60) };
}

async function resolveListingId(propertyId: string): Promise<string> {
  const { data: prop } = await supabase
    .from('properties')
    .select('guesty_listing_id')
    .eq('id', propertyId)
    .maybeSingle();
  const direct = (prop as { guesty_listing_id: string | null } | null)?.guesty_listing_id?.trim();
  if (direct) return direct;
  const { data: gl } = await supabase
    .from('guesty_listings')
    .select('listing_id')
    .eq('property_id', propertyId)
    .not('listing_id', 'is', null)
    .limit(1);
  const synced = (gl?.[0] as { listing_id: string | null } | undefined)?.listing_id?.trim();
  if (synced) return synced;
  const { data: sca } = await supabase
    .from('sca_launches')
    .select('guesty_listing_id')
    .eq('property_id', propertyId)
    .maybeSingle();
  return (sca as { guesty_listing_id: string | null } | null)?.guesty_listing_id?.trim() || '';
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const propertyId = request.nextUrl.searchParams.get('propertyId') || '';
  if (!propertyId) return NextResponse.json({ error: 'Pass ?propertyId=<helm property id>' }, { status: 400 });

  const listingId = await resolveListingId(propertyId);
  if (!listingId) return NextResponse.json({ error: 'No Guesty listing id for that property' }, { status: 404 });

  const out: Record<string, unknown> = { propertyId, listingId };

  // 1. the listing object: which fields could carry a property id?
  let listing: Record<string, unknown> = {};
  try {
    const token = await getGuestyToken();
    const res = await fetch(`${GUESTY_API}/v1/listings/${listingId}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    listing = (await res.json()) as Record<string, unknown>;
    out.listingStatus = res.status;
  } catch (err) {
    out.listingError = err instanceof Error ? err.message : String(err);
  }

  const idish: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(listing)) {
    const looksIdish = /id$|^_id$|propert|complex|unit/i.test(k);
    if (!looksIdish) continue;
    idish[k] = typeof v === 'object' && v !== null ? JSON.stringify(v).slice(0, 200) : v;
  }
  out.listingIdFields = idish;
  out.listingTopLevelKeys = Object.keys(listing).sort();

  const pics = Array.isArray(listing.pictures) ? (listing.pictures as Record<string, unknown>[]) : [];
  out.picturesCount = pics.length;
  out.picturesSample = pics.slice(0, 3).map((p) => ({
    _id: p._id,
    caption: p.caption,
    index: p.index,
    original: String(p.original ?? '').slice(0, 80),
  }));

  // 2. property-photos under every id worth trying.
  const candidates = new Set<string>([listingId]);
  for (const key of ['propertyId', 'property_id', 'propertyID']) {
    const v = listing[key];
    if (typeof v === 'string' && v.trim()) candidates.add(v.trim());
  }
  const propObj = listing.property as Record<string, unknown> | undefined;
  if (propObj && typeof propObj._id === 'string') candidates.add(propObj._id);

  const probes: Probe[] = [];
  for (const id of candidates) {
    try {
      probes.push(await rawGet(`/v1/properties-api/property-photos/property-photos/${id}`));
    } catch (err) {
      probes.push({ path: `property-photos/${id}`, status: 0, note: 'threw', sample: String(err) });
    }
  }
  // 3. is there a properties list that maps to this listing at all?
  try {
    probes.push(await rawGet('/v1/properties-api/properties?limit=5'));
  } catch (err) {
    probes.push({ path: 'properties list', status: 0, note: 'threw', sample: String(err) });
  }
  out.probes = probes;

  return NextResponse.json(out, { status: 200 });
}
