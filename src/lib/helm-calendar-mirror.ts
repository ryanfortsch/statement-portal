/**
 * Helm writes its own calendar mirror for the homes it runs.
 *
 * Twelve readers depend on property_calendar_days and property_calendar_blocks
 * being fresh: calendar-holds' heldNightReason (through operations.ts and
 * maintenance-runs.ts), checkout-schedule's findGhostStays, extension-holds,
 * field-packets, launch-context's pricing_flowing derive, mine-checkout-
 * changes, onboarding-catalog, the property page, and revenue-snapshot's
 * occupancy denominator on property_calendar_blocks. For a Guesty-run home
 * calendar-days.ts fills both tables from Guesty's per-day calendar. Once a
 * home's properties.calendar_authority flips to 'helm' that sync skips it
 * (opts.skipPropertyIds), and THIS module becomes the only writer for it,
 * producing rows in the exact shape calendar-days.ts writes so every reader
 * keeps working with no dark window and no code change.
 *
 * Source of truth for a Helm-run day, in priority order:
 *   1. a canonical confirmed / completed stay covers the night  -> 'booked'
 *   2. a canonical block covers it                              -> 'unavailable',
 *      block_type 'o' when hold_kind is owner, else 'm' (Guesty's manual
 *      ref), block_note = notes, block_created_by = created_by, block_ref_id
 *      = the booking id, block_start = check_in, block_end = check_out - 1
 *      (Guesty's endDate is the last HELD day, inclusive; readers already
 *      convert)
 *   3. the rate day is closed                                   -> 'unavailable' 'm' 'Closed'
 *   4. off season per property_rental_periods                   -> 'unavailable' 'sr' 'Off season'
 *   5. otherwise                                                -> 'available'
 * with price = nightly cents / 100, currency, min_nights, cta and ctd from
 * the rate plan and its day overrides. Guesty's own advance-notice and
 * booking-window artifacts ('an' / 'bw') are deliberately NOT reproduced:
 * they were never holds, and readers treat 'unavailable' with a null
 * block_type as an artifact anyway.
 *
 * Writing follows syncCalendarDays to the letter: upsert the days in 500s,
 * upsert the block rows (every day with a block_type, as REAL_HOLD_TYPES
 * defines them), then sweep in-window rows of THOSE properties whose
 * synced_at predates this run, both tables, so a concurrent reader never sees
 * an empty window and a released hold disappears. The writer refuses to touch
 * a property that is not helm-run, because a sweep there would delete
 * Guesty's rows.
 *
 * buildHelmCalendarDays is pure (src/lib/__tests__/helm-calendar-mirror.test.ts);
 * the two writers below are the database edge. Relative imports and no
 * 'server-only' marker so node:test can load the file; only server code
 * imports it.
 */

import { supabaseAdmin, isServiceConfigured } from './supabase-admin.ts';
import { selectAllPaged } from './paged-select.ts';
import { isOpenOn, type RentalPeriod } from './rental-periods.ts';
import { shiftIsoDay, todayInEastern } from './sca-quotes-types.ts';
import { resolveMinNights, resolveNightlyCents, stayNights, type RateDayRow, type RatePlanRow } from './rate-plan.ts';
import { loadPricingBundle } from './property-rates.ts';
import type { CalendarDayRow } from './calendar-days.ts';

export type { CalendarDayRow };

/** The slice of a bookings row the mirror reads. Canonical rows only. */
export type MirrorBooking = {
  id: string;
  status: string;
  check_in: string;
  check_out: string;
  duplicate_of?: string | null;
  hold_kind?: string | null;
  notes?: string | null;
  created_by?: string | null;
  booked_at?: string | null;
  first_seen_at?: string | null;
};

export const MIRROR_BOOKING_COLS =
  'id, status, check_in, check_out, duplicate_of, hold_kind, notes, created_by, booked_at, first_seen_at';

const STAY_STATUSES: ReadonlySet<string> = new Set(['confirmed', 'completed']);

const HOLD_REASON_LABEL: Record<string, string> = {
  owner: 'Owner stay',
  maintenance: 'Maintenance',
  ota: 'Channel block',
  other: 'Block',
};

export type BuildHelmCalendarDaysInput = {
  propertyId: string;
  /** Inclusive ISO window. */
  start: string;
  end: string;
  bookings: readonly MirrorBooking[];
  plan: RatePlanRow | null;
  rateDays: Map<string, RateDayRow>;
  rentalPeriods: readonly RentalPeriod[];
};

const emptyBlock = {
  block_type: null,
  block_note: null,
  block_reason: null,
  block_created_by: null,
  block_created_at: null,
  block_ref_id: null,
  block_start: null,
  block_end: null,
} as const;

/**
 * One CalendarDayRow per date in [start, end], in the shape calendar-days.ts
 * writes for a Guesty home. synced_at is stamped by the writer, not here.
 */
export function buildHelmCalendarDays(input: BuildHelmCalendarDaysInput): CalendarDayRow[] {
  const start = input.start.slice(0, 10);
  const end = input.end.slice(0, 10);
  if (start > end) return [];
  const { plan } = input;

  // Night -> covering stay / block. Earliest check-in wins a night two rows
  // both claim (which the advisory-locked writer should already prevent).
  const stayNightSet = new Set<string>();
  const blockByNight = new Map<string, MirrorBooking>();
  const canonical = input.bookings
    .filter((b) => !b.duplicate_of)
    .slice()
    .sort((a, b) => (a.check_in < b.check_in ? -1 : a.check_in > b.check_in ? 1 : 0));
  for (const b of canonical) {
    const status = String(b.status ?? '').toLowerCase();
    if (STAY_STATUSES.has(status)) {
      for (const night of stayNights(b.check_in, b.check_out)) stayNightSet.add(night);
    } else if (status === 'block') {
      for (const night of stayNights(b.check_in, b.check_out)) {
        if (!blockByNight.has(night)) blockByNight.set(night, b);
      }
    }
  }

  const currency = plan?.currency || 'USD';
  const rows: CalendarDayRow[] = [];
  for (let date = start; date <= end && rows.length < 3660; date = shiftIsoDay(date, 1)) {
    const day = input.rateDays.get(date) ?? null;
    const base: Omit<CalendarDayRow, keyof typeof emptyBlock | 'status'> = {
      property_id: input.propertyId,
      date,
      price: plan ? resolveNightlyCents(plan, day, date) / 100 : null,
      currency: plan ? currency : null,
      min_nights: plan ? resolveMinNights(plan, day) : null,
      cta: !!day?.cta,
      ctd: !!day?.ctd,
    };

    if (stayNightSet.has(date)) {
      rows.push({ ...base, status: 'booked', ...emptyBlock });
      continue;
    }

    const block = blockByNight.get(date);
    if (block) {
      const kind = String(block.hold_kind ?? '').toLowerCase();
      rows.push({
        ...base,
        status: 'unavailable',
        block_type: kind === 'owner' ? 'o' : 'm',
        block_note: block.notes ?? null,
        block_reason: kind ? HOLD_REASON_LABEL[kind] ?? null : null,
        block_created_by: block.created_by ?? null,
        block_created_at: block.booked_at ?? block.first_seen_at ?? null,
        block_ref_id: block.id,
        block_start: block.check_in.slice(0, 10),
        // Guesty's endDate is the last held day, inclusive.
        block_end: shiftIsoDay(block.check_out.slice(0, 10), -1),
      });
      continue;
    }

    if (day?.closed) {
      rows.push({
        ...base,
        status: 'unavailable',
        block_type: 'm',
        block_note: day.note ?? 'Closed',
        block_reason: 'Closed',
        block_created_by: day.updated_by ?? null,
        block_created_at: day.updated_at ?? null,
        block_ref_id: null,
        block_start: date,
        block_end: date,
      });
      continue;
    }

    if (!isOpenOn(input.rentalPeriods, date)) {
      rows.push({
        ...base,
        status: 'unavailable',
        block_type: 'sr',
        block_note: 'Off season',
        block_reason: 'Off season',
        block_created_by: null,
        block_created_at: null,
        block_ref_id: null,
        block_start: date,
        block_end: date,
      });
      continue;
    }

    rows.push({ ...base, status: 'available', ...emptyBlock });
  }
  return rows;
}

// ── Writers ─────────────────────────────────────────────────────────────────

export type HelmMirrorResult = {
  properties_written: number;
  days_written: number;
  hold_days: number;
  window: { startDate: string; endDate: string };
  /** Ids the caller passed that are NOT helm-run: refused, never swept. */
  skipped_guesty_run: string[];
  errors: string[];
};

async function loadCanonicalBookings(propertyId: string, start: string, end: string): Promise<MirrorBooking[]> {
  return selectAllPaged<MirrorBooking>(
    (a, b) =>
      supabaseAdmin
        .from('bookings')
        .select(MIRROR_BOOKING_COLS)
        .eq('property_id', propertyId)
        .is('duplicate_of', null)
        .in('status', ['confirmed', 'completed', 'block'])
        .lte('check_in', end)
        .gt('check_out', start)
        .order('check_in', { ascending: true })
        .order('id', { ascending: true })
        .range(a, b),
    { label: `mirror bookings ${propertyId}` },
  );
}

/**
 * Which of the requested ids Helm actually runs. Read fresh every call: the
 * cutover action calls this right after flipping the switch. A failed read
 * confirms nothing, so nothing is written.
 */
async function confirmHelmRun(propertyIds: readonly string[]): Promise<{ helm: string[]; other: string[]; error?: string }> {
  const { data, error } = await supabaseAdmin
    .from('properties')
    .select('id, calendar_authority')
    .in('id', [...propertyIds]);
  if (error) return { helm: [], other: [...propertyIds], error: `properties read: ${error.message}` };
  const helm = new Set(
    ((data ?? []) as Array<{ id: string; calendar_authority: string | null }>)
      .filter((r) => r.calendar_authority === 'helm')
      .map((r) => r.id),
  );
  return {
    helm: propertyIds.filter((id) => helm.has(id)),
    other: propertyIds.filter((id) => !helm.has(id)),
  };
}

/**
 * Rebuild the mirror for helm-run properties across [start, end]: upsert
 * days, upsert block rows, then sweep stale rows by synced_at for those
 * properties only. Per-property failures collect in `errors`; the rest of
 * the set still writes.
 */
export async function writeHelmCalendarMirror(
  propertyIds: Iterable<string>,
  start: string,
  end: string,
): Promise<HelmMirrorResult> {
  const ids = [...new Set([...propertyIds].filter(Boolean))];
  const startDate = start.slice(0, 10);
  const endDate = end.slice(0, 10);
  const result: HelmMirrorResult = {
    properties_written: 0,
    days_written: 0,
    hold_days: 0,
    window: { startDate, endDate },
    skipped_guesty_run: [],
    errors: [],
  };
  if (ids.length === 0) return result;
  if (!isServiceConfigured) {
    result.errors.push('service role not configured');
    return result;
  }
  if (startDate > endDate) {
    result.errors.push(`window reversed: ${startDate} > ${endDate}`);
    return result;
  }

  const gate = await confirmHelmRun(ids);
  if (gate.error) result.errors.push(gate.error);
  result.skipped_guesty_run = gate.other;

  for (const propertyId of gate.helm) {
    // One stamp per property so a slow fleet loop cannot sweep a sibling's
    // rows written seconds earlier in the same run.
    const runStartIso = new Date().toISOString();
    try {
      const [bookings, bundle] = await Promise.all([
        loadCanonicalBookings(propertyId, startDate, endDate),
        loadPricingBundle(propertyId, startDate, endDate),
      ]);
      const rows = buildHelmCalendarDays({
        propertyId,
        start: startDate,
        end: endDate,
        bookings,
        plan: bundle.plan,
        rateDays: bundle.days,
        rentalPeriods: bundle.periods,
      }).map((r) => ({ ...r, synced_at: runStartIso }));

      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const { error } = await supabaseAdmin.from('property_calendar_days').upsert(chunk, { onConflict: 'property_id,date' });
        if (error) throw new Error(`days upsert: ${error.message}`);
      }

      const holdRows = rows
        .filter((r) => r.block_type != null)
        .map((r) => ({ property_id: r.property_id, date: r.date, synced_at: runStartIso }));
      for (let i = 0; i < holdRows.length; i += 500) {
        const chunk = holdRows.slice(i, i + 500);
        const { error } = await supabaseAdmin.from('property_calendar_blocks').upsert(chunk, { onConflict: 'property_id,date' });
        if (error) throw new Error(`blocks upsert: ${error.message}`);
      }

      // Sweep what this run did not write: a released hold, a day that
      // stopped being a block. Same window, same property, older stamp.
      const { error: sweepDaysErr } = await supabaseAdmin
        .from('property_calendar_days')
        .delete()
        .eq('property_id', propertyId)
        .gte('date', startDate)
        .lte('date', endDate)
        .lt('synced_at', runStartIso);
      if (sweepDaysErr) throw new Error(`days sweep: ${sweepDaysErr.message}`);
      const { error: sweepBlocksErr } = await supabaseAdmin
        .from('property_calendar_blocks')
        .delete()
        .eq('property_id', propertyId)
        .gte('date', startDate)
        .lte('date', endDate)
        .lt('synced_at', runStartIso);
      if (sweepBlocksErr) throw new Error(`blocks sweep: ${sweepBlocksErr.message}`);

      result.properties_written += 1;
      result.days_written += rows.length;
      result.hold_days += holdRows.length;
    } catch (err) {
      result.errors.push(`${propertyId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return result;
}

/**
 * After one booking changes (created, moved, cancelled, blocked), refresh
 * the mirror for just its property across check_in - 1 .. check_out, so a
 * hold shows up named on the Operations calendar without waiting for the
 * next cron. Returns null when the booking cannot be found; the writer
 * itself refuses a property Helm does not run.
 */
export async function refreshMirrorForBooking(bookingId: string): Promise<HelmMirrorResult | null> {
  if (!isServiceConfigured || !bookingId) return null;
  const { data, error } = await supabaseAdmin
    .from('bookings')
    .select('id, property_id, check_in, check_out')
    .eq('id', bookingId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { property_id: string; check_in: string; check_out: string };
  const start = shiftIsoDay(row.check_in.slice(0, 10), -1);
  const end = row.check_out.slice(0, 10);
  return writeHelmCalendarMirror([row.property_id], start, end);
}

/** today-N .. today+M in America/New_York, the window the crons pass. */
export function mirrorWindow(daysBack: number, daysForward: number, now: Date = new Date()): { start: string; end: string } {
  const today = todayInEastern(now);
  return { start: shiftIsoDay(today, -Math.abs(daysBack)), end: shiftIsoDay(today, Math.abs(daysForward)) };
}
