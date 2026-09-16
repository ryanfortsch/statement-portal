import { supabaseAdmin } from '@/lib/supabase-admin';
import { findScaListingByGuestyId } from '@/lib/sca-listings';
import { computeAchievedRates } from '@/lib/achieved-rates';
import {
  DEFAULT_QUOTE_EXPIRY_DAYS,
  SPLIT_BALANCE_LEAD_DAYS,
  isIsoDay,
  shiftIsoDay,
  todayInEastern,
  type ScaQuoteRow,
} from '@/lib/sca-quotes-types';

/**
 * Stay Cape Ann custom quotes: the server-side data layer.
 *
 * SERVER ONLY. Reads sca_quotes with the service role (the table is
 * RLS-locked with no anon policies), resolves which Helm properties can be
 * quoted at all, and reaches staycapeann.com's PUBLIC endpoints for the
 * calendar and Guesty's own price. Nothing here touches Stripe or writes a
 * reservation: the guest's acceptance runs on staycapeann.com, and Helm only
 * records what happened (see /api/sca-quotes/[token]/events).
 *
 * The pure math, statuses and wire types live in sca-quotes-types.ts so the
 * composer (a client component) can import them without dragging the
 * service-role client into the browser bundle.
 */

// ─── The guest-facing origin ────────────────────────────────────────────────

/**
 * Apex on purpose: www.staycapeann.com 308-redirects to the apex, and a
 * redirect in a quote link is one more hop for a guest on a phone. Env
 * override exists for previews.
 */
export const SCA_PUBLIC_ORIGIN = (process.env.SCA_PUBLIC_ORIGIN || 'https://staycapeann.com').replace(/\/$/, '');

export function quoteGuestUrl(token: string): string {
  return `${SCA_PUBLIC_ORIGIN}/quote/${token}`;
}

const TOKEN_RE = /^[a-f0-9]{32}$/;

export function isQuoteToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_RE.test(token);
}

// ─── Rows ───────────────────────────────────────────────────────────────────

const QUOTE_COLUMNS = '*';

function asRow(data: unknown): ScaQuoteRow {
  const row = data as ScaQuoteRow;
  return {
    ...row,
    extra_lines: Array.isArray(row.extra_lines) ? row.extra_lines : [],
    sent_via: Array.isArray(row.sent_via) ? row.sent_via : [],
    tax_rate: Number(row.tax_rate) || 0,
  };
}

export async function listQuotes(limit = 300): Promise<ScaQuoteRow[]> {
  const { data, error } = await supabaseAdmin
    .from('sca_quotes')
    .select(QUOTE_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`sca_quotes list failed: ${error.message}`);
  return (data ?? []).map(asRow);
}

export async function getQuoteById(id: string): Promise<ScaQuoteRow | null> {
  if (!id) return null;
  const { data, error } = await supabaseAdmin.from('sca_quotes').select(QUOTE_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`sca_quotes read failed: ${error.message}`);
  return data ? asRow(data) : null;
}

/**
 * Token lookup for the bridge. The regex runs BEFORE any DB access so a
 * malformed token never reaches PostgREST and the 404 is cheap.
 */
export async function getQuoteByToken(token: string): Promise<ScaQuoteRow | null> {
  if (!isQuoteToken(token)) return null;
  const { data, error } = await supabaseAdmin.from('sca_quotes').select(QUOTE_COLUMNS).eq('token', token).maybeSingle();
  if (error) throw new Error(`sca_quotes read failed: ${error.message}`);
  return data ? asRow(data) : null;
}

// ─── Quotable properties ────────────────────────────────────────────────────

export type QuotableProperty = {
  id: string;
  name: string;
  title: string | null;
  address: string;
  city: string;
  /** '' when the property has no Guesty listing anywhere (not on Stay Cape Ann yet). */
  guesty_listing_id: string;
  is_rising_tide_owned: boolean;
  /** The resolved listing is one staycapeann.com can sell: in Helm's SCA snapshot, or launched through Helm. */
  on_sca: boolean;
};

/**
 * Active properties with their Guesty listing id resolved the same way
 * resolveGuestyListingId does (properties.guesty_listing_id, then the
 * sync-verified guesty_listings row, then what the operator typed at SCA
 * launch), but in three queries for the whole fleet instead of two per
 * property. A property with no listing anywhere comes back with an empty
 * id; the composer lists it disabled so the operator sees why it cannot
 * be quoted instead of wondering where it went.
 */
export async function listQuotableProperties(): Promise<QuotableProperty[]> {
  const [{ data: props }, { data: listings }, { data: launches }] = await Promise.all([
    supabaseAdmin
      .from('properties')
      .select('id, name, title, address, city, guesty_listing_id, is_rising_tide_owned')
      .eq('is_active', true)
      .order('name'),
    supabaseAdmin.from('guesty_listings').select('listing_id, property_id').not('listing_id', 'is', null),
    supabaseAdmin.from('sca_launches').select('property_id, guesty_listing_id, status'),
  ]);

  // A property can carry more than one synced listing (17 Beach has the
  // whole house and a retired front-unit listing). Prefer the one
  // staycapeann.com actually sells: a quote on the other one renders with
  // no pay form and would book the wrong listing. 2026-09-16.
  const syncedAll = new Map<string, string[]>();
  for (const l of (listings ?? []) as { listing_id: string | null; property_id: string | null }[]) {
    const id = l.listing_id?.trim();
    if (id && l.property_id) syncedAll.set(l.property_id, [...(syncedAll.get(l.property_id) ?? []), id]);
  }
  const synced = new Map<string, string>();
  for (const [pid, ids] of syncedAll) synced.set(pid, ids.find((id) => !!findScaListingByGuestyId(id)) ?? ids[0]);
  const launched = new Map<string, string>();
  const launchedIds = new Set<string>();
  for (const l of (launches ?? []) as { property_id: string | null; guesty_listing_id: string | null }[]) {
    const id = l.guesty_listing_id?.trim();
    if (!id) continue;
    launchedIds.add(id);
    if (l.property_id && !launched.has(l.property_id)) launched.set(l.property_id, id);
  }

  type PropRow = {
    id: string;
    name: string;
    title: string | null;
    address: string | null;
    city: string | null;
    guesty_listing_id: string | null;
    is_rising_tide_owned: boolean | null;
  };
  return ((props ?? []) as PropRow[]).map((p) => {
    const listingId = p.guesty_listing_id?.trim() || synced.get(p.id) || launched.get(p.id) || '';
    const title = p.title?.trim() || findScaListingByGuestyId(listingId)?.title || null;
    return {
      id: p.id,
      name: p.name,
      title,
      address: p.address ?? '',
      city: p.city ?? '',
      guesty_listing_id: listingId,
      is_rising_tide_owned: !!p.is_rising_tide_owned,
      on_sca: !!listingId && (!!findScaListingByGuestyId(listingId) || launchedIds.has(listingId)),
    };
  });
}

// ─── staycapeann.com public endpoints ───────────────────────────────────────

const SCA_FETCH_TIMEOUT_MS = 8_000;

export type ScaAvailabilityDay = {
  date: string;
  available: boolean;
  price?: number;
  minNights?: number;
  /**
   * Set by SCA's 2027 pre-release overlay: the day is CLOSED on the Guesty
   * calendar but comes back `available: true` so the public picker renders
   * it as request-to-book. For quoting it means "unreleased", which needs
   * the operator's override_calendar, never "open".
   */
  prerelease?: boolean;
};

export type ScaAvailabilityResult =
  | { ok: true; days: ScaAvailabilityDay[] }
  | { ok: false; error: string };

/**
 * GET /api/availability on staycapeann.com. Public, rate-limited (60/min),
 * no auth. Returns the calendar days for [checkIn, checkOut] including the
 * checkout day, which is not a night: callers filter to date < checkOut.
 */
export async function fetchScaAvailability(
  listingId: string,
  checkIn: string,
  checkOut: string,
): Promise<ScaAvailabilityResult> {
  if (!listingId || !isIsoDay(checkIn) || !isIsoDay(checkOut)) return { ok: false, error: 'bad input' };
  const qs = new URLSearchParams({ listingId, startDate: checkIn, endDate: checkOut });
  try {
    const res = await fetch(`${SCA_PUBLIC_ORIGIN}/api/availability?${qs}`, {
      signal: AbortSignal.timeout(SCA_FETCH_TIMEOUT_MS),
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    const body = (await res.json().catch(() => null)) as { days?: unknown; error?: string } | null;
    if (!res.ok) return { ok: false, error: body?.error || `availability ${res.status}` };
    const raw = Array.isArray(body?.days) ? body!.days : [];
    const days: ScaAvailabilityDay[] = [];
    for (const d of raw as Record<string, unknown>[]) {
      if (!d || !isIsoDay(d.date)) continue;
      days.push({
        date: d.date,
        available: d.available === true,
        price: typeof d.price === 'number' ? d.price : undefined,
        minNights: typeof d.minNights === 'number' ? d.minNights : undefined,
        prerelease: d.prerelease === true ? true : undefined,
      });
    }
    return { ok: true, days };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'availability fetch failed' };
  }
}

export type ScaGuestyQuote = {
  nights: number;
  subtotal: number;
  cleaningFee: number;
  extraGuestFee: number;
  taxes: number;
  total: number;
  currency: string;
  estimated?: boolean;
};

export type ScaGuestyQuoteResult =
  | { ok: true; quote: ScaGuestyQuote }
  | { ok: false; error: string; termsViolation?: { reason: string; required: number; selected: number } };

/**
 * GET /api/guesty/quote on staycapeann.com: what Guesty would charge for
 * these dates at the listing's live rates. A 400 carrying `termsViolation`
 * is the listing's min/max-nights rule, which the operator can choose to
 * override (override_terms); it is surfaced as such rather than as a
 * pricing failure.
 */
export async function fetchScaGuestyQuote(
  listingId: string,
  checkIn: string,
  checkOut: string,
  guests: number,
): Promise<ScaGuestyQuoteResult> {
  if (!listingId || !isIsoDay(checkIn) || !isIsoDay(checkOut)) return { ok: false, error: 'bad input' };
  const qs = new URLSearchParams({ listingId, checkIn, checkOut, guests: String(Math.max(1, Math.round(guests) || 1)) });
  try {
    const res = await fetch(`${SCA_PUBLIC_ORIGIN}/api/guesty/quote?${qs}`, {
      signal: AbortSignal.timeout(SCA_FETCH_TIMEOUT_MS),
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !body) {
      const tv = body?.termsViolation as { reason?: unknown; required?: unknown; selected?: unknown } | undefined;
      return {
        ok: false,
        error: (typeof body?.error === 'string' && body.error) || `quote ${res.status}`,
        termsViolation:
          tv && typeof tv.reason === 'string'
            ? { reason: tv.reason, required: Number(tv.required) || 0, selected: Number(tv.selected) || 0 }
            : undefined,
      };
    }
    const num = (k: string) => (typeof body[k] === 'number' && Number.isFinite(body[k]) ? (body[k] as number) : 0);
    return {
      ok: true,
      quote: {
        nights: num('nights'),
        subtotal: num('subtotal'),
        cleaningFee: num('cleaningFee'),
        extraGuestFee: num('extraGuestFee'),
        taxes: num('taxes'),
        total: num('total'),
        currency: typeof body.currency === 'string' && body.currency ? body.currency : 'USD',
        estimated: body.estimated === true,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'quote fetch failed' };
  }
}

// ─── Achieved reference ─────────────────────────────────────────────────────

/** "2027-07-04" -> "2026-07-04". String arithmetic on the year only. */
function shiftYear(iso: string, years: number): string {
  const y = Number(iso.slice(0, 4)) + years;
  return `${String(y).padStart(4, '0')}${iso.slice(4)}`;
}

/**
 * What this property actually transacted per night for the same window a
 * year earlier. Null when fewer than three nights are on file: two nights
 * of one odd stay is a rumor, not a rate.
 */
export async function achievedNightlyLastYear(
  propertyId: string,
  checkIn: string,
  checkOut: string,
): Promise<{ nightly: number; sample_nights: number } | null> {
  if (!propertyId || !isIsoDay(checkIn) || !isIsoDay(checkOut)) return null;
  try {
    const r = await computeAchievedRates(propertyId, shiftYear(checkIn, -1), shiftYear(checkOut, -1));
    if (r.aggregate.nights < 3 || r.aggregate.nightly <= 0) return null;
    return { nightly: r.aggregate.nightly, sample_nights: r.aggregate.nights };
  } catch (err) {
    console.warn('[sca-quotes] achieved rates lookup failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ─── Defaults ───────────────────────────────────────────────────────────────

export function defaultExpiresAt(now: Date = new Date()): string {
  return new Date(now.getTime() + DEFAULT_QUOTE_EXPIRY_DAYS * 86_400_000).toISOString();
}

/** Balance due date for a split plan: 60 days before check-in. */
export function balanceDueDefault(checkIn: string): string {
  return shiftIsoDay(checkIn, -SPLIT_BALANCE_LEAD_DAYS);
}

/**
 * A split plan only makes sense when the balance date is still ahead of
 * us; inside the 60-day window the whole amount is due at acceptance.
 */
export function splitAllowed(checkIn: string): boolean {
  if (!isIsoDay(checkIn)) return false;
  return balanceDueDefault(checkIn) > todayInEastern();
}
