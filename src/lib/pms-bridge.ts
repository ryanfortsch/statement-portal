/**
 * The PMS bridge: the shared handlers behind /api/pms/*, which is what
 * staycapeann.com and stay-concierge call for a home whose
 * properties.calendar_authority is 'helm' instead of Guesty's
 * /availability, /quotes and /reservations-v3.
 *
 * Four jobs:
 *   - input validation and the one scope gate every route shares: a
 *     Guesty-run property answers 409 calendar_authority_guesty, never a
 *     Helm price or a Helm hold;
 *   - stateless signed quote ids. A quote is 'hq_' + base64url(payload) +
 *     '.' + base64url(hmac-sha256), good for 30 minutes, signed with
 *     AUTH_SECRET. Nothing is stored: the payload carries the stay and the
 *     total, and the create path re-prices and refuses on drift;
 *   - reservation create / cancel / confirm / read-back over step 4's
 *     locked writer (createBooking runs helm_create_booking under the
 *     property advisory lock), the guest record, the direct finance writer,
 *     the automations planner and the Helm calendar mirror;
 *   - the ReservationPick list the concierge stay picker reads.
 *
 * Pricing is never re-implemented here: quoteStay (rate-plan.ts) builds the
 * inputs and computeQuoteMoney (sca-quotes-types.ts) does the arithmetic.
 * Availability is availability.ts. Money in the wire shapes is integer
 * cents except where the SCA QuoteResult contract wants dollars.
 *
 * No 'server-only' marker and relative imports on purpose, like
 * property-rates.ts: node:test loads this file for signQuote / verifyQuote
 * (src/lib/__tests__/pms-bridge.test.ts). The modules that DO carry the
 * marker (bookings-write, guests-identity, booking-finance-write,
 * automations) are imported lazily inside the functions that need them, the
 * same way field-notify.ts and guest-locks.ts defer theirs, so loading this
 * module never loads them. This file is only ever imported from routes.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { supabaseAdmin, isServiceConfigured } from './supabase-admin.ts';
import { selectAllPaged } from './paged-select.ts';
import { isIsoDay, nightsBetween, shiftIsoDay, todayInEastern } from './sca-quotes-types.ts';
import {
  quoteStay,
  resolveTaxRate,
  stayNights,
  TaxJurisdictionUnknownError,
  type QuoteChannel,
  type RatePlanRow,
  type StayQuote,
  type StayViolation,
  type TaxConfigRow,
} from './rate-plan.ts';
import { loadPricingBundle, type PricingBundle } from './property-rates.ts';
import { buildAvailability, checkRange, nightHolds, type AvailabilityBooking, type HelmAvailabilityDay, type RangeCheck } from './availability.ts';
import { isOpenOn } from './rental-periods.ts';
import { getListingRecord, toScaListing, type ScaListing } from './listing-content.ts';
import { channelLabel, helmConversationId, HELM_SMS_MODULE } from './helm-inbox-core.ts';
import { toE164Phone } from './guests-identity-core.ts';
import { isHelmCode, type BookingConflict } from './bookings-write-core.ts';
import type { BookingFinance } from './channels-types.ts';
import type { BookingEx } from './channels.ts';
import type { ReservationPick } from './stay-concierge.ts';

// ── Signed quote ids ────────────────────────────────────────────────────────

export const QUOTE_ID_PREFIX = 'hq_';
/** A quote is honoured for thirty minutes, then the guest prices again. */
export const QUOTE_TTL_SECONDS = 30 * 60;

export type QuotePayload = {
  v: 1;
  property_id: string;
  check_in: string;
  check_out: string;
  guests: number;
  channel: string;
  total_cents: number;
  currency: string;
  /** Epoch seconds. */
  iat: number;
  exp: number;
};

export type QuotePayloadInput = Omit<QuotePayload, 'v' | 'iat' | 'exp'>;

const B64URL_RE = /^[A-Za-z0-9_-]+$/;

function hmacB64url(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

/**
 * 'hq_' + base64url(json) + '.' + base64url(hmac-sha256(base64url(json))).
 * The body is what is signed, byte for byte, so a verifier never has to
 * re-serialize JSON to check the signature.
 */
export function signQuote(payload: QuotePayloadInput, secret: string, now: Date = new Date()): string {
  if (!secret) throw new Error('signQuote: a signing secret is required');
  const iat = Math.floor(now.getTime() / 1000);
  const full: QuotePayload = { v: 1, ...payload, iat, exp: iat + QUOTE_TTL_SECONDS };
  const body = Buffer.from(JSON.stringify(full), 'utf8').toString('base64url');
  return `${QUOTE_ID_PREFIX}${body}.${hmacB64url(body, secret)}`;
}

export type VerifyQuoteResult =
  | { ok: true; payload: QuotePayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

/** Shape check only; verifyQuote decides whether it is genuine. */
export function isQuoteId(s: unknown): s is string {
  if (typeof s !== 'string' || !s.startsWith(QUOTE_ID_PREFIX)) return false;
  const rest = s.slice(QUOTE_ID_PREFIX.length);
  const dot = rest.lastIndexOf('.');
  if (dot <= 0 || dot === rest.length - 1) return false;
  return B64URL_RE.test(rest.slice(0, dot)) && B64URL_RE.test(rest.slice(dot + 1));
}

function isPayload(v: unknown): v is QuotePayload {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return (
    p.v === 1 &&
    typeof p.property_id === 'string' &&
    isIsoDay(p.check_in) &&
    isIsoDay(p.check_out) &&
    typeof p.guests === 'number' &&
    typeof p.channel === 'string' &&
    typeof p.total_cents === 'number' &&
    typeof p.currency === 'string' &&
    typeof p.iat === 'number' &&
    typeof p.exp === 'number'
  );
}

/**
 * Signature first (constant time), then shape, then expiry. A quote whose
 * exp has passed is 'expired' rather than 'malformed' so the route can
 * answer 410 and the site can re-quote instead of showing an error.
 */
export function verifyQuote(id: string, secret: string, now: Date = new Date()): VerifyQuoteResult {
  if (!secret || !isQuoteId(id)) return { ok: false, reason: 'malformed' };
  const rest = id.slice(QUOTE_ID_PREFIX.length);
  const dot = rest.lastIndexOf('.');
  const body = rest.slice(0, dot);
  const sig = rest.slice(dot + 1);
  const expected = hmacB64url(body, secret);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!isPayload(parsed)) return { ok: false, reason: 'malformed' };
  if (Math.floor(now.getTime() / 1000) >= parsed.exp) return { ok: false, reason: 'expired' };
  return { ok: true, payload: parsed };
}

/** The signing secret. Fails closed: no AUTH_SECRET, no quote ids. */
export function quoteSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not set; Helm quote ids cannot be signed or verified');
  return s;
}

// ── Failures and their HTTP statuses ────────────────────────────────────────

export type BridgeFailure =
  | { ok: false; error: 'invalid'; detail: string }
  | { ok: false; error: 'not_configured' }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'calendar_authority_guesty'; property_id: string }
  | { ok: false; error: 'no_rate_plan'; property_id: string }
  | { ok: false; error: 'tax_jurisdiction_unknown'; property_id: string }
  | { ok: false; error: 'terms'; violations: StayViolation[] }
  | { ok: false; error: 'unavailable'; blockedNights: string[]; reservedNights: string[] }
  | { ok: false; error: 'quote_expired' }
  | { ok: false; error: 'quote_invalid'; detail: string }
  | { ok: false; error: 'quote_drift'; quoted_total_cents: number; current_total_cents: number }
  | { ok: false; error: 'booking_overlap'; conflict: BookingConflict };

export type BridgeErrorCode = BridgeFailure['error'];

const STATUS_BY_ERROR: Record<BridgeErrorCode, number> = {
  invalid: 400,
  quote_invalid: 400,
  not_found: 404,
  calendar_authority_guesty: 409,
  no_rate_plan: 409,
  tax_jurisdiction_unknown: 409,
  unavailable: 409,
  quote_drift: 409,
  booking_overlap: 409,
  quote_expired: 410,
  terms: 422,
  not_configured: 503,
};

/** The HTTP status a route answers for a failure. */
export function bridgeStatus(error: BridgeErrorCode): number {
  return STATUS_BY_ERROR[error] ?? 400;
}

const fail = <T extends BridgeFailure>(f: T): T => f;

// ── Property scope ──────────────────────────────────────────────────────────

export type BridgeProperty = {
  id: string;
  name: string;
  title: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  calendar_authority: 'guesty' | 'helm';
  timezone: string;
  is_active: boolean;
  kind: string;
  ical_export_token: string | null;
  latitude: number | null;
  longitude: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
};

const PROPERTY_COLS =
  'id, name, title, address, city, region, calendar_authority, timezone, is_active, kind, ical_export_token, latitude, longitude, bedrooms, bathrooms';

const numOrNull = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

function shapeProperty(raw: Record<string, unknown>): BridgeProperty {
  return {
    id: String(raw.id),
    name: String(raw.name ?? raw.id),
    title: (raw.title as string | null | undefined) ?? null,
    address: (raw.address as string | null | undefined) ?? null,
    city: (raw.city as string | null | undefined) ?? null,
    region: (raw.region as string | null | undefined) ?? null,
    calendar_authority: raw.calendar_authority === 'helm' ? 'helm' : 'guesty',
    timezone: String(raw.timezone ?? 'America/New_York'),
    is_active: raw.is_active !== false,
    kind: String(raw.kind ?? 'managed'),
    ical_export_token: (raw.ical_export_token as string | null | undefined) ?? null,
    latitude: numOrNull(raw.latitude),
    longitude: numOrNull(raw.longitude),
    bedrooms: numOrNull(raw.bedrooms),
    bathrooms: numOrNull(raw.bathrooms),
  };
}

export async function getBridgeProperty(propertyId: string): Promise<BridgeProperty | null> {
  if (!isServiceConfigured || !propertyId) return null;
  const { data, error } = await supabaseAdmin.from('properties').select(PROPERTY_COLS).eq('id', propertyId).maybeSingle();
  if (error || !data) return null;
  return shapeProperty(data as Record<string, unknown>);
}

/** Active managed homes, Helm-run by default; 'all' widens to the whole fleet. */
export async function listBridgeProperties(authority: 'helm' | 'all' = 'helm'): Promise<BridgeProperty[]> {
  if (!isServiceConfigured) return [];
  const rows = await selectAllPaged<Record<string, unknown>>(
    (from, to) => {
      let q = supabaseAdmin
        .from('properties')
        .select(PROPERTY_COLS)
        .eq('is_active', true)
        .eq('kind', 'managed')
        .order('id', { ascending: true })
        .range(from, to);
      if (authority === 'helm') q = q.eq('calendar_authority', 'helm');
      return q;
    },
    { label: 'pms bridge fleet' },
  );
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  return rows.map(shapeProperty).sort((a, b) => collator.compare(a.name, b.name));
}

/** The one scope gate: a property Helm does not run is never priced or held here. */
async function scopedProperty(propertyId: string): Promise<BridgeProperty | BridgeFailure> {
  if (!isServiceConfigured) return fail({ ok: false, error: 'not_configured' });
  const property = await getBridgeProperty(propertyId);
  if (!property) return fail({ ok: false, error: 'not_found' });
  if (property.calendar_authority !== 'helm') return fail({ ok: false, error: 'calendar_authority_guesty', property_id: property.id });
  return property;
}

function isFailure(v: unknown): v is BridgeFailure {
  return !!v && typeof v === 'object' && (v as { ok?: unknown }).ok === false && typeof (v as { error?: unknown }).error === 'string';
}

// ── Holds ───────────────────────────────────────────────────────────────────

const HOLD_STATUSES = ['confirmed', 'completed', 'block'];

/** Canonical holds touching [start, endExclusive). */
async function holdsInWindow(propertyId: string, start: string, endExclusive: string): Promise<AvailabilityBooking[]> {
  return selectAllPaged<AvailabilityBooking>(
    (from, to) =>
      supabaseAdmin
        .from('bookings')
        .select('status, check_in, check_out, duplicate_of')
        .eq('property_id', propertyId)
        .is('duplicate_of', null)
        .in('status', HOLD_STATUSES)
        .lt('check_in', endExclusive)
        .gt('check_out', start)
        .order('check_in', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    { label: `pms holds ${propertyId}` },
  );
}

// ── Availability ────────────────────────────────────────────────────────────

/** The GET /api/availability window cap on staycapeann.com's side. */
export const MAX_AVAILABILITY_DAYS = 400;

export type BridgeAvailability = {
  ok: true;
  property: BridgeProperty;
  plan: RatePlanRow | null;
  days: HelmAvailabilityDay[];
};

function validDates(checkIn: unknown, checkOut: unknown): string | null {
  if (!isIsoDay(checkIn) || !isIsoDay(checkOut)) return 'dates must be YYYY-MM-DD';
  if (Number.isNaN(Date.parse(`${checkIn}T00:00:00Z`)) || Number.isNaN(Date.parse(`${checkOut}T00:00:00Z`))) return 'dates must be real calendar days';
  return null;
}

/**
 * One AvailabilityDay per date in the inclusive [start, end] window, priced
 * from the Helm rate plan. A home with no plan yet answers holds only.
 */
export async function availabilityForBridge(
  propertyId: string,
  start: string,
  end: string,
  opts: { now?: Date } = {},
): Promise<BridgeAvailability | BridgeFailure> {
  const bad = validDates(start, end);
  if (bad) return fail({ ok: false, error: 'invalid', detail: bad });
  if (end < start) return fail({ ok: false, error: 'invalid', detail: 'end is before start' });
  if (nightsBetween(start, end) + 1 > MAX_AVAILABILITY_DAYS) {
    return fail({ ok: false, error: 'invalid', detail: `window exceeds ${MAX_AVAILABILITY_DAYS} days` });
  }
  const property = await scopedProperty(propertyId);
  if (isFailure(property)) return property;

  const now = opts.now ?? new Date();
  const [bundle, holds] = await Promise.all([loadPricingBundle(property.id, start, end), holdsInWindow(property.id, start, shiftIsoDay(end, 1))]);
  const days = buildAvailability({
    bookings: holds,
    plan: bundle.plan,
    rateDays: bundle.days,
    rentalPeriods: bundle.periods,
    start,
    end,
    now,
    timeZone: property.timezone,
  });
  return { ok: true, property, plan: bundle.plan, days };
}

export type BridgeRangeCheck = { ok: true; property: BridgeProperty; days: HelmAvailabilityDay[] } & RangeCheck;

/** POST /api/availability: is [checkIn, checkOut) bookable, checkout day excluded. */
export async function rangeCheckForBridge(
  propertyId: string,
  checkIn: string,
  checkOut: string,
  opts: { now?: Date } = {},
): Promise<BridgeRangeCheck | BridgeFailure> {
  const bad = validDates(checkIn, checkOut);
  if (bad) return fail({ ok: false, error: 'invalid', detail: bad });
  if (checkOut <= checkIn) return fail({ ok: false, error: 'invalid', detail: 'check_out must be after check_in' });
  const r = await availabilityForBridge(propertyId, checkIn, shiftIsoDay(checkOut, -1), opts);
  if (isFailure(r)) return r;
  const range = checkRange(r.days, checkIn, checkOut);
  return { ok: true, property: r.property, days: r.days, ...range };
}

// ── Pricing ─────────────────────────────────────────────────────────────────

export type BridgeChannel = 'direct' | 'sca' | 'concierge';

const BRIDGE_CHANNELS: ReadonlySet<string> = new Set(['direct', 'sca', 'concierge']);

/**
 * The rate plan's channel vocabulary for a bridge caller. 'concierge' books
 * are direct stays priced exactly like the site, so they carry the direct
 * markup too; the tax config's collected_by_channels never names them.
 */
export function ratePlanChannelFor(channel: string | null | undefined): QuoteChannel {
  const c = String(channel ?? 'sca').toLowerCase();
  return c === 'concierge' ? 'direct' : c === 'sca' ? 'sca' : 'direct';
}

type PricedStay = {
  property: BridgeProperty;
  bundle: PricingBundle & { plan: RatePlanRow };
  quote: StayQuote;
  holds: AvailabilityBooking[];
  days: HelmAvailabilityDay[];
  range: RangeCheck;
};

async function priceStay(args: {
  propertyId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  channel: string;
  now: Date;
}): Promise<PricedStay | BridgeFailure> {
  const bad = validDates(args.checkIn, args.checkOut);
  if (bad) return fail({ ok: false, error: 'invalid', detail: bad });
  if (args.checkOut <= args.checkIn) return fail({ ok: false, error: 'invalid', detail: 'check_out must be after check_in' });
  const guests = Math.round(Number(args.guests));
  if (!Number.isFinite(guests) || guests < 1) return fail({ ok: false, error: 'invalid', detail: 'guests must be at least 1' });
  if (!BRIDGE_CHANNELS.has(String(args.channel).toLowerCase())) {
    return fail({ ok: false, error: 'invalid', detail: "channel must be 'direct', 'sca' or 'concierge'" });
  }

  const property = await scopedProperty(args.propertyId);
  if (isFailure(property)) return property;

  const lastNight = shiftIsoDay(args.checkOut, -1);
  const [bundle, holds] = await Promise.all([
    loadPricingBundle(property.id, args.checkIn, lastNight),
    holdsInWindow(property.id, args.checkIn, args.checkOut),
  ]);
  if (!bundle.plan) return fail({ ok: false, error: 'no_rate_plan', property_id: property.id });

  let quote: StayQuote;
  try {
    quote = quoteStay({
      plan: bundle.plan,
      days: bundle.days,
      tax: bundle.tax,
      checkIn: args.checkIn,
      checkOut: args.checkOut,
      guests,
      channel: ratePlanChannelFor(args.channel),
      now: args.now,
      region: property.region,
      propertyId: property.id,
      timeZone: property.timezone,
    });
  } catch (err) {
    if (err instanceof TaxJurisdictionUnknownError) return fail({ ok: false, error: 'tax_jurisdiction_unknown', property_id: property.id });
    throw err;
  }

  const days = buildAvailability({
    bookings: holds,
    plan: bundle.plan,
    rateDays: bundle.days,
    rentalPeriods: bundle.periods,
    start: args.checkIn,
    end: lastNight,
    now: args.now,
    timeZone: property.timezone,
  });
  const range = checkRange(days, args.checkIn, args.checkOut);
  return { property, bundle: { ...bundle, plan: bundle.plan }, quote, holds, days, range };
}

/**
 * Nights nothing can sell regardless of the clock: a stay or block holds
 * them, the rate day is closed, or the season is shut. Unlike checkRange
 * this ignores advance notice and the booking window, which is what a
 * create call thirty minutes after its quote needs.
 */
function hardBlockedNights(p: PricedStay, checkIn: string, checkOut: string): { blocked: string[]; reserved: string[] } {
  const { reserved, blocked } = nightHolds(p.holds);
  const out: string[] = [];
  const res: string[] = [];
  for (const night of stayNights(checkIn, checkOut)) {
    const held = reserved.has(night);
    if (held) res.push(night);
    if (held || blocked.has(night) || !!p.bundle.days.get(night)?.closed || !isOpenOn(p.bundle.periods, night)) out.push(night);
  }
  return { blocked: out, reserved: res };
}

// ── Quote ───────────────────────────────────────────────────────────────────

export type BridgeQuoteBreakdown = {
  nightly: StayQuote['nightly'];
  accommodation_cents: number;
  extra_guest_cents: number;
  cleaning_cents: number;
  discount_cents: number;
  discount_label: string | null;
  markup_cents: number;
  taxable_base_cents: number;
  tax_rate: number;
  tax_exempt: boolean;
  tax_cents: number;
  subtotal_cents: number;
  total_cents: number;
};

/**
 * staycapeann.com's QuoteResult (lib/types.ts) in dollars, plus the cents
 * breakdown. subtotal is accommodation after the length-of-stay discount
 * and the direct markup, so subtotal + cleaningFee + extraGuestFee + taxes
 * equals total, the identity the site's summary renders.
 */
export type BridgeQuote = {
  nights: number;
  subtotal: number;
  cleaningFee: number;
  extraGuestFee: number;
  taxes: number;
  total: number;
  currency: string;
  quoteId: string;
  ratePlanId: 'helm';
  breakdown: BridgeQuoteBreakdown;
  violations: StayViolation[];
};

export type BridgeQuoteResult = { ok: true; quote: BridgeQuote; property: BridgeProperty } | BridgeFailure;

const dollars = (cents: number): number => Math.round(cents) / 100;

function breakdownOf(q: StayQuote): BridgeQuoteBreakdown {
  return {
    nightly: q.nightly,
    accommodation_cents: q.accommodation_cents,
    extra_guest_cents: q.extra_guest_cents,
    cleaning_cents: q.cleaning_cents,
    discount_cents: q.discount_cents,
    discount_label: q.discount_label,
    markup_cents: q.markup_cents,
    taxable_base_cents: q.taxable_base_cents,
    tax_rate: q.tax_rate,
    tax_exempt: q.tax_exempt,
    tax_cents: q.tax_cents,
    subtotal_cents: q.subtotal_cents,
    total_cents: q.total_cents,
  };
}

/**
 * Price a stay on a Helm-run home and sign a quote id. Terms violations
 * come back as 'terms' (422), a night that cannot be sold as 'unavailable'
 * (409), a home with no known tax jurisdiction as 'tax_jurisdiction_unknown'.
 */
export async function quoteForBridge(
  propertyId: string,
  checkIn: string,
  checkOut: string,
  guests: number,
  channel: string = 'sca',
  opts: { now?: Date; secret?: string } = {},
): Promise<BridgeQuoteResult> {
  const now = opts.now ?? new Date();
  const priced = await priceStay({ propertyId, checkIn, checkOut, guests, channel, now });
  if (isFailure(priced)) return priced;
  const { quote: q, property } = priced;

  if (q.violations.length > 0) return fail({ ok: false, error: 'terms', violations: q.violations });
  if (!priced.range.available) {
    return fail({ ok: false, error: 'unavailable', blockedNights: priced.range.unavailableDates, reservedNights: priced.range.reservedDates });
  }

  const quoteId = signQuote(
    {
      property_id: property.id,
      check_in: checkIn,
      check_out: checkOut,
      guests: Math.round(Number(guests)),
      channel: String(channel).toLowerCase(),
      total_cents: q.total_cents,
      currency: q.currency,
    },
    opts.secret ?? quoteSecret(),
    now,
  );

  return {
    ok: true,
    property,
    quote: {
      nights: q.nights,
      subtotal: dollars(q.accommodation_cents - q.discount_cents + q.markup_cents),
      cleaningFee: dollars(q.cleaning_cents),
      extraGuestFee: dollars(q.extra_guest_cents),
      taxes: dollars(q.tax_cents),
      total: dollars(q.total_cents),
      currency: q.currency,
      quoteId,
      ratePlanId: 'helm',
      breakdown: breakdownOf(q),
      violations: [],
    },
  };
}

// ── Reservations ────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A booking by its id or its HELM- confirmation code. */
export async function resolveReservation(idOrCode: string): Promise<BookingEx | null> {
  if (!isServiceConfigured || !idOrCode) return null;
  const key = idOrCode.trim();
  let q = supabaseAdmin.from('bookings').select('*');
  if (isHelmCode(key)) q = q.eq('external_confirmation_code', key.toUpperCase());
  else if (UUID_RE.test(key)) q = q.eq('id', key);
  else return null;
  const { data, error } = await q.order('created_at', { ascending: true }).limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0] as BookingEx;
}

async function findBySourceRef(sourceRef: string): Promise<BookingEx | null> {
  const { data, error } = await supabaseAdmin
    .from('bookings')
    .select('*')
    .eq('source_ref', sourceRef)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0] as BookingEx;
}

export type BridgeGuest = {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type BridgeMoney = {
  gross_cents: number;
  cleaning_cents?: number | null;
  taxes_cents?: number | null;
  stripe_fee_cents?: number | null;
  payout_cents?: number | null;
  stripe_payment_intent_id?: string | null;
  stripe_account_key?: string | null;
};

export type BridgeSource = 'sca' | 'concierge' | 'operator';

export type CreateReservationInput = {
  quote_id?: string | null;
  property_id: string;
  check_in: string;
  check_out: string;
  guests: number;
  guest: BridgeGuest;
  money?: BridgeMoney | null;
  source: BridgeSource;
  /** Idempotency key: the SCA token, the Stripe payment intent, the concierge request id. */
  source_ref: string;
  notes?: string | null;
  /** Who did it, for booking_events; defaults to the source. */
  actor?: string | null;
};

export type CreateReservationResult =
  | { ok: true; created: boolean; reservation: BookingEx; confirmationCode: string; total_cents: number | null }
  | BridgeFailure;

const isMoneyNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function validateCreateInput(input: CreateReservationInput): string | null {
  if (!input || typeof input !== 'object') return 'body must be an object';
  if (typeof input.property_id !== 'string' || !input.property_id.trim()) return 'property_id is required';
  const bad = validDates(input.check_in, input.check_out);
  if (bad) return bad;
  if (input.check_out <= input.check_in) return 'check_out must be after check_in';
  const guests = Number(input.guests);
  if (!Number.isFinite(guests) || guests < 1) return 'guests must be at least 1';
  if (!input.guest || typeof input.guest !== 'object') return 'guest is required';
  const name = fullNameOf(input.guest);
  if (!name && !input.guest.email && !input.guest.phone) return 'guest needs a name, an email or a phone';
  if (input.source !== 'sca' && input.source !== 'concierge' && input.source !== 'operator') return "source must be 'sca', 'concierge' or 'operator'";
  if (typeof input.source_ref !== 'string' || !input.source_ref.trim()) return 'source_ref is required';
  if (input.quote_id != null && !isQuoteId(input.quote_id)) return 'quote_id is not a Helm quote id';
  if (input.money != null) {
    if (typeof input.money !== 'object') return 'money must be an object';
    if (!isMoneyNum(input.money.gross_cents)) return 'money.gross_cents must be a non-negative number';
    for (const k of ['cleaning_cents', 'taxes_cents', 'stripe_fee_cents', 'payout_cents'] as const) {
      const v = input.money[k];
      if (v != null && !isMoneyNum(v)) return `money.${k} must be a non-negative number`;
    }
  }
  return null;
}

function fullNameOf(g: BridgeGuest): string {
  return [g.first_name, g.last_name].map((s) => (s ?? '').trim()).filter(Boolean).join(' ');
}

const centsToDollarsOrNull = (v: number | null | undefined): number | null => (v == null ? null : Math.round(v) / 100);

/**
 * Create a confirmed direct booking for a Helm-run home.
 *
 *   1. idempotent on bookings.source_ref: the same key returns the row it
 *      made before with created: false and never a second hold;
 *   2. a quote_id is verified (410 expired, 400 tampered or for another
 *      stay), then the stay is re-priced and a changed total is
 *      'quote_drift' rather than a silently different charge;
 *   3. the nights are checked for hard holds (closed / season / stay /
 *      block); the RPC then re-checks stays and blocks under the property
 *      lock, so two racing creates can never both win;
 *   4. createBooking (the locked writer) writes the row, mints the HELM-
 *      code, links the guest and refreshes the mirror. The guest is then
 *      re-linked with the structured name, the direct finance row is
 *      written, and the automations planner runs for the property, each
 *      inside its own try/catch so a side effect never undoes a booking
 *      that is already committed.
 */
export async function createReservationFromBridge(
  input: CreateReservationInput,
  opts: { now?: Date; secret?: string } = {},
): Promise<CreateReservationResult> {
  if (!isServiceConfigured) return fail({ ok: false, error: 'not_configured' });
  const bad = validateCreateInput(input);
  if (bad) return fail({ ok: false, error: 'invalid', detail: bad });
  const now = opts.now ?? new Date();
  const sourceRef = input.source_ref.trim();
  const guests = Math.round(Number(input.guests));

  // 1. Idempotency.
  const existing = await findBySourceRef(sourceRef);
  if (existing) {
    return {
      ok: true,
      created: false,
      reservation: existing,
      confirmationCode: existing.external_confirmation_code ?? '',
      total_cents: existing.gross_amount == null ? null : Math.round(Number(existing.gross_amount) * 100),
    };
  }

  // 2. Quote and re-price. The channel a quote was priced on is the one the
  //    booking is priced on again; without a quote the source decides.
  let payload: QuotePayload | null = null;
  if (input.quote_id) {
    const v = verifyQuote(input.quote_id, opts.secret ?? quoteSecret(), now);
    if (!v.ok) {
      if (v.reason === 'expired') return fail({ ok: false, error: 'quote_expired' });
      return fail({ ok: false, error: 'quote_invalid', detail: v.reason === 'bad_signature' ? 'signature does not verify' : 'quote id is malformed' });
    }
    payload = v.payload;
    if (
      payload.property_id !== input.property_id ||
      payload.check_in !== input.check_in ||
      payload.check_out !== input.check_out ||
      payload.guests !== guests
    ) {
      return fail({ ok: false, error: 'quote_invalid', detail: 'quote was priced for a different stay' });
    }
  }
  const channel = payload?.channel ?? (input.source === 'sca' ? 'sca' : input.source === 'concierge' ? 'concierge' : 'direct');

  const priced = await priceStay({ propertyId: input.property_id, checkIn: input.check_in, checkOut: input.check_out, guests, channel, now });
  if (isFailure(priced)) return priced;

  if (payload && payload.total_cents !== priced.quote.total_cents) {
    return fail({ ok: false, error: 'quote_drift', quoted_total_cents: payload.total_cents, current_total_cents: priced.quote.total_cents });
  }

  // 3. Hard holds. Advance notice and the booking window were the quote's
  //    business; an operator or a paid guest is never refused on the clock.
  const hard = hardBlockedNights(priced, input.check_in, input.check_out);
  if (hard.blocked.length > 0) return fail({ ok: false, error: 'unavailable', blockedNights: hard.blocked, reservedNights: hard.reserved });

  // Money on the row: what was paid when the caller knows, else the quote.
  const money = input.money ?? null;
  const q = priced.quote;
  const grossCents = money ? Math.round(money.gross_cents) : q.total_cents;
  const cleaningCents = money ? (money.cleaning_cents ?? q.cleaning_cents) : q.cleaning_cents;
  const taxesCents = money ? (money.taxes_cents ?? q.tax_cents) : q.tax_cents;
  const actor = (input.actor ?? '').trim() || input.source;
  const guestName = fullNameOf(input.guest) || null;

  // 4. The locked writer.
  const { createBooking, isBookingOverlapError } = await import('./bookings-write.ts');
  let row: BookingEx;
  try {
    row = (await createBooking({
      propertyId: priced.property.id,
      channel: 'direct',
      source: 'direct_booking',
      status: 'confirmed',
      checkIn: input.check_in,
      checkOut: input.check_out,
      guestName,
      guestEmail: input.guest.email ?? null,
      guestPhone: input.guest.phone ?? null,
      numGuests: guests,
      grossAmount: centsToDollarsOrNull(grossCents),
      cleaningFee: centsToDollarsOrNull(cleaningCents),
      taxes: centsToDollarsOrNull(taxesCents),
      payout: money?.payout_cents == null ? null : centsToDollarsOrNull(money.payout_cents),
      currency: q.currency,
      notes: input.notes ?? null,
      sourceRef,
      bookedAt: now.toISOString(),
      actor,
    })) as BookingEx;
  } catch (err) {
    if (isBookingOverlapError(err)) {
      // Two creates for the same source_ref racing: the loser reads the
      // winner's row instead of reporting a conflict with itself.
      const twin = await findBySourceRef(sourceRef);
      if (twin) {
        return {
          ok: true,
          created: false,
          reservation: twin,
          confirmationCode: twin.external_confirmation_code ?? '',
          total_cents: twin.gross_amount == null ? null : Math.round(Number(twin.gross_amount) * 100),
        };
      }
      return fail({ ok: false, error: 'booking_overlap', conflict: err.conflict });
    }
    throw err;
  }

  await afterCreate(row, input, money, q);

  return {
    ok: true,
    created: true,
    reservation: row,
    confirmationCode: row.external_confirmation_code ?? '',
    total_cents: grossCents,
  };
}

/** The side effects after the row is committed. Each is its own try/catch. */
async function afterCreate(row: BookingEx, input: CreateReservationInput, money: BridgeMoney | null, q: StayQuote): Promise<void> {
  const warn = (what: string, err: unknown) =>
    console.warn(`[pms-bridge] ${what} failed for ${row.id}:`, err instanceof Error ? err.message : String(err));

  try {
    const { upsertGuestForBooking } = await import('./guests-identity.ts');
    await upsertGuestForBooking({
      id: row.id,
      guest_name: fullNameOf(input.guest) || row.guest_name,
      guest_email: input.guest.email ?? row.guest_email,
      guest_phone: input.guest.phone ?? row.guest_phone,
      source: input.source === 'sca' ? 'sca' : 'helm',
    });
  } catch (err) {
    warn('guest link', err);
  }

  try {
    const { writeDirectBookingFinance } = await import('./booking-finance-write.ts');
    const paid = !!money?.stripe_payment_intent_id;
    const noteBits = [
      paid ? `Stripe payment intent ${money?.stripe_payment_intent_id}` : 'Quoted by Helm at booking; awaiting settlement',
      money?.stripe_account_key ? `account ${money.stripe_account_key}` : null,
      `via ${input.source}`,
    ].filter(Boolean);
    await writeDirectBookingFinance(row.id, {
      gross_amount: money ? money.gross_cents / 100 : q.total_cents / 100,
      taxes: money ? (money.taxes_cents ?? q.tax_cents) / 100 : q.tax_cents / 100,
      cleaning_fee: money ? (money.cleaning_cents ?? q.cleaning_cents) / 100 : q.cleaning_cents / 100,
      stripe_fee: money?.stripe_fee_cents == null ? undefined : money.stripe_fee_cents / 100,
      payout: money?.payout_cents == null ? undefined : money.payout_cents / 100,
      currency: q.currency,
      money_source: paid ? 'stripe' : 'manual',
      confidence: paid ? 'high' : 'low',
      notes: noteBits.join('; '),
    });
  } catch (err) {
    warn('finance write', err);
  }

  try {
    const { planAutomations } = await import('./automations.ts');
    await planAutomations({ propertyId: row.property_id });
  } catch (err) {
    warn('automations plan', err);
  }

  try {
    const { refreshMirrorForBooking } = await import('./helm-calendar-mirror.ts');
    await refreshMirrorForBooking(row.id);
  } catch (err) {
    warn('mirror refresh', err);
  }
}

export type ReservationStatusResult = { ok: true; reservation: BookingEx; changed: boolean } | BridgeFailure;

/**
 * Soft cancel: a capture that failed on the site, a full refund, a guest
 * who called. Idempotent: an already-cancelled row answers ok unchanged.
 */
export async function cancelReservationFromBridge(
  idOrCode: string,
  input: { reason?: string | null; actor?: string | null } = {},
): Promise<ReservationStatusResult> {
  if (!isServiceConfigured) return fail({ ok: false, error: 'not_configured' });
  const row = await resolveReservation(idOrCode);
  if (!row) return fail({ ok: false, error: 'not_found' });
  const scope = await scopedProperty(row.property_id);
  if (isFailure(scope)) return scope;
  if (row.status === 'cancelled') return { ok: true, reservation: row, changed: false };

  const { cancelBooking } = await import('./bookings-write.ts');
  const after = (await cancelBooking(row.id, { reason: input.reason ?? null, actor: (input.actor ?? '').trim() || 'bridge' })) as BookingEx;

  try {
    const { planAutomations } = await import('./automations.ts');
    await planAutomations({ propertyId: after.property_id });
  } catch (err) {
    console.warn('[pms-bridge] automations replan failed after cancel', after.id, err instanceof Error ? err.message : String(err));
  }
  return { ok: true, reservation: after, changed: true };
}

/**
 * Confirm a pending / inquiry row, or re-confirm a cancelled one, on its own
 * dates. The move runs under the property lock, so a hold that grew back
 * onto sold nights is 'booking_overlap'.
 */
export async function confirmReservationFromBridge(
  idOrCode: string,
  input: { actor?: string | null } = {},
): Promise<ReservationStatusResult> {
  if (!isServiceConfigured) return fail({ ok: false, error: 'not_configured' });
  const row = await resolveReservation(idOrCode);
  if (!row) return fail({ ok: false, error: 'not_found' });
  const scope = await scopedProperty(row.property_id);
  if (isFailure(scope)) return scope;
  if (row.status === 'confirmed' || row.status === 'completed') return { ok: true, reservation: row, changed: false };
  if (row.status === 'block') return fail({ ok: false, error: 'invalid', detail: 'a block cannot be confirmed as a stay' });

  const { moveBooking, isBookingOverlapError } = await import('./bookings-write.ts');
  try {
    const after = (await moveBooking(
      row.id,
      { checkIn: row.check_in, checkOut: row.check_out, status: 'confirmed' },
      (input.actor ?? '').trim() || 'bridge',
    )) as BookingEx;
    try {
      const { planAutomations } = await import('./automations.ts');
      await planAutomations({ propertyId: after.property_id });
    } catch (err) {
      console.warn('[pms-bridge] automations plan failed after confirm', after.id, err instanceof Error ? err.message : String(err));
    }
    return { ok: true, reservation: after, changed: true };
  } catch (err) {
    if (isBookingOverlapError(err)) return fail({ ok: false, error: 'booking_overlap', conflict: err.conflict });
    throw err;
  }
}

// ── Read-back ───────────────────────────────────────────────────────────────

type ThreadLite = { id: string; booking_id: string | null; channel: string; guest_phone: string | null; updated_at: string };

/** booking id -> the thread the concierge should draft on (sms first, then newest). */
async function threadsForBookings(bookingIds: readonly string[]): Promise<Map<string, ThreadLite>> {
  const out = new Map<string, ThreadLite>();
  const ids = [...new Set(bookingIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    const { data, error } = await supabaseAdmin
      .from('guest_threads')
      .select('id, booking_id, channel, guest_phone, updated_at')
      .in('booking_id', slice)
      .neq('status', 'archived')
      .order('updated_at', { ascending: false });
    if (error || !data) continue;
    for (const t of data as ThreadLite[]) {
      if (!t.booking_id) continue;
      const cur = out.get(t.booking_id);
      if (!cur || (t.channel === 'sms' && cur.channel !== 'sms')) out.set(t.booking_id, t);
    }
  }
  return out;
}

function firstNameOf(full: string | null | undefined): string {
  const s = (full ?? '').trim();
  return s ? s.split(/\s+/)[0] : '';
}

/** A StayPicker row for a canonical Helm booking. */
export function toBridgePick(
  b: Pick<BookingEx, 'id' | 'property_id' | 'guest_name' | 'guest_phone' | 'check_in' | 'check_out' | 'channel'>,
  ctx: { propertyName: string | null; thread: Pick<ThreadLite, 'id' | 'guest_phone'> | null; today: string },
): ReservationPick {
  const checkIn = b.check_in.slice(0, 10);
  const checkOut = b.check_out.slice(0, 10);
  const phone = toE164Phone(b.guest_phone) ?? toE164Phone(ctx.thread?.guest_phone);
  const inHouse = ctx.today >= checkIn && ctx.today < checkOut;
  return {
    reservation_id: b.id,
    conversation_id: ctx.thread ? helmConversationId(ctx.thread.id) : '',
    listing_id: b.property_id,
    property_name: ctx.propertyName ?? '',
    guest_full: (b.guest_name ?? '').trim(),
    guest_first: firstNameOf(b.guest_name),
    check_in: checkIn,
    check_out: checkOut,
    in_house: inHouse,
    effective_start: checkIn <= ctx.today ? ctx.today : checkIn,
    module: phone ? HELM_SMS_MODULE : '',
    channel: channelLabel(b.channel),
  };
}

export type ReservationMoney = {
  reservation: BookingEx;
  finance: BookingFinance | null;
  pick: ReservationPick;
};

/** GET /api/pms/reservations/[id]: the row, its finance row and its picker shape. */
export async function reservationMoney(idOrCode: string, opts: { now?: Date } = {}): Promise<ReservationMoney | null> {
  const row = await resolveReservation(idOrCode);
  if (!row) return null;
  const [financeRes, property, threads] = await Promise.all([
    supabaseAdmin.from('booking_finance').select('*').eq('booking_id', row.id).maybeSingle(),
    getBridgeProperty(row.property_id),
    threadsForBookings([row.id]),
  ]);
  const finance = financeRes.error ? null : ((financeRes.data ?? null) as BookingFinance | null);
  return {
    reservation: row,
    finance,
    pick: toBridgePick(row, { propertyName: property?.name ?? null, thread: threads.get(row.id) ?? null, today: todayInEastern(opts.now ?? new Date()) }),
  };
}

/**
 * ReservationPick rows for the concierge stay picker: canonical confirmed /
 * completed stays on Helm-run homes that are in house or arrive within
 * `days`. A Guesty-run property_id filter answers an empty list, never a
 * Guesty stay.
 */
export async function listReservationPicks(opts: { days?: number; propertyId?: string | null; now?: Date } = {}): Promise<ReservationPick[]> {
  if (!isServiceConfigured) return [];
  const days = Math.min(400, Math.max(1, Math.round(opts.days ?? 60)));
  const today = todayInEastern(opts.now ?? new Date());
  const horizon = shiftIsoDay(today, days);

  let props = await listBridgeProperties('helm');
  if (opts.propertyId) props = props.filter((p) => p.id === opts.propertyId);
  if (props.length === 0) return [];
  const names = new Map(props.map((p) => [p.id, p.name]));
  const ids = props.map((p) => p.id);

  const rows = await selectAllPaged<BookingEx>(
    (from, to) =>
      supabaseAdmin
        .from('bookings')
        .select('*')
        .in('property_id', ids)
        .is('duplicate_of', null)
        .in('status', ['confirmed', 'completed'])
        .gte('check_out', today)
        .lte('check_in', horizon)
        .order('check_in', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'pms picks' },
  );
  const threads = await threadsForBookings(rows.map((r) => r.id));
  const picks = rows.map((b) => toBridgePick(b, { propertyName: names.get(b.property_id) ?? null, thread: threads.get(b.id) ?? null, today }));
  // In-house first, then by arrival, the order the picker lists them.
  return picks.sort((a, b) => Number(b.in_house) - Number(a.in_house) || a.check_in.localeCompare(b.check_in) || a.reservation_id.localeCompare(b.reservation_id));
}

// ── Fleet description for staycapeann.com ───────────────────────────────────

export type BridgeChannelLink = { channel: string; external_listing_id: string | null; external_listing_url: string | null };

export type BridgeTax = {
  config: TaxConfigRow | null;
  /** The rate a one-night direct stay owes today, or null when the jurisdiction is unknown. */
  rate: number | null;
  source: 'config' | 'ma_legacy' | 'unknown';
};

export type BridgePropertyDescription = {
  property_id: string;
  name: string;
  title: string;
  address: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  region: string | null;
  calendar_authority: 'guesty' | 'helm';
  rate_plan: RatePlanRow | null;
  tax: BridgeTax;
  listing: ScaListing | null;
  channels: BridgeChannelLink[];
  ical_export_url: string | null;
};

/** Where Helm lives, for absolute URLs handed to other services. */
export function helmOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://helm.risingtidestr.com').replace(/\/+$/, '');
}

async function channelLinksByProperty(propertyIds: readonly string[]): Promise<Map<string, BridgeChannelLink[]>> {
  const out = new Map<string, BridgeChannelLink[]>();
  if (propertyIds.length === 0) return out;
  const { data, error } = await supabaseAdmin
    .from('channel_listings')
    .select('property_id, channel, external_listing_id, external_listing_url')
    .in('property_id', [...propertyIds])
    .eq('is_active', true)
    .order('channel', { ascending: true });
  if (error || !data) return out;
  for (const r of data as Array<{ property_id: string; channel: string; external_listing_id: string | null; external_listing_url: string | null }>) {
    const list = out.get(r.property_id) ?? [];
    list.push({ channel: r.channel, external_listing_id: r.external_listing_id, external_listing_url: r.external_listing_url });
    out.set(r.property_id, list);
  }
  return out;
}

/**
 * Everything staycapeann.com's registry and the concierge fleet watch need
 * about one home. Nothing from property_access is read, so no code can
 * leak; the listing shape is toScaListing's.
 */
export async function describePropertyForBridge(
  property: BridgeProperty,
  opts: { channels?: BridgeChannelLink[]; now?: Date } = {},
): Promise<BridgePropertyDescription> {
  const today = todayInEastern(opts.now ?? new Date());
  const [bundle, record] = await Promise.all([loadPricingBundle(property.id, today, today), getListingRecord(property.id)]);

  let tax: BridgeTax = { config: bundle.tax, rate: null, source: 'unknown' };
  try {
    const r = resolveTaxRate({ config: bundle.tax, propertyId: property.id, region: property.region, nights: 1, channel: 'direct', onIso: today });
    tax = { config: bundle.tax, rate: r.rate, source: r.source };
  } catch (err) {
    if (!(err instanceof TaxJurisdictionUnknownError)) throw err;
  }

  return {
    property_id: property.id,
    name: property.name,
    title: record?.content?.title ?? property.title ?? property.name,
    address: property.address,
    city: property.city,
    lat: property.latitude,
    lng: property.longitude,
    region: property.region,
    calendar_authority: property.calendar_authority,
    rate_plan: bundle.plan,
    tax,
    listing: record ? toScaListing(record, bundle.plan) : null,
    channels: opts.channels ?? [],
    ical_export_url: property.ical_export_token ? `${helmOrigin()}/api/channels/ical/${property.ical_export_token}` : null,
  };
}

/** GET /api/pms/properties. */
export async function describeFleetForBridge(authority: 'helm' | 'all' = 'helm', opts: { now?: Date } = {}): Promise<BridgePropertyDescription[]> {
  const props = await listBridgeProperties(authority);
  if (props.length === 0) return [];
  const links = await channelLinksByProperty(props.map((p) => p.id));
  const out: BridgePropertyDescription[] = [];
  // Sequential on purpose: each home is four reads and the fleet is small;
  // a fan-out across twenty homes would hammer PostgREST for no gain.
  for (const p of props) out.push(await describePropertyForBridge(p, { channels: links.get(p.id) ?? [], now: opts.now }));
  return out;
}
