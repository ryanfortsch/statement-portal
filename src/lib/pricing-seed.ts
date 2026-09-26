/**
 * Pure mapper from the Guesty listing export (the shape the Open API's
 * GET /listings/:id returns, as captured in scratchpad/calderwood_guesty_seed.json)
 * to the Helm-native rows the PMS plumbing owns:
 *
 *   listing.prices + terms + calendarRules   -> property_rate_plans
 *   calendar days (data.days[] or an array)  -> property_rate_days
 *   listing.taxes[] + address.state          -> property_tax_config
 *   listing.amenities                        -> deduped amenity list
 *   listing.listingRooms (beds only)         -> public.property_rooms details
 *   listing.publicDescription + facts        -> property_listing_content
 *   listing.pictures                         -> a photo manifest the seed
 *                                               script copies to Vercel Blob
 *
 * Rules that are load-bearing:
 *   - doorCode, lockCode, checkInInstructions and checkOutInstructions are
 *     NEVER read. Door codes live only in property_access, entered by the
 *     operator. pricing-seed.test.ts scans this file for those keys.
 *   - A calendar day with status 'booked' or 'unavailable' is NOT written as
 *     closed. Occupancy comes from bookings; Guesty's blockRefs an / bw / b /
 *     a are rule artifacts, not holds. Manual (m) and owner (o) refs are
 *     listed for the operator and write nothing.
 *   - direct_markup_pct is recorded as 0 explicitly: the +6% Markup line on
 *     Airbnb folios is Guesty's channel markup, not a direct price.
 *   - Money is integer cents (round(price * 100)).
 *
 * No IO, relative imports only, so node:test loads it.
 */

import type { RateDayRow, RatePlanRow, TaxConfigRow } from './rate-plan.ts';
import type { RoomBed, RoomDetails } from './property-rooms-shared.ts';

// ── Loose input shapes (Guesty's JSON, only the keys we read) ───────────────

export type GuestySeedListing = {
  _id?: string;
  nickname?: string;
  title?: string;
  timezone?: string;
  accommodates?: number;
  bedrooms?: number;
  bathrooms?: number;
  beds?: number;
  propertyType?: string;
  roomType?: string;
  defaultCheckInTime?: string;
  defaultCheckOutTime?: string;
  importedAt?: string;
  lastUpdatedAt?: string;
  address?: { state?: string; city?: string; lat?: number; lng?: number; full?: string };
  prices?: {
    currency?: string;
    basePrice?: number;
    weekendBasePrice?: number | null;
    weekendDays?: number[];
    guestsIncludedInRegularFee?: number;
    extraPersonFee?: number;
    cleaningFee?: number;
    securityDepositFee?: number | null;
    weeklyPriceFactor?: number;
    monthlyPriceFactor?: number;
  };
  terms?: { minNights?: number; maxNights?: number };
  calendarRules?: {
    advanceNotice?: { defaultSettings?: { hours?: number } };
    bookingWindow?: { defaultSettings?: { days?: number } };
    preparationTime?: { defaultSettings?: { days?: number } };
  };
  taxes?: Array<{
    type?: string;
    amount?: number;
    units?: string;
    appliedToAllFees?: boolean;
    appliedOnFees?: string[];
    channelConfig?: Array<{ channel?: string; userConfig?: { syncSelection?: string } }>;
    conditionalOverrides?: { viewType?: string; maxNightCountToApplyOn?: number } | null;
  }>;
  amenities?: string[];
  amenitiesNotIncluded?: string[];
  listingRooms?: Array<{
    _id?: string;
    roomNumber?: number;
    beds?: Array<{ type?: string; quantity?: number }>;
  }>;
  publicDescription?: {
    summary?: string;
    space?: string;
    access?: string;
    interactionWithGuests?: string;
    neighborhood?: string;
    houseRules?: string;
    notes?: string;
  };
  picture?: { large?: string; regular?: string; thumbnail?: string; caption?: string };
  pictures?: Array<{ _id?: string; original?: string; thumbnail?: string; caption?: string }>;
};

export type GuestySeedCalendarDay = {
  date?: string;
  price?: number | null;
  minNights?: number | null;
  status?: string;
  cta?: boolean;
  ctd?: boolean;
  blocks?: Record<string, boolean>;
  blockRefs?: Array<{ type?: string; startDate?: string; endDate?: string; reservationId?: string }>;
};

/** Either the raw API envelope or the bare day list. */
export type GuestySeedCalendar =
  | { data?: { days?: GuestySeedCalendarDay[] } | null }
  | GuestySeedCalendarDay[]
  | null
  | undefined;

// ── Output shapes ───────────────────────────────────────────────────────────

export type SeedRatePlan = Omit<RatePlanRow, 'updated_by' | 'created_at' | 'updated_at'>;

export type SeedRateDay = Omit<RateDayRow, 'updated_by' | 'updated_at'>;

export type SeedTaxConfig = Omit<TaxConfigRow, 'updated_by' | 'effective_from'>;

export type SeedRoom = {
  room_type: 'bedroom';
  name: string;
  sort_order: number;
  details: RoomDetails & { beds: RoomBed[] };
  /** Guesty listingRooms _id, for idempotent re-runs. */
  external_id: string | null;
};

export type SeedListingContent = {
  property_id: string;
  title: string | null;
  summary: string | null;
  space: string | null;
  access: string | null;
  interaction: string | null;
  neighborhood: string | null;
  house_rules: string | null;
  notes: string | null;
  property_type: string | null;
  room_type: string | null;
  accommodates: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  beds: number | null;
  amenities: string[];
  amenities_not_included: string[];
  source: 'guesty_seed';
  source_ref: string | null;
};

export type SeedPhoto = {
  external_id: string | null;
  source_url: string;
  thumbnail_url: string | null;
  caption: string | null;
  sort_order: number;
  is_hero: boolean;
};

/** A manual or owner block Guesty held; the operator confirms before Helm writes one. */
export type SeedOperatorBlock = { date: string; kind: 'manual' | 'owner' };

export type HelmSeed = {
  propertyId: string;
  ratePlan: SeedRatePlan;
  rateDays: SeedRateDay[];
  taxConfig: SeedTaxConfig | null;
  amenities: string[];
  rooms: SeedRoom[];
  content: SeedListingContent;
  photoManifest: SeedPhoto[];
  operatorBlocks: SeedOperatorBlock[];
};

export type MapOptions = {
  /** Helm registry id; defaults to a slug of the Guesty nickname ('65 Calderwood' -> '65_calderwood'). */
  propertyId?: string;
  /** property_rate_days.note on every seeded day. */
  rateDayNote?: string;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const numOrNull = (v: unknown): number | null => (v == null || v === '' ? null : num(v, 0));
const cents = (dollars: unknown): number => Math.round(num(dollars) * 100);
const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\r\n/g, '\n').trim();
  return t.length > 0 ? t : null;
};

/** '65 Calderwood' -> '65_calderwood'. */
export function slugFromNickname(nickname: string | null | undefined): string {
  return String(nickname ?? '')
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** A comparison key for an amenity: case, curly quotes and spacing folded. */
export function amenityKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Dedupe amenities, keeping the first spelling of each. */
export function dedupeAmenities(list: readonly unknown[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list ?? []) {
    const s = text(raw);
    if (!s) continue;
    const k = amenityKey(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

const BED_SIZES: Record<string, string> = {
  KING_BED: 'king',
  QUEEN_BED: 'queen',
  DOUBLE_BED: 'double',
  FULL_BED: 'full',
  SINGLE_BED: 'single',
  TWIN_BED: 'twin',
  SOFA_BED: 'sofa bed',
  COUCH: 'couch',
  AIR_MATTRESS: 'air mattress',
  BUNK_BED: 'bunk',
  FLOOR_MATTRESS: 'floor mattress',
  TODDLER_BED: 'toddler bed',
  CRIB: 'crib',
  WATER_BED: 'water bed',
  HAMMOCK: 'hammock',
  TRUNDLE_BED: 'trundle',
  DAY_BED: 'day bed',
};

/** Guesty bed enum -> the lowercase size RoomsEditor parses ('2x twin', 'king'). */
export function bedSize(guestyType: string | null | undefined): string {
  const key = String(guestyType ?? '').toUpperCase().trim();
  if (BED_SIZES[key]) return BED_SIZES[key];
  return key.replace(/_BED$/, '').replace(/_/g, ' ').toLowerCase() || 'bed';
}

const STATE_TO_JURISDICTION: Record<string, TaxConfigRow['jurisdiction']> = {
  ma: 'MA',
  massachusetts: 'MA',
  ct: 'CT',
  connecticut: 'CT',
  fl: 'FL',
  florida: 'FL',
};

export function jurisdictionForState(state: string | null | undefined): TaxConfigRow['jurisdiction'] | null {
  return STATE_TO_JURISDICTION[String(state ?? '').toLowerCase().trim()] ?? null;
}

/** Guesty channel ids -> Helm channel vocabulary. */
const CHANNEL_MAP: Record<string, string> = {
  airbnb: 'airbnb',
  airbnb2: 'airbnb',
  bookingcom: 'booking_com',
  booking_com: 'booking_com',
  homeaway: 'vrbo',
  homeaway2: 'vrbo',
  vrbo: 'vrbo',
  expedia: 'vrbo',
  direct: 'direct',
  directbookings: 'direct',
};

export function helmChannel(guestyChannel: string | null | undefined): string {
  const k = String(guestyChannel ?? '').toLowerCase().trim();
  return CHANNEL_MAP[k] ?? k;
}

const FEE_CODE_TO_APPLIES: Record<string, string> = {
  AF: 'accommodation',
  CF: 'cleaning',
};

const pctFromFactor = (factor: unknown): number => {
  const f = num(factor, 1);
  const pct = Math.round((1 - f) * 10000) / 100;
  return pct > 0 ? pct : 0;
};

const isoDay = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.slice(0, 10) : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

// ── The pieces ──────────────────────────────────────────────────────────────

export function mapRatePlan(listing: GuestySeedListing, propertyId: string): SeedRatePlan {
  const prices = listing.prices ?? {};
  const terms = listing.terms ?? {};
  const rules = listing.calendarRules ?? {};
  const weekendDays = Array.isArray(prices.weekendDays)
    ? prices.weekendDays.map((d) => num(d, -1)).filter((d) => d >= 0 && d <= 6)
    : [5, 6];
  const cancellation = text(listing.publicDescription?.notes);
  const amenityKeys = new Set(dedupeAmenities(listing.amenities).map(amenityKey));
  return {
    property_id: propertyId,
    currency: String(prices.currency ?? 'USD'),
    base_nightly_cents: cents(prices.basePrice),
    weekend_nightly_cents: prices.weekendBasePrice == null ? null : cents(prices.weekendBasePrice),
    weekend_days: weekendDays,
    guests_included: Math.max(1, Math.round(num(prices.guestsIncludedInRegularFee, 2))),
    extra_guest_cents_per_night: cents(prices.extraPersonFee),
    cleaning_fee_cents: cents(prices.cleaningFee),
    pet_fee_cents: null,
    security_deposit_cents: prices.securityDepositFee == null ? null : cents(prices.securityDepositFee),
    weekly_discount_pct: pctFromFactor(prices.weeklyPriceFactor),
    monthly_discount_pct: pctFromFactor(prices.monthlyPriceFactor),
    direct_markup_pct: 0,
    min_nights_default: Math.max(1, Math.round(num(terms.minNights, 2))),
    max_nights: numOrNull(terms.maxNights),
    advance_notice_hours: Math.round(num(rules.advanceNotice?.defaultSettings?.hours, 24)),
    booking_window_days: Math.round(num(rules.bookingWindow?.defaultSettings?.days, 365)),
    turnover_buffer_days: Math.round(num(rules.preparationTime?.defaultSettings?.days, 0)),
    checkin_time: text(listing.defaultCheckInTime) ?? '16:00',
    checkout_time: text(listing.defaultCheckOutTime) ?? '11:00',
    max_occupancy: numOrNull(listing.accommodates),
    pets_allowed: amenityKeys.has('pets allowed'),
    quiet_hours: null,
    cancellation_policy_key: cancellation ? 'custom' : 'sca_50_30',
    cancellation_terms: cancellation,
    house_rules: text(listing.publicDescription?.houseRules),
  };
}

/** The day list out of either calendar shape. */
export function calendarDaysOf(calendar: GuestySeedCalendar): GuestySeedCalendarDay[] {
  if (!calendar) return [];
  if (Array.isArray(calendar)) return calendar;
  const days = calendar.data?.days;
  return Array.isArray(days) ? days : [];
}

export function mapRateDays(
  calendar: GuestySeedCalendar,
  propertyId: string,
  note: string,
): { rateDays: SeedRateDay[]; operatorBlocks: SeedOperatorBlock[] } {
  const rateDays: SeedRateDay[] = [];
  const operatorBlocks: SeedOperatorBlock[] = [];
  const seen = new Set<string>();
  for (const day of calendarDaysOf(calendar)) {
    const date = isoDay(day?.date);
    if (!date || seen.has(date)) continue;
    seen.add(date);
    const price = day.price == null ? null : cents(day.price);
    const minNights = day.minNights == null ? null : Math.max(1, Math.round(num(day.minNights, 1)));
    rateDays.push({
      property_id: propertyId,
      date,
      nightly_cents: price,
      min_nights: minNights,
      cta: !!day.cta,
      ctd: !!day.ctd,
      // Never closed: booked / unavailable days are occupancy, and bookings
      // own occupancy. A seeded day only carries price and restrictions.
      closed: false,
      note,
      source: 'seed',
    });
    const refs = Array.isArray(day.blockRefs) ? day.blockRefs : [];
    const manual = day.blocks?.m === true || refs.some((r) => r?.type === 'm');
    const owner = day.blocks?.o === true || refs.some((r) => r?.type === 'o');
    if (manual) operatorBlocks.push({ date, kind: 'manual' });
    if (owner) operatorBlocks.push({ date, kind: 'owner' });
  }
  rateDays.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { rateDays, operatorBlocks };
}

/**
 * Guesty taxes[] -> one property_tax_config row. STATE_TAX feeds state_rate;
 * CITY / COUNTY / LOCAL feed local_rate; anything else is treated as local.
 * appliedOnFees AF / CF -> applies_to; a LOS conditional override is the
 * long-stay exemption; a channel marked DO_NOT_SYNC collects its own tax.
 * Returns null when the listing carries no percentage taxes. Throws when the
 * address state is not one the table accepts (MA / CT / FL), because a
 * silently wrong jurisdiction is the failure this whole module exists to
 * prevent.
 */
export function mapTaxConfig(listing: GuestySeedListing, propertyId: string): SeedTaxConfig | null {
  const taxes = (listing.taxes ?? []).filter((t) => String(t?.units ?? 'PERCENTAGE').toUpperCase() === 'PERCENTAGE');
  if (taxes.length === 0) return null;
  const jurisdiction = jurisdictionForState(listing.address?.state);
  if (!jurisdiction) {
    throw new Error(
      `pricing-seed: ${propertyId} has taxes but address.state '${listing.address?.state ?? ''}' is not MA, CT or FL`,
    );
  }
  let state = 0;
  let local = 0;
  const applies = new Set<string>();
  let exemptOver: number | null = null;
  const collected = new Set<string>();
  for (const t of taxes) {
    const rate = Math.round(num(t.amount) * 100) / 10000; // 15 -> 0.15
    const type = String(t.type ?? '').toUpperCase();
    if (type === 'STATE_TAX') state += rate;
    else local += rate;
    if (t.appliedToAllFees) {
      applies.add('accommodation');
      applies.add('cleaning');
    }
    for (const code of t.appliedOnFees ?? []) {
      const mapped = FEE_CODE_TO_APPLIES[String(code).toUpperCase()];
      if (mapped) applies.add(mapped);
    }
    const ov = t.conditionalOverrides;
    if (ov && String(ov.viewType ?? '').toUpperCase() === 'LOS' && ov.maxNightCountToApplyOn != null) {
      const n = Math.round(num(ov.maxNightCountToApplyOn));
      exemptOver = exemptOver == null ? n : Math.min(exemptOver, n);
    }
    for (const cc of t.channelConfig ?? []) {
      if (String(cc?.userConfig?.syncSelection ?? '').toUpperCase() === 'DO_NOT_SYNC') {
        collected.add(helmChannel(cc.channel));
      }
    }
  }
  if (applies.size === 0) applies.add('accommodation');
  return {
    property_id: propertyId,
    jurisdiction,
    state_rate: round4(state),
    local_rate: round4(local),
    cif_rate: 0,
    applies_to: ['accommodation', 'cleaning'].filter((a) => applies.has(a)),
    long_stay_exempt_over_nights: exemptOver,
    collected_by_channels: [...collected].sort(),
    notes: `Seeded from Guesty listing ${listing._id ?? ''}`.trim(),
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Only listingRooms that hold beds become rooms; Guesty pads the list with empty ones. */
export function mapRooms(listing: GuestySeedListing): SeedRoom[] {
  const withBeds = (listing.listingRooms ?? [])
    .filter((r) => Array.isArray(r?.beds) && r.beds.some((b) => num(b?.quantity, 0) > 0))
    .sort((a, b) => num(a.roomNumber) - num(b.roomNumber));
  return withBeds.map((r, i) => {
    const beds: RoomBed[] = [];
    for (const b of r.beds ?? []) {
      const count = Math.round(num(b?.quantity, 0));
      if (count <= 0) continue;
      const size = bedSize(b?.type);
      const existing = beds.find((x) => x.size === size);
      if (existing) existing.count += count;
      else beds.push({ size, count });
    }
    return {
      room_type: 'bedroom',
      name: `Bedroom ${i + 1}`,
      sort_order: i,
      details: { beds },
      external_id: r._id ?? null,
    };
  });
}

export function mapContent(listing: GuestySeedListing, propertyId: string, amenities: string[]): SeedListingContent {
  const pd = listing.publicDescription ?? {};
  return {
    property_id: propertyId,
    title: text(listing.title),
    summary: text(pd.summary),
    space: text(pd.space),
    access: text(pd.access),
    interaction: text(pd.interactionWithGuests),
    neighborhood: text(pd.neighborhood),
    house_rules: text(pd.houseRules),
    notes: text(pd.notes),
    property_type: text(listing.propertyType),
    room_type: text(listing.roomType),
    accommodates: numOrNull(listing.accommodates),
    bedrooms: numOrNull(listing.bedrooms),
    bathrooms: numOrNull(listing.bathrooms),
    beds: numOrNull(listing.beds),
    amenities,
    amenities_not_included: dedupeAmenities(listing.amenitiesNotIncluded),
    source: 'guesty_seed',
    source_ref: listing._id ?? null,
  };
}

export function mapPhotos(listing: GuestySeedListing): SeedPhoto[] {
  const pictures = (listing.pictures ?? []).filter((p) => typeof p?.original === 'string' && p.original.length > 0);
  if (pictures.length === 0) return [];
  const heroUrls = new Set(
    [listing.picture?.large, listing.picture?.regular].filter((u): u is string => typeof u === 'string' && u.length > 0),
  );
  let heroIndex = pictures.findIndex((p) => heroUrls.has(p.original as string));
  if (heroIndex < 0) heroIndex = 0;
  return pictures.map((p, i) => ({
    external_id: p._id ?? null,
    source_url: p.original as string,
    thumbnail_url: text(p.thumbnail),
    caption: text(p.caption),
    sort_order: i,
    is_hero: i === heroIndex,
  }));
}

// ── The mapper ──────────────────────────────────────────────────────────────

export function mapGuestyListingToHelm(
  listing: GuestySeedListing,
  calendarDays: GuestySeedCalendar,
  opts: MapOptions = {},
): HelmSeed {
  if (!listing || typeof listing !== 'object') throw new Error('pricing-seed: listing is required');
  const propertyId = opts.propertyId ?? slugFromNickname(listing.nickname);
  if (!propertyId) throw new Error('pricing-seed: no propertyId and the listing has no nickname to slug');
  const importedOn = isoDay(listing.lastUpdatedAt) ?? isoDay(listing.importedAt);
  const note = opts.rateDayNote ?? `PriceLabs via Guesty${importedOn ? ` ${importedOn}` : ''}`;
  const amenities = dedupeAmenities(listing.amenities);
  const { rateDays, operatorBlocks } = mapRateDays(calendarDays, propertyId, note);
  return {
    propertyId,
    ratePlan: mapRatePlan(listing, propertyId),
    rateDays,
    taxConfig: mapTaxConfig(listing, propertyId),
    amenities,
    rooms: mapRooms(listing),
    content: mapContent(listing, propertyId, amenities),
    photoManifest: mapPhotos(listing),
    operatorBlocks,
  };
}
