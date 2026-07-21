/**
 * Guesty per-day calendar sync + read: the data layer behind the Operations
 * calendar's hold intelligence and nightly-rate display.
 *
 * Guesty's availability/pricing calendar
 * (GET /v1/availability-pricing/api/calendar/listings/{listingId}) returns,
 * per day: status ('available' | 'unavailable' | 'booked'), the posted
 * nightly price, minNights, CTA/CTD flags, and — the part the iCal feed
 * flattens away — blockRefs describing WHY a day is unavailable:
 *
 *   type 'm'  manual block: carries the operator's typed note
 *             ("Carpet Cleaning"), a structured blockReason ("Maintenance"),
 *             createdBy (allie@risingtidestr.com) and createdAt.
 *   type 'o'  owner-portal block: createdBy is the owner's own email.
 *   type 'an' advance-notice artifact: Guesty exports TONIGHT as a 1-night
 *             block on every unbooked listing. Not a hold.
 *   type 'bw'/'b'/'bd'/'a'  booking-window / reservation-adjacent artifacts.
 *             The booking-window one shows up as a multi-year "block" at the
 *             end of the bookable horizon. Also not holds.
 *
 * Sync writes two tables:
 *   property_calendar_days   full per-day mirror (calendar UI reads this)
 *   property_calendar_blocks real-hold dates only (revenue occupancy
 *                            denominators + Field visit scheduling; the
 *                            original sync for it filtered on a status value
 *                            Guesty never returns — 'blocked' vs the real
 *                            'unavailable' — so it never wrote a row)
 *
 * Server-only: uses the service-role client and the Guesty OAuth token.
 */

import { supabaseAdmin } from './supabase-admin';
import { getGuestyToken, guestyGet, sleep } from './guesty-client';

/** Guesty block-ref types that represent a deliberate hold on the calendar
 *  (vs an availability-rule artifact). 'm' manual and 'o' owner-portal are
 *  the ones observed in Rising Tide's account; 'sr'/'abl'/'pt' are rare but
 *  deliberate, so they count too. */
const REAL_HOLD_TYPES = new Set(['m', 'o', 'sr', 'abl', 'pt']);

type GuestyBlockRef = {
  _id?: string;
  type?: string;
  startDate?: string;
  endDate?: string;
  blockReason?: string | null;
  note?: string | null;
  createdAt?: string;
  createdBy?: string;
};

type GuestyDay = {
  date?: string;
  status?: string;
  price?: number;
  currency?: string;
  minNights?: number;
  cta?: boolean;
  ctd?: boolean;
  note?: string | null;
  blockRefs?: GuestyBlockRef[];
};

type GuestyCalendarResponse = {
  days?: GuestyDay[];
  data?: { days?: GuestyDay[] };
};

export type CalendarDayRow = {
  property_id: string;
  date: string;
  status: string;
  price: number | null;
  currency: string | null;
  min_nights: number | null;
  cta: boolean;
  ctd: boolean;
  block_type: string | null;
  block_note: string | null;
  block_reason: string | null;
  block_created_by: string | null;
  block_created_at: string | null;
  block_ref_id: string | null;
  /** Guesty block range, INCLUSIVE end (last held day). */
  block_start: string | null;
  block_end: string | null;
};

export type CalendarDaysSyncResult = {
  listings_touched: number;
  days_written: number;
  hold_days: number;
  window: { startDate: string; endDate: string };
  errors?: string[];
};

/** listing_id -> property_id from the guesty_listings mapping table (already
 *  maintained by /api/sync-guesty's refreshListingMap). For callers like the
 *  channels-sync cron that don't carry their own map. */
export async function loadGuestyListingMap(): Promise<Record<string, string>> {
  const { data, error } = await supabaseAdmin
    .from('guesty_listings')
    .select('listing_id, property_id');
  if (error) throw new Error(`guesty_listings read: ${error.message}`);
  const map: Record<string, string> = {};
  for (const row of (data ?? []) as { listing_id: string | null; property_id: string | null }[]) {
    if (row.listing_id && row.property_id) map[row.listing_id] = row.property_id;
  }
  return map;
}

/** The best (most deliberate) block ref covering a day: manual first, then
 *  owner, then the rare deliberate types. Auto-rule refs never qualify. */
function pickHoldRef(refs: GuestyBlockRef[] | undefined): GuestyBlockRef | null {
  if (!refs || refs.length === 0) return null;
  const rank = (t: string | undefined): number =>
    t === 'm' ? 0 : t === 'o' ? 1 : t && REAL_HOLD_TYPES.has(t) ? 2 : 9;
  let best: GuestyBlockRef | null = null;
  let bestRank = 9;
  for (const r of refs) {
    const k = rank(r.type);
    if (k >= 9) continue;
    if (k < bestRank) {
      best = r;
      bestRank = k;
    } else if (k === bestRank && best && (r.createdAt ?? '') > (best.createdAt ?? '')) {
      // Same type twice on one day: the newer ref wins.
      best = r;
    }
  }
  return best;
}

function toDateOnly(v: string | undefined | null): string | null {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** One listing's calendar mapped to rows. Exported for the route that wants
 *  to fetch without writing (none today; the seam is deliberate for tests). */
export function mapGuestyDays(propertyId: string, days: GuestyDay[]): CalendarDayRow[] {
  const rows: CalendarDayRow[] = [];
  for (const day of days) {
    const date = toDateOnly(day.date);
    if (!date) continue;
    const rawStatus = (day.status ?? '').toLowerCase();
    // Older Guesty API surfaces reportedly said 'blocked'; current says
    // 'unavailable'. Normalize to the current vocabulary.
    const status =
      rawStatus === 'blocked' ? 'unavailable'
      : rawStatus === 'booked' || rawStatus === 'unavailable' || rawStatus === 'available' ? rawStatus
      : rawStatus || 'available';
    const holdRef = status === 'unavailable' ? pickHoldRef(day.blockRefs) : null;
    rows.push({
      property_id: propertyId,
      date,
      status,
      price: typeof day.price === 'number' && Number.isFinite(day.price) ? day.price : null,
      currency: day.currency ?? null,
      min_nights:
        typeof day.minNights === 'number' && Number.isFinite(day.minNights)
          ? Math.round(day.minNights)
          : null,
      cta: !!day.cta,
      ctd: !!day.ctd,
      block_type: holdRef?.type ?? null,
      // The day-level note mirrors the covering manual ref's note; prefer the
      // ref's own but fall back to the day's so a note is never dropped.
      block_note: holdRef ? (holdRef.note ?? day.note ?? null) : null,
      block_reason: holdRef?.blockReason ?? null,
      block_created_by: holdRef?.createdBy ?? null,
      block_created_at: holdRef?.createdAt ?? null,
      block_ref_id: holdRef?._id ?? null,
      block_start: holdRef ? toDateOnly(holdRef.startDate) : null,
      block_end: holdRef ? toDateOnly(holdRef.endDate) : null,
    });
  }
  return rows;
}

/**
 * Merge one property's per-listing day rows into a single row per date.
 * Several Guesty listings can map to one Helm property (17 Beach Road is a
 * Guesty multi-unit carrying three listings): writing each listing straight
 * to the (property_id, date) PK made the LAST listing win the days table
 * while the blocks rollup kept the union — one dark sub-listing painted the
 * whole property held. Policy: the property is available if ANY listing is
 * available (at the lowest bookable rate), booked if none are open but one
 * is booked, and held only when EVERY listing is dark that day (real-hold
 * ref preferred for the surviving row's block fields).
 */
export function mergeListingDays(perListing: CalendarDayRow[][]): CalendarDayRow[] {
  if (perListing.length <= 1) return perListing[0] ?? [];
  const byDate = new Map<string, CalendarDayRow[]>();
  for (const rows of perListing) {
    for (const r of rows) {
      const list = byDate.get(r.date) ?? [];
      list.push(r);
      byDate.set(r.date, list);
    }
  }
  const cheapest = (rows: CalendarDayRow[]): CalendarDayRow =>
    [...rows].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))[0];
  const clearBlock = (r: CalendarDayRow): CalendarDayRow => ({
    ...r,
    block_type: null,
    block_note: null,
    block_reason: null,
    block_created_by: null,
    block_created_at: null,
    block_ref_id: null,
    block_start: null,
    block_end: null,
  });
  const out: CalendarDayRow[] = [];
  for (const rows of byDate.values()) {
    const open = rows.filter((r) => r.status === 'available');
    const booked = rows.filter((r) => r.status === 'booked');
    if (open.length > 0) out.push(clearBlock(cheapest(open)));
    else if (booked.length > 0) out.push(clearBlock(cheapest(booked)));
    else out.push(rows.find((r) => r.block_type != null) ?? rows[0]);
  }
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

/**
 * Pull every mapped listing's calendar for [startDate, endDate] and refresh
 * both tables. Listings are grouped and merged per property (see
 * mergeListingDays) so multi-listing properties write once, coherently.
 * Stale rows inside the window (days Guesty no longer reports, holds that
 * were released) are swept AFTER the upsert by synced_at, so concurrent
 * readers never see an empty window mid-sync.
 */
export async function syncCalendarDays(
  listingMap: Record<string, string>,
  startDate: string,
  endDate: string,
): Promise<CalendarDaysSyncResult> {
  const token = await getGuestyToken();
  const runStartIso = new Date().toISOString();
  const errors: string[] = [];
  let listingsTouched = 0;
  let daysWritten = 0;
  let holdDays = 0;

  const listingsByProperty = new Map<string, string[]>();
  for (const [listingId, propertyId] of Object.entries(listingMap)) {
    const list = listingsByProperty.get(propertyId) ?? [];
    list.push(listingId);
    listingsByProperty.set(propertyId, list);
  }

  for (const [propertyId, listingIds] of listingsByProperty) {
    try {
      const perListing: CalendarDayRow[][] = [];
      for (const listingId of listingIds) {
        const data = await guestyGet<GuestyCalendarResponse>(
          `/v1/availability-pricing/api/calendar/listings/${listingId}`,
          token,
          { startDate, endDate },
        );
        const days = data?.days ?? data?.data?.days ?? [];
        perListing.push(mapGuestyDays(propertyId, days));
        listingsTouched += 1;
        await sleep(150); // polite pacing across ~16 listings
      }
      const rows = mergeListingDays(perListing).map((r) => ({
        ...r,
        synced_at: runStartIso,
      }));

      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const { error } = await supabaseAdmin
          .from('property_calendar_days')
          .upsert(chunk, { onConflict: 'property_id,date' });
        if (error) throw new Error(`days upsert: ${error.message}`);
      }

      const holdRows = rows
        .filter((r) => r.block_type != null)
        .map((r) => ({ property_id: r.property_id, date: r.date, synced_at: runStartIso }));
      if (holdRows.length > 0) {
        const { error } = await supabaseAdmin
          .from('property_calendar_blocks')
          .upsert(holdRows, { onConflict: 'property_id,date' });
        if (error) throw new Error(`blocks upsert: ${error.message}`);
      }

      // Sweep rows this run no longer observed (released holds, trimmed
      // horizon) — anything in-window still carrying an older synced_at.
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

      daysWritten += rows.length;
      holdDays += holdRows.length;
    } catch (err) {
      errors.push(`${propertyId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    listings_touched: listingsTouched,
    days_written: daysWritten,
    hold_days: holdDays,
    window: { startDate, endDate },
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Read the day mirror for a set of properties across a date window, keyed
 * property_id -> date -> row. Missing table / missing rows degrade to an
 * empty map — the calendar renders exactly as it did before this layer
 * existed, so the feature stays dark until the migration + first sync land.
 */
export async function loadCalendarDayMap(
  propertyIds: string[],
  startDate: string,
  endDate: string,
): Promise<Map<string, Map<string, CalendarDayRow>>> {
  const out = new Map<string, Map<string, CalendarDayRow>>();
  if (propertyIds.length === 0) return out;
  try {
    const { data, error } = await supabaseAdmin
      .from('property_calendar_days')
      .select(
        'property_id, date, status, price, currency, min_nights, cta, ctd, block_type, block_note, block_reason, block_created_by, block_created_at, block_ref_id, block_start, block_end',
      )
      .in('property_id', propertyIds)
      .gte('date', startDate)
      .lte('date', endDate);
    if (error) return out;
    for (const row of (data ?? []) as CalendarDayRow[]) {
      const m = out.get(row.property_id) ?? new Map<string, CalendarDayRow>();
      m.set(row.date, row);
      out.set(row.property_id, m);
    }
  } catch {
    // Table not applied yet / transient read failure: no day intelligence.
  }
  return out;
}
