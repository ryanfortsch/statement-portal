/**
 * Service-role edge for the Helm-native pricing tables: the rate plan, the
 * per-day overrides and the tax config, plus one bundle loader the quote
 * engine (rate-plan.ts), availability (availability.ts) and the calendar
 * mirror (helm-calendar-mirror.ts) all read from.
 *
 * The arithmetic lives in rate-plan.ts and is pure; nothing here computes a
 * price. Every table is RLS-locked to the service role
 * (supabase/migrations/20260926200000_helm_pms_plumbing.sql).
 *
 * Relative imports and no 'server-only' marker on purpose: the mirror
 * imports this file and node:test loads the mirror. It is only ever imported
 * from server code (routes, crons, server actions).
 */

import { supabaseAdmin, isServiceConfigured } from './supabase-admin.ts';
import { selectAllPaged } from './paged-select.ts';
import { normalizePeriod, type RentalPeriod } from './rental-periods.ts';
import { rateDayMap, type RateDayRow, type RatePlanRow, type TaxConfigRow } from './rate-plan.ts';
import { getTaxConfig } from './tax-config.ts';

export const RATE_PLAN_COLS =
  'property_id, currency, base_nightly_cents, weekend_nightly_cents, weekend_days, guests_included, extra_guest_cents_per_night, cleaning_fee_cents, pet_fee_cents, security_deposit_cents, weekly_discount_pct, monthly_discount_pct, direct_markup_pct, min_nights_default, max_nights, advance_notice_hours, booking_window_days, turnover_buffer_days, checkin_time, checkout_time, max_occupancy, pets_allowed, quiet_hours, cancellation_policy_key, cancellation_terms, house_rules, updated_by, created_at, updated_at';

export const RATE_DAY_COLS =
  'property_id, date, nightly_cents, min_nights, cta, ctd, closed, note, source, updated_by, updated_at';

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const numOrNull = (v: unknown): number | null => (v == null ? null : num(v, 0));

/** PostgREST hands numeric(5,2) back as strings; coerce once here. */
export function shapeRatePlan(raw: Record<string, unknown>): RatePlanRow {
  return {
    property_id: String(raw.property_id),
    currency: String(raw.currency ?? 'USD'),
    base_nightly_cents: num(raw.base_nightly_cents),
    weekend_nightly_cents: numOrNull(raw.weekend_nightly_cents),
    weekend_days: Array.isArray(raw.weekend_days) ? raw.weekend_days.map((d) => num(d, -1)) : [5, 6],
    guests_included: num(raw.guests_included, 2),
    extra_guest_cents_per_night: num(raw.extra_guest_cents_per_night),
    cleaning_fee_cents: num(raw.cleaning_fee_cents),
    pet_fee_cents: numOrNull(raw.pet_fee_cents),
    security_deposit_cents: numOrNull(raw.security_deposit_cents),
    weekly_discount_pct: num(raw.weekly_discount_pct),
    monthly_discount_pct: num(raw.monthly_discount_pct),
    direct_markup_pct: num(raw.direct_markup_pct),
    min_nights_default: num(raw.min_nights_default, 2),
    max_nights: numOrNull(raw.max_nights),
    advance_notice_hours: num(raw.advance_notice_hours, 24),
    booking_window_days: num(raw.booking_window_days, 365),
    turnover_buffer_days: num(raw.turnover_buffer_days),
    checkin_time: String(raw.checkin_time ?? '16:00'),
    checkout_time: String(raw.checkout_time ?? '11:00'),
    max_occupancy: numOrNull(raw.max_occupancy),
    pets_allowed: !!raw.pets_allowed,
    quiet_hours: (raw.quiet_hours as string | null | undefined) ?? null,
    cancellation_policy_key: String(raw.cancellation_policy_key ?? 'sca_50_30'),
    cancellation_terms: (raw.cancellation_terms as string | null | undefined) ?? null,
    house_rules: (raw.house_rules as string | null | undefined) ?? null,
    updated_by: (raw.updated_by as string | null | undefined) ?? null,
    created_at: raw.created_at ? String(raw.created_at) : undefined,
    updated_at: raw.updated_at ? String(raw.updated_at) : undefined,
  };
}

export function shapeRateDay(raw: Record<string, unknown>): RateDayRow {
  return {
    property_id: String(raw.property_id),
    date: String(raw.date).slice(0, 10),
    nightly_cents: numOrNull(raw.nightly_cents),
    min_nights: numOrNull(raw.min_nights),
    cta: !!raw.cta,
    ctd: !!raw.ctd,
    closed: !!raw.closed,
    note: (raw.note as string | null | undefined) ?? null,
    source: (String(raw.source ?? 'operator') as RateDayRow['source']),
    updated_by: (raw.updated_by as string | null | undefined) ?? null,
    updated_at: raw.updated_at ? String(raw.updated_at) : undefined,
  };
}

// ── Rate plan ───────────────────────────────────────────────────────────────

export async function getRatePlan(propertyId: string): Promise<RatePlanRow | null> {
  if (!isServiceConfigured || !propertyId) return null;
  const { data, error } = await supabaseAdmin
    .from('property_rate_plans')
    .select(RATE_PLAN_COLS)
    .eq('property_id', propertyId)
    .maybeSingle();
  if (error) throw new Error(`rate plan read ${propertyId}: ${error.message}`);
  return data ? shapeRatePlan(data as Record<string, unknown>) : null;
}

export type RatePlanPatch = Partial<Omit<RatePlanRow, 'property_id' | 'created_at' | 'updated_at' | 'updated_by'>> & {
  property_id: string;
};

/**
 * Create or update the one plan a property has. base_nightly_cents is NOT
 * NULL in the table, so a first write must carry it; a later patch may omit
 * it and only touches the columns it names.
 */
export async function upsertRatePlan(patch: RatePlanPatch, by: string): Promise<RatePlanRow> {
  if (!patch.property_id) throw new Error('upsertRatePlan: property_id is required');
  const existing = await getRatePlan(patch.property_id);
  if (!existing && patch.base_nightly_cents == null) {
    throw new Error(`upsertRatePlan: ${patch.property_id} has no plan yet; base_nightly_cents is required`);
  }
  const row: Record<string, unknown> = { ...patch, updated_by: by, updated_at: new Date().toISOString() };
  const { data, error } = await supabaseAdmin
    .from('property_rate_plans')
    .upsert(row, { onConflict: 'property_id' })
    .select(RATE_PLAN_COLS)
    .single();
  if (error) throw new Error(`rate plan upsert ${patch.property_id}: ${error.message}`);
  return shapeRatePlan(data as Record<string, unknown>);
}

// ── Rate days ───────────────────────────────────────────────────────────────

/** Per-day overrides in [from, to] inclusive, paged, ordered by date. */
export async function getRateDays(propertyId: string, from: string, to: string): Promise<RateDayRow[]> {
  if (!isServiceConfigured || !propertyId) return [];
  const rows = await selectAllPaged<Record<string, unknown>>(
    (a, b) =>
      supabaseAdmin
        .from('property_rate_days')
        .select(RATE_DAY_COLS)
        .eq('property_id', propertyId)
        .gte('date', from.slice(0, 10))
        .lte('date', to.slice(0, 10))
        .order('date', { ascending: true })
        .range(a, b),
    { label: `rate days ${propertyId}` },
  );
  return rows.map(shapeRateDay);
}

export type RateDayWrite = {
  property_id: string;
  date: string;
  nightly_cents?: number | null;
  min_nights?: number | null;
  cta?: boolean;
  ctd?: boolean;
  closed?: boolean;
  note?: string | null;
  source?: RateDayRow['source'];
};

/**
 * Upsert a batch of day rows (property_id, date), 500 at a time. Returns the
 * number written. A row that names only some columns leaves the others at
 * their defaults on insert and overwrites them on conflict, so callers
 * setting one field on an existing day should read-merge-write.
 */
export async function setRateDays(rows: readonly RateDayWrite[], by: string): Promise<number> {
  if (rows.length === 0) return 0;
  const stamp = new Date().toISOString();
  const payload = rows.map((r) => ({
    property_id: r.property_id,
    date: r.date.slice(0, 10),
    nightly_cents: r.nightly_cents ?? null,
    min_nights: r.min_nights ?? null,
    cta: !!r.cta,
    ctd: !!r.ctd,
    closed: !!r.closed,
    note: r.note ?? null,
    source: r.source ?? 'operator',
    updated_by: by,
    updated_at: stamp,
  }));
  let written = 0;
  for (let i = 0; i < payload.length; i += 500) {
    const chunk = payload.slice(i, i + 500);
    const { error } = await supabaseAdmin.from('property_rate_days').upsert(chunk, { onConflict: 'property_id,date' });
    if (error) throw new Error(`rate days upsert: ${error.message}`);
    written += chunk.length;
  }
  return written;
}

/** Drop every override in [from, to] inclusive; the plan's own rate returns. */
export async function clearRateDays(propertyId: string, from: string, to: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('property_rate_days')
    .delete()
    .eq('property_id', propertyId)
    .gte('date', from.slice(0, 10))
    .lte('date', to.slice(0, 10))
    .select('date');
  if (error) throw new Error(`rate days clear ${propertyId}: ${error.message}`);
  return (data ?? []).length;
}

// ── Rental periods (read here rather than through property-rental-periods.ts,
//    which carries the 'server-only' marker node:test cannot load) ──────────

async function readRentalPeriods(propertyId: string): Promise<RentalPeriod[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('property_rental_periods')
      .select('start_month, start_day, end_month, end_day, note')
      .eq('property_id', propertyId)
      .order('start_month', { ascending: true })
      .order('start_day', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r) =>
      normalizePeriod({
        startMonth: r.start_month,
        startDay: r.start_day,
        endMonth: r.end_month,
        endDay: r.end_day,
        note: r.note,
      }),
    );
  } catch {
    // Unreadable = open year-round, the default every un-stamped home has.
    return [];
  }
}

// ── The bundle ──────────────────────────────────────────────────────────────

export type PricingBundle = {
  plan: RatePlanRow | null;
  /** Overrides in the window keyed by ISO date. */
  days: Map<string, RateDayRow>;
  tax: TaxConfigRow | null;
  periods: RentalPeriod[];
};

/** Everything a quote, an availability read or a mirror write needs, in one call. */
export async function loadPricingBundle(propertyId: string, from: string, to: string): Promise<PricingBundle> {
  if (!isServiceConfigured) return { plan: null, days: new Map(), tax: null, periods: [] };
  const [plan, dayRows, tax, periods] = await Promise.all([
    getRatePlan(propertyId),
    getRateDays(propertyId, from, to),
    getTaxConfig(propertyId),
    readRentalPeriods(propertyId),
  ]);
  return { plan, days: rateDayMap(dayRows), tax, periods };
}
