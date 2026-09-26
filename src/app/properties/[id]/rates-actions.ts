'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { getFleetProperty } from '@/lib/fleet';
import { getRateDays, setRateDays, clearRateDays, upsertRatePlan, loadPricingBundle, type RateDayWrite, type RatePlanPatch } from '@/lib/property-rates';
import { quoteStay, isoWeekday, TaxJurisdictionUnknownError, type StayQuote, type TaxConfigRow } from '@/lib/rate-plan';
import { TAX_CONFIG_COLS } from '@/lib/tax-config';
import { isIsoDay, nightsBetween, shiftIsoDay } from '@/lib/sca-quotes-types';

/**
 * Server actions for the property Rates & taxes tab (RatesPanel.tsx).
 *
 * The plan and the per-day overrides go through src/lib/property-rates.ts;
 * the quote tester goes through src/lib/rate-plan.ts quoteStay. Nothing here
 * computes a price, and nothing here touches statements: these tables feed
 * direct quotes and the Helm calendar only.
 */

export type RatesFormState = { error: string | null; ok?: boolean; message?: string | null };

const str = (fd: FormData, key: string): string => (fd.get(key) ?? '').toString().trim();
const textOrNull = (fd: FormData, key: string): string | null => str(fd, key) || null;

/** Dollars typed by the operator -> integer cents; blank -> null. */
function dollarsToCents(fd: FormData, key: string): number | null {
  const raw = str(fd, key).replace(/[$,\s]/g, '');
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${key.replace(/_/g, ' ')} must be a non-negative amount`);
  return Math.round(n * 100);
}

function intOrNull(fd: FormData, key: string, min = 0, max = 100000): number | null {
  const raw = str(fd, key);
  if (!raw) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new Error(`${key.replace(/_/g, ' ')} must be a whole number`);
  return Math.max(min, Math.min(max, n));
}

function pctOrZero(fd: FormData, key: string): number {
  const raw = str(fd, key).replace(/%/g, '');
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`${key.replace(/_/g, ' ')} must be between 0 and 100`);
  return Math.round(n * 100) / 100;
}

/** A tax percentage typed as 15 -> 0.15 (4 places). */
function rateFromPct(fd: FormData, key: string): number {
  const raw = str(fd, key).replace(/%/g, '');
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`${key.replace(/_/g, ' ')} must be between 0 and 100`);
  return Math.round(n * 100) / 10000;
}

function hhmm(fd: FormData, key: string, fallback: string): string {
  const raw = str(fd, key);
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!m) return fallback;
  const h = Math.min(23, Math.max(0, Number(m[1])));
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

const CANCELLATION_KEYS = new Set(['sca_50_30', 'flexible', 'moderate', 'strict', 'non_refundable', 'custom']);

async function actor(): Promise<string | null> {
  const session = await auth();
  return session?.user?.email ?? null;
}

// ── Rate plan ───────────────────────────────────────────────────────────────

export async function saveRatePlanAction(propertyId: string, _prev: RatesFormState, fd: FormData): Promise<RatesFormState> {
  const by = await actor();
  if (!by) return { error: 'Not signed in' };
  if (!isServiceConfigured) return { error: 'Service role not configured' };
  try {
    const base = dollarsToCents(fd, 'base_nightly');
    if (base == null) return { error: 'A base nightly rate is required.' };
    const weekendDays = fd
      .getAll('weekend_days')
      .map((v) => parseInt(String(v), 10))
      .filter((d) => Number.isFinite(d) && d >= 0 && d <= 6);
    const key = str(fd, 'cancellation_policy_key');
    const patch: RatePlanPatch = {
      property_id: propertyId,
      currency: str(fd, 'currency') || 'USD',
      base_nightly_cents: base,
      weekend_nightly_cents: dollarsToCents(fd, 'weekend_nightly'),
      weekend_days: weekendDays,
      guests_included: intOrNull(fd, 'guests_included', 1, 50) ?? 2,
      extra_guest_cents_per_night: dollarsToCents(fd, 'extra_guest') ?? 0,
      cleaning_fee_cents: dollarsToCents(fd, 'cleaning_fee') ?? 0,
      pet_fee_cents: dollarsToCents(fd, 'pet_fee'),
      security_deposit_cents: dollarsToCents(fd, 'security_deposit'),
      weekly_discount_pct: pctOrZero(fd, 'weekly_discount_pct'),
      monthly_discount_pct: pctOrZero(fd, 'monthly_discount_pct'),
      direct_markup_pct: pctOrZero(fd, 'direct_markup_pct'),
      min_nights_default: intOrNull(fd, 'min_nights_default', 1, 365) ?? 2,
      max_nights: intOrNull(fd, 'max_nights', 1, 3650),
      advance_notice_hours: intOrNull(fd, 'advance_notice_hours', 0, 8760) ?? 24,
      booking_window_days: intOrNull(fd, 'booking_window_days', 0, 3650) ?? 365,
      turnover_buffer_days: intOrNull(fd, 'turnover_buffer_days', 0, 30) ?? 0,
      checkin_time: hhmm(fd, 'checkin_time', '16:00'),
      checkout_time: hhmm(fd, 'checkout_time', '11:00'),
      max_occupancy: intOrNull(fd, 'max_occupancy', 1, 100),
      pets_allowed: fd.get('pets_allowed') === 'on',
      quiet_hours: textOrNull(fd, 'quiet_hours'),
      cancellation_policy_key: CANCELLATION_KEYS.has(key) ? key : 'sca_50_30',
      cancellation_terms: textOrNull(fd, 'cancellation_terms'),
      house_rules: textOrNull(fd, 'house_rules'),
    };
    await upsertRatePlan(patch, by);
    revalidatePath(`/properties/${propertyId}`);
    return { error: null, ok: true, message: 'Rate plan saved.' };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Save failed' };
  }
}

// ── Tax config ──────────────────────────────────────────────────────────────

export async function saveTaxConfigAction(propertyId: string, _prev: RatesFormState, fd: FormData): Promise<RatesFormState> {
  const by = await actor();
  if (!by) return { error: 'Not signed in' };
  if (!isServiceConfigured) return { error: 'Service role not configured' };
  try {
    const jurisdiction = str(fd, 'jurisdiction').toUpperCase();
    if (!['MA', 'CT', 'FL'].includes(jurisdiction)) return { error: 'Pick a jurisdiction (MA, CT or FL).' };
    const applies = fd
      .getAll('applies_to')
      .map(String)
      .filter((a) => a === 'accommodation' || a === 'cleaning');
    if (applies.length === 0) return { error: 'The tax must apply to at least the accommodation.' };
    const collected = fd
      .getAll('collected_by_channels')
      .map((v) => String(v).toLowerCase().trim())
      .filter(Boolean);
    const row: Record<string, unknown> = {
      property_id: propertyId,
      jurisdiction,
      state_rate: rateFromPct(fd, 'state_pct'),
      local_rate: rateFromPct(fd, 'local_pct'),
      cif_rate: rateFromPct(fd, 'cif_pct'),
      applies_to: applies,
      long_stay_exempt_over_nights: intOrNull(fd, 'long_stay_exempt_over_nights', 0, 3650),
      collected_by_channels: [...new Set(collected)].sort(),
      notes: textOrNull(fd, 'notes'),
      updated_by: by,
      updated_at: new Date().toISOString(),
    };
    const effective = str(fd, 'effective_from');
    if (isIsoDay(effective)) row.effective_from = effective;
    const { error } = await supabaseAdmin.from('property_tax_config').upsert(row, { onConflict: 'property_id' }).select(TAX_CONFIG_COLS).single();
    if (error) return { error: `Save failed: ${error.message}` };
    revalidatePath(`/properties/${propertyId}`);
    return { error: null, ok: true, message: 'Tax config saved.' };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Save failed' };
  }
}

// ── Seasons: bulk day overrides ─────────────────────────────────────────────

const MAX_SEASON_DAYS = 731;

function parseRange(fd: FormData): { from: string; to: string } {
  const from = str(fd, 'from');
  const to = str(fd, 'to');
  if (!isIsoDay(from) || !isIsoDay(to)) throw new Error('Pick a start and an end date.');
  if (to < from) throw new Error('The end date is before the start date.');
  if (nightsBetween(from, to) + 1 > MAX_SEASON_DAYS) throw new Error(`A season write covers at most ${MAX_SEASON_DAYS} days.`);
  return { from, to };
}

/**
 * Write one rule across a date range: nightly rate and / or min nights and /
 * or closed / arrival / departure restrictions, on the chosen weekdays.
 * Fields left blank keep whatever the day already has (read-merge-write, per
 * setRateDays' note), so a price season does not wipe a min-nights season.
 */
export async function writeSeasonAction(propertyId: string, _prev: RatesFormState, fd: FormData): Promise<RatesFormState> {
  const by = await actor();
  if (!by) return { error: 'Not signed in' };
  if (!isServiceConfigured) return { error: 'Service role not configured' };
  try {
    const { from, to } = parseRange(fd);
    const nightly = dollarsToCents(fd, 'nightly');
    const minNights = intOrNull(fd, 'min_nights', 1, 365);
    const closedMode = str(fd, 'closed_mode'); // '' keep | 'close' | 'open'
    const ctaMode = str(fd, 'cta_mode');
    const ctdMode = str(fd, 'ctd_mode');
    const note = textOrNull(fd, 'note');
    const weekdays = new Set(
      fd
        .getAll('weekdays')
        .map((v) => parseInt(String(v), 10))
        .filter((d) => Number.isFinite(d) && d >= 0 && d <= 6),
    );
    if (weekdays.size === 0) return { error: 'Pick at least one day of the week.' };
    if (nightly == null && minNights == null && !closedMode && !ctaMode && !ctdMode && !note) {
      return { error: 'Set a rate, a minimum stay, a restriction or a note before writing the season.' };
    }

    const existing = new Map((await getRateDays(propertyId, from, to)).map((d) => [d.date, d]));
    const rows: RateDayWrite[] = [];
    for (let d = from; d <= to; d = shiftIsoDay(d, 1)) {
      if (!weekdays.has(isoWeekday(d))) continue;
      const cur = existing.get(d);
      rows.push({
        property_id: propertyId,
        date: d,
        nightly_cents: nightly ?? cur?.nightly_cents ?? null,
        min_nights: minNights ?? cur?.min_nights ?? null,
        closed: closedMode === 'close' ? true : closedMode === 'open' ? false : (cur?.closed ?? false),
        cta: ctaMode === 'set' ? true : ctaMode === 'clear' ? false : (cur?.cta ?? false),
        ctd: ctdMode === 'set' ? true : ctdMode === 'clear' ? false : (cur?.ctd ?? false),
        note: note ?? cur?.note ?? null,
        source: 'operator',
      });
    }
    const written = await setRateDays(rows, by);
    revalidatePath(`/properties/${propertyId}`);
    return { error: null, ok: true, message: `${written} day${written === 1 ? '' : 's'} written (${from} to ${to}).` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Season write failed' };
  }
}

/** Drop every override in the range; the plan's own rate and rules return. */
export async function clearSeasonAction(propertyId: string, _prev: RatesFormState, fd: FormData): Promise<RatesFormState> {
  const by = await actor();
  if (!by) return { error: 'Not signed in' };
  if (!isServiceConfigured) return { error: 'Service role not configured' };
  try {
    const { from, to } = parseRange(fd);
    const cleared = await clearRateDays(propertyId, from, to);
    revalidatePath(`/properties/${propertyId}`);
    return { error: null, ok: true, message: `${cleared} override${cleared === 1 ? '' : 's'} cleared (${from} to ${to}).` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Clear failed' };
  }
}

// ── Quote tester ────────────────────────────────────────────────────────────

export type TestQuoteInput = { checkIn: string; checkOut: string; guests: number; channel: string };

export type TestQuoteResult =
  | { ok: true; quote: StayQuote; taxSource: 'config' | 'ma_legacy'; tax: TaxConfigRow | null }
  | { ok: false; error: string };

/** Price a stay exactly as /api/pms/quote and staycapeann.com would. */
export async function testQuoteAction(propertyId: string, input: TestQuoteInput): Promise<TestQuoteResult> {
  const by = await actor();
  if (!by) return { ok: false, error: 'Not signed in' };
  if (!isServiceConfigured) return { ok: false, error: 'Service role not configured' };
  const checkIn = String(input.checkIn ?? '').slice(0, 10);
  const checkOut = String(input.checkOut ?? '').slice(0, 10);
  if (!isIsoDay(checkIn) || !isIsoDay(checkOut)) return { ok: false, error: 'Pick check-in and checkout dates.' };
  if (checkOut <= checkIn) return { ok: false, error: 'Checkout must be after check-in.' };
  try {
    const [bundle, fleet] = await Promise.all([loadPricingBundle(propertyId, checkIn, checkOut), getFleetProperty(propertyId)]);
    if (!bundle.plan) return { ok: false, error: 'No rate plan yet. Save one above, then test a quote.' };
    const quote = quoteStay({
      plan: bundle.plan,
      days: bundle.days,
      tax: bundle.tax,
      checkIn,
      checkOut,
      guests: Math.max(1, Math.round(Number(input.guests) || 1)),
      channel: String(input.channel || 'direct'),
      region: fleet?.region ?? null,
      propertyId,
      timeZone: fleet?.timezone ?? 'America/New_York',
    });
    return { ok: true, quote, taxSource: bundle.tax ? 'config' : 'ma_legacy', tax: bundle.tax };
  } catch (e) {
    if (e instanceof TaxJurisdictionUnknownError) {
      return { ok: false, error: 'No tax config for this home and it is not on Cape Ann. Save the tax jurisdiction first; Helm will not guess 11.7%.' };
    }
    return { ok: false, error: e instanceof Error ? e.message : 'Quote failed' };
  }
}
