/**
 * The Helm-native pricing brain: a property's rate plan, its per-day
 * overrides and its quote-side tax config, turned into a priced stay.
 *
 * This is what replaces Guesty's rate card for a home whose
 * properties.calendar_authority is 'helm'. It reads three tables that step 1
 * of the PMS plumbing created (property_rate_plans, property_rate_days,
 * property_tax_config; see supabase/migrations/20260926200000_helm_pms_plumbing.sql)
 * and it NEVER re-implements the total. computeQuoteMoney in
 * sca-quotes-types.ts is the one formula shared with the SCA quote composer
 * and with staycapeann.com, so this module builds that formula's inputs
 * (accommodation, cleaning, extra lines, discount, tax rate, exemption) and
 * hands the arithmetic over.
 *
 * Shape notes, so the numbers match what Guesty produced for the same stay:
 *   - a night's price is the day override when one is set, else the weekend
 *     rate on plan.weekend_days (0 = Sunday .. 6 = Saturday, Guesty's
 *     weekendDays vocabulary, read as the UTC weekday of the ISO date), else
 *     the base rate;
 *   - guests above guests_included pay extra_guest_cents_per_night per night,
 *     and that amount is TAXED like accommodation (Guesty folds it into the
 *     fare), so it rides as a taxable extra line;
 *   - the weekly discount applies at 7+ nights and the monthly one at 28+,
 *     monthly winning, both as a percentage of accommodation;
 *   - direct_markup_pct is Guesty's invisible "Standard Rate" +6%, made
 *     visible: it applies to accommodation on the direct / sca channels only
 *     and is reported as its own line rather than hidden in the nightly rate.
 *
 * Tax: a property_tax_config row wins. Without one, a Cape Ann home falls
 * back to owedOccupancyTaxRate in occupancy-tax.ts (the MA authority, READ
 * ONLY from here; that file is payout-adjacent and is never edited for this),
 * and any other region throws TaxJurisdictionUnknownError rather than
 * quoting 11.7% on a Connecticut house. tax-config.ts is the database edge
 * for the same matrix.
 *
 * Money is integer cents. Dates are YYYY-MM-DD; a stay is [check_in,
 * check_out). Pure: no IO, relative imports only, so node:test can load it
 * (src/lib/__tests__/rate-plan.test.ts).
 */

import {
  computeQuoteMoney,
  nightsBetween,
  shiftIsoDay,
  todayInEastern,
  TAX_EXEMPT_OVER_NIGHTS,
  type ExtraLine,
} from './sca-quotes-types.ts';
import { owedOccupancyTaxRate } from './occupancy-tax.ts';
import { CAPE_ANN_REGION } from './property-scope.ts';

// ── Row shapes (mirror the DDL; numerics arrive as strings from PostgREST) ──

export type RatePlanRow = {
  property_id: string;
  currency: string;
  base_nightly_cents: number;
  weekend_nightly_cents: number | null;
  /** 0 = Sunday .. 6 = Saturday. */
  weekend_days: number[];
  guests_included: number;
  extra_guest_cents_per_night: number;
  cleaning_fee_cents: number;
  pet_fee_cents: number | null;
  security_deposit_cents: number | null;
  weekly_discount_pct: number;
  monthly_discount_pct: number;
  direct_markup_pct: number;
  min_nights_default: number;
  max_nights: number | null;
  advance_notice_hours: number;
  booking_window_days: number;
  turnover_buffer_days: number;
  /** Guest-facing HH:MM in the property's timezone. */
  checkin_time: string;
  checkout_time: string;
  max_occupancy: number | null;
  pets_allowed: boolean;
  quiet_hours: string | null;
  cancellation_policy_key: string;
  cancellation_terms: string | null;
  house_rules: string | null;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type RateDayRow = {
  property_id: string;
  date: string;
  /** null = the plan's own rate applies. */
  nightly_cents: number | null;
  min_nights: number | null;
  cta: boolean;
  ctd: boolean;
  closed: boolean;
  note: string | null;
  source: 'operator' | 'seed' | 'pricelabs' | 'rule';
  updated_by?: string | null;
  updated_at?: string;
};

export type TaxConfigRow = {
  property_id: string;
  jurisdiction: 'MA' | 'CT' | 'FL';
  state_rate: number;
  local_rate: number;
  cif_rate: number;
  applies_to: string[];
  long_stay_exempt_over_nights: number | null;
  /** Channels that collect and remit the tax themselves (airbnb, ...). */
  collected_by_channels: string[];
  effective_from?: string;
  notes?: string | null;
  updated_by?: string | null;
};

export type QuoteChannel =
  | 'direct'
  | 'sca'
  | 'concierge'
  | 'airbnb'
  | 'vrbo'
  | 'booking_com'
  | 'manual'
  | 'other';

/** Channels whose accommodation carries direct_markup_pct. */
const MARKUP_CHANNELS: ReadonlySet<string> = new Set(['direct', 'sca']);

export class TaxJurisdictionUnknownError extends Error {
  readonly propertyId: string;
  readonly region: string | null;
  constructor(propertyId: string, region: string | null | undefined) {
    super(
      `No property_tax_config row for ${propertyId} (region ${region ?? 'unknown'}); ` +
        'only a cape_ann home may fall back to the MA occupancy tax table',
    );
    this.name = 'TaxJurisdictionUnknownError';
    this.propertyId = propertyId;
    this.region = region ?? null;
  }
}

// ── Small helpers ───────────────────────────────────────────────────────────

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const roundCents = (v: number): number => Math.round(v);

/** UTC weekday of an ISO date: 0 = Sunday .. 6 = Saturday. */
export function isoWeekday(iso: string): number {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).getUTCDay();
}

/** Every night of [checkIn, checkOut). Bounded so a bad range cannot hang. */
export function stayNights(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  for (let d = checkIn.slice(0, 10); d < checkOut.slice(0, 10) && out.length < 3660; d = shiftIsoDay(d, 1)) {
    out.push(d);
  }
  return out;
}

/** Index rate-day rows by date for O(1) lookups in the quote and the mirror. */
export function rateDayMap(rows: readonly RateDayRow[]): Map<string, RateDayRow> {
  const m = new Map<string, RateDayRow>();
  for (const r of rows) m.set(r.date.slice(0, 10), r);
  return m;
}

/**
 * The instant a local wall-clock time (HH:MM on an ISO date) happens in a
 * timezone, in epoch ms. Intl only, no tz library: take the UTC guess, read
 * it back in the zone, and correct by the difference (one pass is exact
 * except inside a DST gap, where a second pass settles it).
 */
export function zonedTimeToMs(iso: string, hhmm: string, timeZone = 'America/New_York'): number {
  const [y, mo, d] = iso.slice(0, 10).split('-').map(Number);
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '');
  const hh = m ? Math.min(23, Number(m[1])) : 16;
  const mm = m ? Math.min(59, Number(m[2])) : 0;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const asUtc = (ms: number): number => {
    const p: Record<string, number> = {};
    for (const part of fmt.formatToParts(new Date(ms))) {
      if (part.type !== 'literal') p[part.type] = Number(part.value);
    }
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  };
  // The wall clock we want, read as if it were UTC. Each pass measures how
  // far the zone's reading of the guess sits from that target and shifts
  // the guess by the difference; the second pass settles a DST edge.
  const target = Date.UTC(y, mo - 1, d, hh, mm, 0);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const diff = asUtc(guess) - target;
    if (diff === 0) break;
    guess -= diff;
  }
  return guess;
}

// ── Night resolution ────────────────────────────────────────────────────────

export type NightSource = 'override' | 'weekend' | 'base';

/** A night's price with where it came from. */
export function resolveNight(
  plan: RatePlanRow,
  dayOverride: RateDayRow | null | undefined,
  isoDate: string,
): { cents: number; source: NightSource } {
  if (dayOverride && dayOverride.nightly_cents != null && Number.isFinite(num(dayOverride.nightly_cents, NaN))) {
    return { cents: roundCents(num(dayOverride.nightly_cents)), source: 'override' };
  }
  const weekend = plan.weekend_nightly_cents;
  const weekendDays = (plan.weekend_days ?? []).map((d) => num(d, -1));
  if (weekend != null && Number.isFinite(num(weekend, NaN)) && weekendDays.includes(isoWeekday(isoDate))) {
    return { cents: roundCents(num(weekend)), source: 'weekend' };
  }
  return { cents: roundCents(num(plan.base_nightly_cents)), source: 'base' };
}

/** Override wins, else weekend / base by the UTC weekday in plan.weekend_days. */
export function resolveNightlyCents(
  plan: RatePlanRow,
  dayOverride: RateDayRow | null | undefined,
  isoDate: string,
): number {
  return resolveNight(plan, dayOverride, isoDate).cents;
}

/** The day's own minimum stay when set, else the plan default. */
export function resolveMinNights(plan: RatePlanRow, dayOverride: RateDayRow | null | undefined): number {
  if (dayOverride && dayOverride.min_nights != null && num(dayOverride.min_nights, 0) > 0) {
    return Math.round(num(dayOverride.min_nights));
  }
  return Math.max(1, Math.round(num(plan.min_nights_default, 1)));
}

// ── Tax ─────────────────────────────────────────────────────────────────────

export type TaxExemptReason = 'long_stay' | 'collected_by_channel';

export type ResolvedTax = {
  /** The jurisdiction's rate as a fraction (0.15 for CT), even when exempt. */
  rate: number;
  exempt: boolean;
  reason: TaxExemptReason | null;
  /** Whether the cleaning fee is inside the taxed base (applies_to). */
  taxes_cleaning: boolean;
};

/**
 * The rate a stay owes under a tax config row: state + local + cif, unless
 * the stay is longer than long_stay_exempt_over_nights or the channel
 * collects and remits on its own (Airbnb for Calderwood).
 */
export function taxRateFor(tax: TaxConfigRow, nights: number, channel: string): ResolvedTax {
  const rate = round4(num(tax.state_rate) + num(tax.local_rate) + num(tax.cif_rate));
  const appliesTo = (tax.applies_to ?? ['accommodation', 'cleaning']).map((s) => String(s).toLowerCase());
  const taxesCleaning = appliesTo.length === 0 ? true : appliesTo.includes('cleaning');
  const collected = (tax.collected_by_channels ?? []).map((c) => String(c).toLowerCase());
  if (collected.includes(String(channel ?? '').toLowerCase())) {
    return { rate, exempt: true, reason: 'collected_by_channel', taxes_cleaning: taxesCleaning };
  }
  const over = tax.long_stay_exempt_over_nights;
  if (over != null && num(over, -1) >= 0 && nights > num(over)) {
    return { rate, exempt: true, reason: 'long_stay', taxes_cleaning: taxesCleaning };
  }
  return { rate, exempt: false, reason: null, taxes_cleaning: taxesCleaning };
}

export type TaxSource = 'config' | 'ma_legacy';

/**
 * The fallback matrix, pure. A config row wins. A cape_ann home (or one
 * whose region is unknown, which the scope gate reads as Cape Ann) with no
 * row uses the MA table in occupancy-tax.ts with the SCA 31-night exemption.
 * Any other region with no row throws: a Connecticut house must never be
 * quoted at 11.7%.
 */
export function resolveTaxRate(args: {
  config: TaxConfigRow | null | undefined;
  propertyId: string;
  region: string | null | undefined;
  nights: number;
  channel: string;
  /** The date the MA rate is read for (CIF start dates); defaults to today. */
  onIso?: string;
}): ResolvedTax & { source: TaxSource } {
  if (args.config) {
    return { ...taxRateFor(args.config, args.nights, args.channel), source: 'config' };
  }
  if ((args.region ?? CAPE_ANN_REGION) !== CAPE_ANN_REGION) {
    throw new TaxJurisdictionUnknownError(args.propertyId, args.region);
  }
  // 0.117 + 0.03 floats to 0.14700000000000002; the rate is a 4-place figure.
  const rate = round4(owedOccupancyTaxRate(args.propertyId, args.onIso));
  const exempt = args.nights > TAX_EXEMPT_OVER_NIGHTS;
  return {
    rate,
    exempt,
    reason: exempt ? 'long_stay' : null,
    taxes_cleaning: true,
    source: 'ma_legacy',
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ── The stay quote ──────────────────────────────────────────────────────────

export type StayViolation =
  | 'min_nights'
  | 'max_nights'
  | 'advance_notice'
  | 'booking_window'
  | 'closed_night'
  | 'over_occupancy';

export type StayQuote = {
  nights: number;
  nightly: Array<{ date: string; cents: number; source: NightSource }>;
  /** Sum of the nightly rates, before discount and markup. */
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
  currency: string;
  violations: StayViolation[];
};

export type QuoteStayInput = {
  plan: RatePlanRow;
  /** Per-day overrides keyed by ISO date (see rateDayMap). */
  days: Map<string, RateDayRow>;
  /** The property_tax_config row, or null when the property has none. */
  tax: TaxConfigRow | null;
  checkIn: string;
  checkOut: string;
  guests: number;
  channel: QuoteChannel | string;
  now?: Date;
  /**
   * Needed only when `tax` is null: a cape_ann (or unknown) region falls
   * back to the MA table, any other region throws. Defaults to Cape Ann,
   * the same reading the scope gate gives a missing region.
   */
  region?: string | null;
  propertyId?: string;
  /** An already-resolved tax decision (from tax-config.ts) wins over `tax`. */
  taxOverride?: Pick<ResolvedTax, 'rate' | 'exempt'> & Partial<ResolvedTax>;
  /** Property timezone for the advance-notice clock. */
  timeZone?: string;
};

/**
 * Price a stay from the plan. Never throws for a rule violation: those are
 * reported in `violations` so a caller can show the guest why. It throws
 * only TaxJurisdictionUnknownError, because a quote with no known tax rate
 * is not a quote.
 */
export function quoteStay(input: QuoteStayInput): StayQuote {
  const { plan, days } = input;
  const checkIn = input.checkIn.slice(0, 10);
  const checkOut = input.checkOut.slice(0, 10);
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? 'America/New_York';
  const channel = String(input.channel ?? 'direct').toLowerCase();
  const nights = Math.max(0, nightsBetween(checkIn, checkOut));
  const guests = Math.max(1, Math.round(num(input.guests, 1)));
  const violations: StayViolation[] = [];

  // Nightly rates.
  const nightly = stayNights(checkIn, checkOut).map((date) => {
    const day = days.get(date) ?? null;
    return { date, ...resolveNight(plan, day, date) };
  });
  const accommodation = nightly.reduce((s, n) => s + n.cents, 0);

  // Extra guests above the included count, per night, taxed like the fare.
  const included = Math.max(0, Math.round(num(plan.guests_included, 0)));
  const extraGuests = Math.max(0, guests - included);
  const extraGuestCents = roundCents(extraGuests * num(plan.extra_guest_cents_per_night) * nights);

  // Length-of-stay discount: monthly at 28+, else weekly at 7+.
  let discountCents = 0;
  let discountLabel: string | null = null;
  const monthlyPct = num(plan.monthly_discount_pct);
  const weeklyPct = num(plan.weekly_discount_pct);
  if (nights >= 28 && monthlyPct > 0) {
    discountCents = roundCents((accommodation * monthlyPct) / 100);
    discountLabel = 'Monthly discount';
  } else if (nights >= 7 && weeklyPct > 0) {
    discountCents = roundCents((accommodation * weeklyPct) / 100);
    discountLabel = 'Weekly discount';
  }

  // Direct markup, visible as its own line on the direct channels only.
  const markupPct = num(plan.direct_markup_pct);
  const markupCents = MARKUP_CHANNELS.has(channel) && markupPct > 0 ? roundCents((accommodation * markupPct) / 100) : 0;

  // Tax.
  const resolved: ResolvedTax =
    input.taxOverride
      ? {
          rate: num(input.taxOverride.rate),
          exempt: !!input.taxOverride.exempt,
          reason: input.taxOverride.reason ?? null,
          taxes_cleaning: input.taxOverride.taxes_cleaning ?? true,
        }
      : resolveTaxRate({
          config: input.tax,
          propertyId: input.propertyId ?? plan.property_id,
          region: input.region,
          nights,
          channel,
          onIso: checkIn,
        });

  // computeQuoteMoney always taxes cleaning. When a jurisdiction does not,
  // the fee rides as an untaxed extra line instead; the subtotal and total
  // are unchanged, only the taxed base moves.
  const cleaningCents = roundCents(num(plan.cleaning_fee_cents));
  const extraLines: ExtraLine[] = [];
  if (extraGuestCents > 0) extraLines.push({ label: 'Extra guests', cents: extraGuestCents, taxable: true });
  if (markupCents > 0) extraLines.push({ label: 'Direct rate adjustment', cents: markupCents, taxable: true });
  let cleaningForFormula = cleaningCents;
  if (!resolved.taxes_cleaning && cleaningCents > 0) {
    extraLines.push({ label: 'Cleaning fee', cents: cleaningCents, taxable: false });
    cleaningForFormula = 0;
  }

  const money = computeQuoteMoney({
    accommodation_cents: accommodation,
    cleaning_cents: cleaningForFormula,
    extra_lines: extraLines,
    discount_cents: discountCents,
    tax_rate: resolved.rate,
    tax_exempt: resolved.exempt,
    payment_plan: 'full',
  });

  // Rules.
  if (nights < 1) violations.push('min_nights');
  const minNights = resolveMinNights(plan, days.get(checkIn));
  if (nights >= 1 && nights < minNights) violations.push('min_nights');
  if (plan.max_nights != null && num(plan.max_nights, 0) > 0 && nights > num(plan.max_nights)) {
    violations.push('max_nights');
  }
  if (nightly.some((n) => days.get(n.date)?.closed)) violations.push('closed_night');
  if (plan.max_occupancy != null && num(plan.max_occupancy, 0) > 0 && guests > num(plan.max_occupancy)) {
    violations.push('over_occupancy');
  }
  const today = todayInEastern(now);
  const noticeHours = Math.max(0, num(plan.advance_notice_hours, 0));
  const checkInMs = zonedTimeToMs(checkIn, plan.checkin_time ?? '16:00', timeZone);
  if (checkIn < today || checkInMs - now.getTime() < noticeHours * 3_600_000) {
    violations.push('advance_notice');
  }
  const windowDays = num(plan.booking_window_days, 0);
  if (windowDays > 0 && nightsBetween(today, checkIn) > windowDays) violations.push('booking_window');

  return {
    nights,
    nightly,
    accommodation_cents: accommodation,
    extra_guest_cents: extraGuestCents,
    cleaning_cents: cleaningCents,
    discount_cents: Math.min(discountCents, accommodation),
    discount_label: discountCents > 0 ? discountLabel : null,
    markup_cents: markupCents,
    taxable_base_cents: money.taxable_base_cents,
    tax_rate: resolved.rate,
    tax_exempt: resolved.exempt,
    tax_cents: money.tax_cents,
    subtotal_cents: money.subtotal_cents,
    total_cents: money.total_cents,
    currency: plan.currency || 'USD',
    violations: [...new Set(violations)],
  };
}
