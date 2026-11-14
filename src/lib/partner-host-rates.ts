/**
 * A partner home's host sets their own prices on staycapeann.com/host/rates.
 *
 * The prices are the home's own Helm rate plan and day rows, the same two
 * stores every quote reads (property_rate_plans, property_rate_days through
 * rate-plan.ts's resolveNight): there is no second price for a host. A host
 * edits four plan lines (the nightly price, a weekend price, the minimum
 * stay, the cleaning fee) and seasons (a price and / or a minimum stay
 * across dates). Everything else on the plan (guests included, discounts,
 * markups, taxes, policy) stays the office's.
 *
 * Only a partner home of theirs, through the bridge with their session,
 * recorded as hostActor's host:<email>. Helm's own "only an owner sets a
 * nightly price" rule is about Helm logins on homes we run; a partner home's
 * money is the host's (CLAUDE.md, Partner home payments).
 *
 * PURE MODULE: no env, no database, no server-only imports.
 */
import type { RateDayRow, RatePlanRow } from './rate-plan.ts';
import { displayTitle, isIsoDay, shiftIsoDay } from './sca-quotes-types.ts';

/** What a host may set, in cents and nights. */
export const HOST_RATE_LIMITS = {
  minNightlyCents: 2_500,
  maxNightlyCents: 2_000_000,
  maxCleaningCents: 200_000,
  maxMinNights: 30,
  /** One season write covers at most this many nights. */
  maxSeasonNights: 366,
  /** A season starts today or later and ends within this many days. */
  aheadDays: 400,
} as const;

/** The seasons the page lists: today and the next year. */
export const HOST_SEASON_WINDOW_DAYS = 366;

export type HostPlanView = {
  base_cents: number;
  weekend_cents: number | null;
  /** 0 = Sunday .. 6 = Saturday: the nights the weekend price falls on. */
  weekend_days: number[];
  min_nights: number;
  cleaning_cents: number;
  currency: string;
};

export type HostSeason = {
  from: string;
  /** The last night, inclusive. */
  to: string;
  nights: number;
  nightly_cents: number | null;
  min_nights: number | null;
};

export type HostRatesHome = {
  id: string;
  title: string;
  /** Null until the office (or the host) sets a first nightly price. */
  plan: HostPlanView | null;
  seasons: HostSeason[];
};

export type HostPlanInput = {
  base_cents: number;
  weekend_cents: number | null;
  min_nights: number;
  cleaning_cents: number;
};

export type HostSeasonInput = {
  from: string;
  /** The last night, inclusive. */
  to: string;
  nightly_cents: number | null;
  min_nights: number | null;
  /** Back to the plan: the dates lose their own price and minimum. */
  clear: boolean;
};

type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

const L = HOST_RATE_LIMITS;

function centsIn(v: unknown, lo: number, hi: number): number | null | undefined {
  if (v == null || v === '') return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) return undefined;
  return v;
}

function nightsIn(v: unknown): number | null | undefined {
  if (v == null || v === '') return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > L.maxMinNights) return undefined;
  return v;
}

const dollars = (c: number) => `$${(c / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const PRICE_RANGE = `between ${dollars(L.minNightlyCents)} and ${dollars(L.maxNightlyCents)} a night`;

export function parseHostPlan(raw: unknown): Parsed<HostPlanInput> {
  const b = (raw ?? {}) as Record<string, unknown>;
  const base = centsIn(b.base_cents, L.minNightlyCents, L.maxNightlyCents);
  if (base == null) return { ok: false, reason: `Set a nightly price ${PRICE_RANGE}.` };
  const weekend = centsIn(b.weekend_cents, L.minNightlyCents, L.maxNightlyCents);
  if (weekend === undefined) return { ok: false, reason: `A weekend price is ${PRICE_RANGE}, or leave it empty.` };
  const min = nightsIn(b.min_nights);
  if (min == null) return { ok: false, reason: `Set a minimum stay of 1 to ${L.maxMinNights} nights.` };
  const cleaning = centsIn(b.cleaning_cents, 0, L.maxCleaningCents);
  if (cleaning === undefined) return { ok: false, reason: `A cleaning fee is at most ${dollars(L.maxCleaningCents)}.` };
  return { ok: true, value: { base_cents: base, weekend_cents: weekend, min_nights: min, cleaning_cents: cleaning ?? 0 } };
}

/** Whole nights from one ISO day to another (to minus from). */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function parseHostSeason(raw: unknown, today: string): Parsed<HostSeasonInput> {
  const b = (raw ?? {}) as Record<string, unknown>;
  const from = b.from;
  const to = b.to;
  if (!isIsoDay(from) || !isIsoDay(to)) return { ok: false, reason: 'Pick the first and the last night.' };
  if (to < from) return { ok: false, reason: 'The last night is before the first.' };
  if (from < today) return { ok: false, reason: 'A season starts today or later.' };
  if (daysBetween(today, to) > L.aheadDays) return { ok: false, reason: 'A season ends within about a year from today.' };
  if (daysBetween(from, to) + 1 > L.maxSeasonNights) return { ok: false, reason: `A season covers at most ${L.maxSeasonNights} nights.` };
  if (b.clear === true) return { ok: true, value: { from, to, nightly_cents: null, min_nights: null, clear: true } };
  const nightly = centsIn(b.nightly_cents, L.minNightlyCents, L.maxNightlyCents);
  if (nightly === undefined) return { ok: false, reason: `A season price is ${PRICE_RANGE}.` };
  const min = nightsIn(b.min_nights);
  if (min === undefined) return { ok: false, reason: `A minimum stay is 1 to ${L.maxMinNights} nights.` };
  if (nightly == null && min == null) return { ok: false, reason: 'Set a price, a minimum stay, or both.' };
  return { ok: true, value: { from, to, nightly_cents: nightly, min_nights: min, clear: false } };
}

/** A day row as setRateDays writes it. Same shape as property-rates.ts's RateDayWrite. */
export type HostRateDayWrite = {
  property_id: string;
  date: string;
  nightly_cents: number | null;
  min_nights: number | null;
  cta: boolean;
  ctd: boolean;
  closed: boolean;
  note: string | null;
  source: 'operator';
};

/**
 * The day rows a season writes. Read-merge-write: a price season keeps a
 * day's minimum, a minimum season keeps its price, and the office's closed,
 * arrival and departure flags and notes are never touched.
 */
export function hostSeasonRows(propertyId: string, input: HostSeasonInput, existing: readonly RateDayRow[]): HostRateDayWrite[] {
  const cur = new Map(existing.map((d) => [d.date, d]));
  const rows: HostRateDayWrite[] = [];
  for (let d = input.from; d <= input.to; d = shiftIsoDay(d, 1)) {
    const c = cur.get(d);
    rows.push({
      property_id: propertyId,
      date: d,
      nightly_cents: input.clear ? null : (input.nightly_cents ?? c?.nightly_cents ?? null),
      min_nights: input.clear ? null : (input.min_nights ?? c?.min_nights ?? null),
      cta: !!c?.cta,
      ctd: !!c?.ctd,
      closed: !!c?.closed,
      note: c?.note ?? null,
      source: 'operator',
    });
  }
  return rows;
}

/** Runs of consecutive nights sharing one price and minimum, from today on. Days with neither are the plan's. */
export function hostSeasons(days: readonly RateDayRow[], today: string): HostSeason[] {
  const out: HostSeason[] = [];
  const sorted = [...days].filter((d) => d.date >= today && (d.nightly_cents != null || d.min_nights != null)).sort((a, b) => a.date.localeCompare(b.date));
  for (const d of sorted) {
    const last = out.at(-1);
    if (last && shiftIsoDay(last.to, 1) === d.date && last.nightly_cents === d.nightly_cents && last.min_nights === d.min_nights) {
      last.to = d.date;
      last.nights += 1;
    } else {
      out.push({ from: d.date, to: d.date, nights: 1, nightly_cents: d.nightly_cents, min_nights: d.min_nights });
    }
  }
  return out;
}

export function hostPlanView(plan: RatePlanRow | null): HostPlanView | null {
  if (!plan) return null;
  return {
    base_cents: plan.base_nightly_cents,
    weekend_cents: plan.weekend_nightly_cents,
    weekend_days: [...plan.weekend_days].sort((a, b) => a - b),
    min_nights: plan.min_nights_default,
    cleaning_cents: plan.cleaning_fee_cents,
    currency: plan.currency,
  };
}

export function hostRatesHome(home: { id: string; title: string | null }, plan: RatePlanRow | null, days: readonly RateDayRow[], today: string): HostRatesHome {
  return {
    id: home.id,
    title: displayTitle(home.title) || 'Your home',
    plan: hostPlanView(plan),
    seasons: hostSeasons(days, today),
  };
}

/** The plan columns a host's save writes, and no others. */
export function hostPlanPatch(propertyId: string, input: HostPlanInput) {
  return {
    property_id: propertyId,
    base_nightly_cents: input.base_cents,
    weekend_nightly_cents: input.weekend_cents,
    min_nights_default: input.min_nights,
    cleaning_fee_cents: input.cleaning_cents,
  };
}
