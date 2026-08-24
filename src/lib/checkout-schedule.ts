/**
 * The checkout-schedule brain: for any date, WHO checks out, at WHAT TIME,
 * and whether the same day brings a new arrival.
 *
 * The cleaners' problem this solves: their source of truth is Guesty, but
 * Helm-side reality drifts from it daily. A late checkout gets agreed in
 * guest messaging ("sure, 11 is fine"), a stay extension is collected by
 * payment link and squared away in Guesty manually and late (verified: a
 * paid extension writes payment_link_requests + a work slip, never
 * bookings.check_out). Rosa plans tomorrow off a calendar that lies.
 *
 * Three layers merge here, in priority order:
 *   1. `checkout_adjustments` (status active) - per-stay divergence Helm
 *      knows about: a new checkout TIME (late/early checkout) and/or a new
 *      checkout DATE (extension / early departure). Written by the operator
 *      on /turnovers/schedule or auto-applied by the guest-thread miner
 *      (src/lib/mine-checkout-changes.ts). An extension MOVES the stay to
 *      its new day; the base day no longer lists it.
 *   2. `bookings` (Guesty-synced) - the base layer. Same stay-collapse
 *      rules as the turnover rail: dedupe by (property_id, check_in),
 *      prefer the row with a real guest name over ical placeholders,
 *      never trust duplicate_of alone.
 *   3. `properties.default_checkout_time` / `default_checkin_time` -
 *      per-property defaults (fill-empty synced from the Guesty listing's
 *      defaultCheckOutTime by /api/sync-guesty), falling back to
 *      10:00 / 16:00 when unset.
 *
 * Proposed (unapplied) miner adjustments ride along on each row so the
 * digest approval card and the schedule page can offer one-tap apply.
 *
 * Consumers: the daily digest cron (day-before SMS draft), the operator
 * schedule page (/turnovers/schedule), and Rosa's public mobile page
 * (/clean/<token>), which renders THIS live merge so the link in an
 * already-sent text never goes stale.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// Same exclusion set as lib/operations.ts NON_OPERATIONS_PROPERTY_IDS
// (file-local there): out-of-region homes whose owners handle their own
// turnovers. Rosa never cleans these.
export const SCHEDULE_EXCLUDED_PROPERTY_IDS = new Set<string>(['65_calderwood', '3246_ne_27th']);

// Mirrors operations.ts TURNOVER_STATUSES: stays that actually happen.
const STAY_STATUSES = ['confirmed', 'completed'];

const FALLBACK_CHECKOUT_TIME = '10:00';
const FALLBACK_CHECKIN_TIME = '16:00';

// ─── ET date helpers ──────────────────────────────────────────────────

const ET_DATE_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });

/** Today's calendar date in Gloucester (America/New_York), YYYY-MM-DD.
 *  Never use toISOString() for this: a 9pm-ET cron run is already
 *  tomorrow in UTC. */
export function todayET(): string {
  return ET_DATE_FMT.format(new Date());
}

/** date string + n days, DST-safe (noon-UTC anchor). */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "HH:MM" (24h) -> "10 AM" / "4:30 PM" for human surfaces. */
export function formatTime12(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const min = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return min === '00' ? `${h12} ${ampm}` : `${h12}:${min} ${ampm}`;
}

/** Loose time text -> canonical "HH:MM" 24h, or null. Accepts "11:00",
 *  "11", "11am", "11:30 PM", "16:00:00". */
export function normalizeTime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  const m = /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm)?$/.exec(t);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ?? '00';
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || Number(min) > 59) return null;
  return `${String(h).padStart(2, '0')}:${min}`;
}

// ─── types ────────────────────────────────────────────────────────────

/** operator = set by hand on /turnovers/schedule; miner = mined from a
 *  guest thread; guesty_hold = derived from a corroborated extension hold
 *  in the Guesty calendar mirror (src/lib/extension-holds.ts). */
export type AdjustmentSource = 'operator' | 'miner' | 'guesty_hold';

export type CheckoutAdjustment = {
  id: string;
  property_id: string;
  stay_check_in: string;
  original_check_out: string;
  adjusted_check_out: string | null;
  adjusted_checkout_time: string | null;
  note: string;
  source: AdjustmentSource;
  miner_key: string | null;
  evidence: string | null;
  confidence: 'high' | 'medium' | 'low' | null;
  status: 'proposed' | 'active' | 'dismissed' | 'superseded';
  created_by: string;
  created_at: string;
};

export type ScheduleRow = {
  propertyId: string;
  propertyName: string;
  address: string;
  city: string;
  guestName: string;
  checkIn: string;
  /** What bookings (Guesty) currently says. */
  baseCheckOut: string;
  /** After the active adjustment, if any. Equals the day it renders under. */
  effectiveCheckOut: string;
  /** Effective checkout time, HH:MM 24h. */
  time: string;
  /** The property default, for "was 10:00" context when time is adjusted. */
  defaultTime: string;
  sameDayTurnover: boolean;
  nextCheckinTime: string | null;
  nextGuestName: string | null;
  adjustment: {
    id: string;
    source: AdjustmentSource;
    note: string;
    adjustedTime: string | null;
    adjustedDate: string | null;
    evidence: string | null;
    /** bookings.check_out moved since this adjustment was written and no
     *  longer matches either side of it - the operator should re-check. */
    drifted: boolean;
  } | null;
  /** Unapplied miner proposals targeting this stay (one-tap apply). */
  proposals: CheckoutAdjustment[];
};

export type ScheduleDay = {
  date: string;
  rows: ScheduleRow[];
  counts: { checkouts: number; sameDay: number; adjusted: number; proposed: number };
};

type BookingLite = {
  id: string;
  property_id: string;
  check_in: string;
  check_out: string;
  guest_name: string | null;
  source: string;
};

type PropertyLite = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  default_checkout_time: string | null;
  default_checkin_time: string | null;
};

/** How an adjustment is described on the card and the schedule page. */
export function adjustmentSourceLabel(source: AdjustmentSource): string {
  if (source === 'miner') return 'from guest thread';
  if (source === 'guesty_hold') return 'from Guesty hold';
  return 'set by hand';
}

// ─── stay collapse ────────────────────────────────────────────────────

// Same placeholder test as the turnover rail (operations.ts guestNameScore):
// first token gives an ical placeholder away.
const PLACEHOLDER_FIRST_TOKEN = /^(reservation|tbd|guest|n\/a|hold|blocked|airbnb|vrbo|not)$/i;

function guestNameScore(name: string | null): number {
  const t = (name ?? '').trim();
  if (!t) return 0;
  return PLACEHOLDER_FIRST_TOKEN.test(t.split(/\s+/)[0]) ? 1 : 2;
}

/** bookings holds several rows per stay (guesty_legacy + ical placeholders;
 *  duplicate_of provably misses cross-source pairs). Collapse to one row
 *  per (property_id, check_in), preferring a real guest name, then a
 *  non-ical source. */
function collapseStays(rows: BookingLite[]): Map<string, BookingLite> {
  const byStay = new Map<string, BookingLite>();
  for (const r of rows) {
    const key = `${r.property_id}|${r.check_in}`;
    const prev = byStay.get(key);
    if (!prev) {
      byStay.set(key, r);
      continue;
    }
    const score = (b: BookingLite) =>
      guestNameScore(b.guest_name) * 10 + (b.source !== 'ical_import' ? 1 : 0);
    if (score(r) > score(prev)) byStay.set(key, r);
  }
  return byStay;
}

function displayGuestName(name: string | null): string {
  return guestNameScore(name) === 2 ? (name ?? '').trim() : '';
}

// ─── the brain ────────────────────────────────────────────────────────

export async function buildCheckoutSchedule(
  supabase: SupabaseClient,
  opts: { startDate: string; days: number },
): Promise<ScheduleDay[]> {
  const { startDate, days } = opts;
  const endDate = addDays(startDate, days - 1);

  const [propsRes, checkoutsRes, checkinsRes, adjRes] = await Promise.all([
    supabase
      .from('properties')
      .select('id, name, address, city, default_checkout_time, default_checkin_time, is_active, kind'),
    supabase
      .from('bookings')
      .select('id, property_id, check_in, check_out, guest_name, source')
      .gte('check_out', startDate)
      .lte('check_out', endDate)
      .in('status', STAY_STATUSES)
      .is('duplicate_of', null),
    supabase
      .from('bookings')
      .select('id, property_id, check_in, check_out, guest_name, source')
      .gte('check_in', startDate)
      .lte('check_in', endDate)
      .in('status', STAY_STATUSES)
      .is('duplicate_of', null),
    // Every live adjustment whose stay could land in the window. Stays run
    // weeks, not months; 60 days of check-in lookback bounds the scan
    // without risking a long extended stay falling out.
    supabase
      .from('checkout_adjustments')
      .select('*')
      .in('status', ['active', 'proposed'])
      .gte('stay_check_in', addDays(startDate, -60))
      .lte('stay_check_in', endDate),
  ]);

  const properties = new Map<string, PropertyLite>();
  for (const p of (propsRes.data ?? []) as Array<PropertyLite & { is_active: boolean | null; kind: string | null }>) {
    if (SCHEDULE_EXCLUDED_PROPERTY_IDS.has(p.id)) continue;
    if (p.is_active === false) continue;
    if (p.kind === 'hq') continue;
    properties.set(p.id, p);
  }

  const adjustments = (adjRes.data ?? []) as CheckoutAdjustment[];
  const activeByStay = new Map<string, CheckoutAdjustment>();
  const proposalsByStay = new Map<string, CheckoutAdjustment[]>();
  for (const a of adjustments) {
    const key = `${a.property_id}|${a.stay_check_in}`;
    if (a.status === 'active') {
      activeByStay.set(key, a);
    } else {
      const arr = proposalsByStay.get(key) ?? [];
      arr.push(a);
      proposalsByStay.set(key, arr);
    }
  }

  const checkoutStays = collapseStays((checkoutsRes.data ?? []) as BookingLite[]);

  // An extension can pull a stay INTO the window whose base check_out is
  // before it (so the base query missed it). Fetch those stays explicitly.
  const missingStayKeys: CheckoutAdjustment[] = [];
  for (const a of activeByStay.values()) {
    if (!a.adjusted_check_out) continue;
    if (a.adjusted_check_out < startDate || a.adjusted_check_out > endDate) continue;
    if (!checkoutStays.has(`${a.property_id}|${a.stay_check_in}`)) missingStayKeys.push(a);
  }
  if (missingStayKeys.length > 0) {
    const { data } = await supabase
      .from('bookings')
      .select('id, property_id, check_in, check_out, guest_name, source')
      .in('property_id', [...new Set(missingStayKeys.map((a) => a.property_id))])
      .in('check_in', [...new Set(missingStayKeys.map((a) => a.stay_check_in))])
      .in('status', STAY_STATUSES)
      .is('duplicate_of', null);
    const wanted = new Set(missingStayKeys.map((a) => `${a.property_id}|${a.stay_check_in}`));
    const fetched = collapseStays(
      ((data ?? []) as BookingLite[]).filter((b) => wanted.has(`${b.property_id}|${b.check_in}`)),
    );
    for (const [k, v] of fetched) checkoutStays.set(k, v);
  }

  // Arrivals for same-day-turnover detection, keyed by property|date.
  const checkinStays = collapseStays((checkinsRes.data ?? []) as BookingLite[]);
  const arrivalByPropertyDay = new Map<string, BookingLite>();
  for (const b of checkinStays.values()) {
    arrivalByPropertyDay.set(`${b.property_id}|${b.check_in}`, b);
  }

  // Resolve each stay to its effective checkout day, then bucket by day.
  const rowsByDay = new Map<string, ScheduleRow[]>();
  for (const stay of checkoutStays.values()) {
    const prop = properties.get(stay.property_id);
    if (!prop) continue;

    const stayKey = `${stay.property_id}|${stay.check_in}`;
    const adj = activeByStay.get(stayKey) ?? null;
    const effectiveCheckOut = adj?.adjusted_check_out ?? stay.check_out;
    if (effectiveCheckOut < startDate || effectiveCheckOut > endDate) continue;

    const defaultTime = normalizeTime(prop.default_checkout_time) ?? FALLBACK_CHECKOUT_TIME;
    const time = normalizeTime(adj?.adjusted_checkout_time) ?? defaultTime;

    // Guesty moved since the adjustment was written: if it caught up to the
    // adjusted date the overlay is simply satisfied; if it moved somewhere
    // ELSE the stay changed again and the operator should re-check.
    const drifted = !!adj
      && adj.original_check_out !== stay.check_out
      && adj.adjusted_check_out !== stay.check_out;

    const arrival = arrivalByPropertyDay.get(`${stay.property_id}|${effectiveCheckOut}`) ?? null;

    const row: ScheduleRow = {
      propertyId: stay.property_id,
      propertyName: prop.name,
      address: prop.address ?? '',
      city: prop.city ?? '',
      guestName: displayGuestName(stay.guest_name),
      checkIn: stay.check_in,
      baseCheckOut: stay.check_out,
      effectiveCheckOut,
      time,
      defaultTime,
      sameDayTurnover: !!arrival,
      nextCheckinTime: arrival
        ? (normalizeTime(prop.default_checkin_time) ?? FALLBACK_CHECKIN_TIME)
        : null,
      nextGuestName: arrival ? displayGuestName(arrival.guest_name) : null,
      adjustment: adj
        ? {
            id: adj.id,
            source: adj.source,
            note: adj.note,
            adjustedTime: normalizeTime(adj.adjusted_checkout_time),
            adjustedDate: adj.adjusted_check_out,
            evidence: adj.evidence,
            drifted,
          }
        : null,
      proposals: proposalsByStay.get(stayKey) ?? [],
    };
    const arr = rowsByDay.get(effectiveCheckOut) ?? [];
    arr.push(row);
    rowsByDay.set(effectiveCheckOut, arr);
  }

  const out: ScheduleDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(startDate, i);
    const rows = (rowsByDay.get(date) ?? []).sort(
      (a, b) => a.time.localeCompare(b.time) || a.propertyName.localeCompare(b.propertyName),
    );
    out.push({
      date,
      rows,
      counts: {
        checkouts: rows.length,
        sameDay: rows.filter((r) => r.sameDayTurnover).length,
        adjusted: rows.filter((r) => r.adjustment).length,
        proposed: rows.filter((r) => r.proposals.length > 0).length,
      },
    });
  }
  return out;
}

// ─── adjustment writes ────────────────────────────────────────────────

/** Insert an adjustment for a stay, superseding any previous ACTIVE row
 *  when the new one lands active (the partial unique index enforces one
 *  live adjustment per stay). Operator rows always land active. Miner
 *  rows land active only on high confidence AND when the standing active
 *  row is not operator-written (a human's word is never auto-overridden);
 *  otherwise they land proposed. Returns the inserted row id, or null
 *  when an identical miner_key already exists (idempotent re-run). */
export async function insertAdjustment(
  supabase: SupabaseClient,
  input: {
    propertyId: string;
    stayCheckIn: string;
    originalCheckOut: string;
    adjustedCheckOut?: string | null;
    adjustedCheckoutTime?: string | null;
    note?: string;
    source: AdjustmentSource;
    minerKey?: string;
    evidence?: string;
    confidence?: 'high' | 'medium' | 'low';
    createdBy: string;
  },
): Promise<{ id: string; status: 'active' | 'proposed' } | null> {
  const { data: standing } = await supabase
    .from('checkout_adjustments')
    .select('id, source')
    .eq('property_id', input.propertyId)
    .eq('stay_check_in', input.stayCheckIn)
    .eq('status', 'active')
    .maybeSingle();

  // Only a human's own edit lands active unconditionally. Every derived
  // source (thread miner, Guesty hold) must be high-confidence AND must
  // not be overriding something an operator set by hand.
  let status: 'active' | 'proposed' = 'active';
  if (input.source !== 'operator') {
    const operatorStanding = standing?.source === 'operator';
    status = input.confidence === 'high' && !operatorStanding ? 'active' : 'proposed';
  }

  if (status === 'active' && standing) {
    await supabase
      .from('checkout_adjustments')
      .update({ status: 'superseded', updated_at: new Date().toISOString() })
      .eq('id', standing.id)
      .eq('status', 'active');
  }

  const { data, error } = await supabase
    .from('checkout_adjustments')
    .insert({
      property_id: input.propertyId,
      stay_check_in: input.stayCheckIn,
      original_check_out: input.originalCheckOut,
      adjusted_check_out: input.adjustedCheckOut ?? null,
      adjusted_checkout_time: input.adjustedCheckoutTime ?? null,
      note: input.note ?? '',
      source: input.source,
      miner_key: input.minerKey ?? null,
      evidence: input.evidence ?? null,
      confidence: input.confidence ?? null,
      status,
      created_by: input.createdBy,
    })
    .select('id')
    .single();

  if (error) {
    // miner_key unique violation = this exact agreement was already mined
    // (possibly later dismissed - dismissed stays dismissed). Also covers
    // the one-active-per-stay race from a parallel run.
    if (error.code === '23505') return null;
    throw new Error(`checkout_adjustments insert failed: ${error.message}`);
  }
  return { id: (data as { id: string }).id, status };
}
