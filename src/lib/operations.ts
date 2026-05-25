/**
 * Turnover-pipeline data loader. Reads upcoming check-ins from the Helm-native
 * `bookings` table (Channels module: iCal imports from Airbnb/VRBO/Booking plus
 * the guesty_legacy backfill, deduped to one canonical row per stay) and
 * matches each against existing `inspections` records to figure out where each
 * property stands in its prep window.
 *
 * This replaced the original `guesty_reservations` read as part of the Guesty
 * wind-down. booking.id is the per-stay key (it stands in for the old
 * guesty_reservation_id throughout this module and the Operations page).
 */
import { supabase } from './supabase';
import { ACTIVE_WORK_SLIP_STATUSES } from './work-types';
import { isLowBattery, type SeamBatteryStatus } from './seam';

export type Range = 'today' | '3d' | '7d' | '14d' | '30d';

export const RANGE_DAYS: Record<Range, number> = {
  today: 0,
  '3d': 3,
  '7d': 7,
  '14d': 14,
  '30d': 30,
};

export const RANGE_LABEL: Record<Range, string> = {
  today: 'Today',
  '3d': '3 days',
  '7d': '7 days',
  '14d': '14 days',
  '30d': '30 days',
};

export const VALID_RANGES: Range[] = ['today', '3d', '7d', '14d', '30d'];

/**
 * Calendar window is independent of the turnover-list range so the operator
 * can keep the list focused on the next few days while looking further ahead
 * on the grid for planning. 30d is wide enough to overflow the 1100px
 * container -- the grid wrapper has overflowX: auto so it scrolls naturally.
 */
export type CalendarRange = '7d' | '14d' | '30d';

export const CALENDAR_RANGE_DAYS: Record<CalendarRange, number> = {
  '7d': 7,
  '14d': 14,
  '30d': 30,
};

export const CALENDAR_RANGE_LABEL: Record<CalendarRange, string> = {
  '7d': '7 days',
  '14d': '14 days',
  '30d': '30 days',
};

export const VALID_CALENDAR_RANGES: CalendarRange[] = ['7d', '14d', '30d'];

// Properties Rising Tide doesn't physically inspect (out-of-region, owner
// handles cleaning + turnovers locally). They stay in the registry for
// statements/revenue but are hidden from the turnover pipeline + calendar
// so the operator's view isn't cluttered with rows they can't act on.
const NON_OPERATIONS_PROPERTY_IDS = new Set<string>([
  '65_calderwood',
  '3246_ne_27th',
]);

// Booking statuses that represent an actual stay needing a turnover. The
// bookings.status enum is (inquiry|pending|confirmed|cancelled|completed|block);
// we surface confirmed + completed and exclude the rest. Blocks are owner /
// maintenance holds, not guest turnovers.
const TURNOVER_STATUSES = ['confirmed', 'completed'];

export function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function addDaysStr(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

export type InspectionStatus = 'not_started' | 'complete';

export type ReservationRow = {
  guesty_reservation_id: string;
  property_id: string;
  guest_name: string | null;
  channel: string | null;
  guesty_channel_id: string | null;
  check_in: string;
  check_out: string;
  nights: number | null;
  status: string | null;
  // Surfaced on calendar-cell hover tooltips so the operator gets the
  // booking context without bouncing to Guesty. host_payout drives the
  // "payout" line; confirmation_code rides as a small monospaced trailer.
  host_payout: number | null;
  confirmation_code: string | null;
};

export type InspectionRow = {
  id: string;
  property_id: string;
  started_at: string | null;
  completed_at: string | null;
};

export type PropertyMini = {
  id: string;
  name: string;
  title: string | null;
  city: string | null;
};

export type InspectionPlanMini = {
  id: string;
  planned_for_date: string | null;
  notes: string | null;
  planned_by_email: string;
  assigned_to_email: string | null;
};

export type CleaningCompletion = {
  completedAt: string;
  source: string;
  sourcePhone: string | null;
};

export type LockBattery = {
  /** 0-100, or null when Seam reported a status but no numeric level. */
  pct: number | null;
  /** Seam's battery_status enum (full | good | low | critical | unknown). */
  status: string;
  isLow: boolean;
};

export type Turnover = {
  reservationId: string;
  propertyId: string;
  propertyName: string;
  propertyTitle: string | null;
  guestName: string | null;
  channel: string | null;
  checkIn: string;
  checkOut: string;
  nights: number | null;
  status: string | null;
  isSameDayTurnover: boolean;
  previousCheckout: string | null;
  inspection: InspectionRow | null;
  inspectionStatus: InspectionStatus;
  plan: InspectionPlanMini | null;
  cleaning: CleaningCompletion | null;
  /** Count of active, non-snoozed work slips on this property. Used to
   *  surface a "N work slips · Print" affordance on the turnover row so
   *  the operator can grab the checklist on their way out the door. */
  openWorkSlipsCount: number;
  /** Lowest low-battery lock reading on this property (via Seam), or
   *  null when every lock is healthy or unmonitored. Drives the "bring
   *  batteries" chip so the team member packs spares before they drive. */
  lockBattery: LockBattery | null;
};

export type CalendarCell = {
  date: string;
  reservation: ReservationRow | null;
  isCheckIn: boolean;
  isContinuation: boolean;
};

export type CalendarRow = {
  property: PropertyMini;
  cells: CalendarCell[];
};

export type CalendarData = {
  days: string[];
  rows: CalendarRow[];
  todayIndex: number;
};

export type OperationsData = {
  rangeStart: string;
  rangeEnd: string;
  turnovers: Turnover[];
  totalCount: number;
  inspectionDoneCount: number;
  calendar: CalendarData;
};

/**
 * Load all turnovers (check-ins) where check-in falls within [today, today+days].
 *
 * To resolve "previous checkout date" and "same-day turnover" we also need to
 * see reservations in the surrounding window, so we fetch a wider slice and
 * then narrow down at the end.
 */
export async function loadOperationsData(
  range: Range,
  calendarRange: CalendarRange = '7d',
  propertyId?: string,
): Promise<OperationsData> {
  const rangeStart = todayStr();
  const days = RANGE_DAYS[range];
  const rangeEnd = addDaysStr(rangeStart, days);

  // Calendar window is independent of the list range. Operator can keep the
  // list short ("today") while looking 14 or 30 days ahead on the calendar.
  // We still floor at the list-range size so the calendar never shows less
  // than the list does.
  const calendarDays = Math.max(days, CALENDAR_RANGE_DAYS[calendarRange]);
  const calendarEnd = addDaysStr(rangeStart, calendarDays);

  // Lookback 30 days so we can resolve previous checkouts; lookahead through
  // calendarEnd + 1 so we capture every reservation overlapping the calendar.
  const fetchStart = addDaysStr(rangeStart, -30);
  const fetchEnd = addDaysStr(calendarEnd, 1);

  // Overlap-based query against the Helm-native bookings table: a stay
  // overlaps [fetchStart, fetchEnd] iff check_in <= fetchEnd AND
  // check_out >= fetchStart. Catches stays already in progress when the
  // window opens, which the calendar needs for day-0 occupancy. Only
  // canonical (non-duplicate) confirmed/completed stays count.
  const { data: resData, error: resErr } = await supabase
    .from('bookings')
    .select(
      'id, property_id, guest_name, channel, check_in, check_out, nights, status, payout, external_confirmation_code, external_booking_id'
    )
    .in('status', TURNOVER_STATUSES)
    .is('duplicate_of', null)
    .lte('check_in', fetchEnd)
    .gte('check_out', fetchStart)
    .order('check_in', { ascending: true });

  if (resErr) {
    throw new Error(`Failed to load reservations: ${resErr.message}`);
  }

  type BookingRaw = {
    id: string;
    property_id: string;
    guest_name: string | null;
    channel: string | null;
    check_in: string;
    check_out: string;
    nights: number | null;
    status: string | null;
    payout: number | null;
    external_confirmation_code: string | null;
    external_booking_id: string | null;
  };

  const rawBookings = (resData ?? []) as BookingRaw[];

  // Map booking rows into the ReservationRow shape the rest of this module and
  // the Operations page already consume. booking.id becomes the per-stay key.
  // `bookings` is reconciled at the source now (lib/ical-sync dedup collapses
  // each stay to one canonical row and a trusted cancellation wins), so the
  // read path just trusts duplicate_of + status from the query above.
  const reservations: ReservationRow[] = rawBookings
    .map((b) => ({
      guesty_reservation_id: b.id,
      property_id: b.property_id,
      guest_name: b.guest_name,
      channel: b.channel,
      guesty_channel_id: null,
      check_in: b.check_in,
      check_out: b.check_out,
      nights: b.nights,
      status: b.status,
      host_payout: b.payout,
      confirmation_code: b.external_confirmation_code,
    }))
    .filter(
      (r) =>
        r.property_id &&
        r.check_in &&
        r.check_out &&
        !NON_OPERATIONS_PROPERTY_IDS.has(r.property_id) &&
        (!propertyId || r.property_id === propertyId)
    );

  // Pull inspections in the same window for matching.
  const { data: inspData, error: inspErr } = await supabase
    .from('inspections')
    .select('id, property_id, started_at, completed_at')
    .gte('started_at', `${fetchStart}T00:00:00Z`)
    .order('started_at', { ascending: false });

  if (inspErr) {
    throw new Error(`Failed to load inspections: ${inspErr.message}`);
  }

  const inspections = (inspData ?? []) as InspectionRow[];

  // Pull inspection plans for the visible stays. Plans are keyed by stay:
  // new plans store booking.id in guesty_reservation_id (and booking_id);
  // legacy plans created before the cutover store the old Guesty reservation
  // id, which equals a guesty_legacy booking's external_booking_id. Match on
  // either so a scheduled inspection survives the transition. (A one-time
  // migration repoints legacy plans onto canonical booking ids; this fallback
  // covers anything that migration couldn't resolve.)
  const planKeyToBookingId = new Map<string, string>();
  for (const b of rawBookings) {
    planKeyToBookingId.set(b.id, b.id);
    if (b.external_booking_id) planKeyToBookingId.set(b.external_booking_id, b.id);
  }
  const planLookupKeys = [...planKeyToBookingId.keys()];
  const plansByReservation = new Map<string, InspectionPlanMini>();
  if (planLookupKeys.length > 0) {
    const { data: planData, error: planErr } = await supabase
      .from('inspection_plans')
      .select('id, guesty_reservation_id, booking_id, planned_for_date, notes, planned_by_email, assigned_to_email')
      .in('guesty_reservation_id', planLookupKeys);
    if (planErr) {
      throw new Error(`Failed to load inspection plans: ${planErr.message}`);
    }
    for (const p of (planData ?? []) as Array<{ guesty_reservation_id: string; booking_id: string | null } & InspectionPlanMini>) {
      const bookingId =
        (p.booking_id && planKeyToBookingId.get(p.booking_id)) ||
        planKeyToBookingId.get(p.guesty_reservation_id);
      if (!bookingId) continue;
      plansByReservation.set(bookingId, {
        id: p.id,
        planned_for_date: p.planned_for_date,
        notes: p.notes,
        planned_by_email: p.planned_by_email,
        assigned_to_email: p.assigned_to_email,
      });
    }
  }

  // All active properties — drives the calendar's row list (so vacant
  // properties show up as empty rows, which is the whole point of the grid).
  const { data: propData, error: propErr } = await supabase
    .from('properties')
    .select('id, name, title, city')
    .eq('is_active', true)
    .order('name');
  if (propErr) {
    throw new Error(`Failed to load properties: ${propErr.message}`);
  }
  const properties = ((propData ?? []) as PropertyMini[]).filter(
    (p) => !NON_OPERATIONS_PROPERTY_IDS.has(p.id) && (!propertyId || p.id === propertyId)
  );
  const propertyById = new Map(properties.map((p) => [p.id, p]));

  // Build a per-property checkout-date index so we can resolve previous
  // checkouts and same-day turnovers in O(1) per turnover.
  const checkoutsByProperty = new Map<string, string[]>();
  for (const r of reservations) {
    const arr = checkoutsByProperty.get(r.property_id) ?? [];
    arr.push(r.check_out);
    checkoutsByProperty.set(r.property_id, arr);
  }
  for (const arr of checkoutsByProperty.values()) {
    arr.sort();
  }

  // Pull cleaning completions across the lookback window. Each turnover
  // looks up its (property_id, previousCheckout) match below. Latest
  // wins per pair, so a re-clean shows the most recent timestamp.
  // Pull active work-slip counts in parallel so each turnover row can
  // show "N work slips · Print" without an N+1 fan-out.
  const todayIso = new Date().toISOString().slice(0, 10);
  const propertyIdList = properties.map((p) => p.id);
  const [{ data: cleaningData }, { data: openSlipsData }, { data: batteryData }] = await Promise.all([
    supabase
      .from('cleaning_completions')
      .select('property_id, checkout_date, completed_at, source, source_phone')
      .gte('checkout_date', fetchStart)
      .order('completed_at', { ascending: false }),
    supabase
      .from('work_slips')
      .select('property_id, snoozed_until')
      .in('status', ACTIVE_WORK_SLIP_STATUSES)
      .in('property_id', propertyIdList),
    supabase
      .from('lock_battery_status')
      .select('property_id, battery_pct, battery_status')
      .in('property_id', propertyIdList),
  ]);

  const openWorkSlipsByProperty = new Map<string, number>();
  for (const row of (openSlipsData ?? []) as Array<{ property_id: string; snoozed_until: string | null }>) {
    if (row.snoozed_until && row.snoozed_until > todayIso) continue;
    openWorkSlipsByProperty.set(row.property_id, (openWorkSlipsByProperty.get(row.property_id) ?? 0) + 1);
  }

  // Lowest low-battery lock per property. A property can have more than
  // one lock; we surface the worst so a single weak lock isn't masked by
  // a healthy one. Only low readings make it into the map, so any hit is
  // chip-worthy. A numeric percent beats a status-only ('low'/'critical')
  // reading when picking the worst.
  const lowBatteryByProperty = new Map<string, LockBattery>();
  for (const row of (batteryData ?? []) as Array<{
    property_id: string | null;
    battery_pct: number | null;
    battery_status: string | null;
  }>) {
    if (!row.property_id) continue;
    const status = row.battery_status ?? 'unknown';
    if (!isLowBattery(row.battery_pct, status as SeamBatteryStatus)) continue;
    const prev = lowBatteryByProperty.get(row.property_id);
    const better =
      !prev ||
      (row.battery_pct != null && (prev.pct == null || row.battery_pct < prev.pct));
    if (better) {
      lowBatteryByProperty.set(row.property_id, {
        pct: row.battery_pct,
        status,
        isLow: true,
      });
    }
  }

  const cleaningByKey = new Map<string, CleaningCompletion>();
  for (const row of (cleaningData ?? []) as Array<{
    property_id: string;
    checkout_date: string;
    completed_at: string;
    source: string;
    source_phone: string | null;
  }>) {
    const key = `${row.property_id}|${row.checkout_date}`;
    if (!cleaningByKey.has(key)) {
      cleaningByKey.set(key, {
        completedAt: row.completed_at,
        source: row.source,
        sourcePhone: row.source_phone,
      });
    }
  }

  // Filter to the actual display window (today through rangeEnd) and enrich.
  const turnovers: Turnover[] = [];
  for (const r of reservations) {
    const checkInDate = r.check_in;
    if (checkInDate < rangeStart || checkInDate > rangeEnd) continue;

    const property = propertyById.get(r.property_id) ?? null;

    const propCheckouts = checkoutsByProperty.get(r.property_id) ?? [];
    const previousCheckout =
      [...propCheckouts]
        .reverse()
        .find((c) => c <= checkInDate && c !== r.check_out) ?? null;

    const isSameDayTurnover = previousCheckout === checkInDate;

    // Match an inspection: same property, started_at between
    //   (previousCheckout - 1 day) and checkInDate (inclusive).
    // If there's no previous checkout, allow inspections from the day before
    // check-in onward so an old, unrelated inspection doesn't get mis-attached.
    const prepStart = previousCheckout
      ? addDaysStr(previousCheckout, -1)
      : addDaysStr(checkInDate, -1);

    const matchingInspection =
      inspections.find((i) => {
        if (i.property_id !== r.property_id) return false;
        if (!i.started_at) return false;
        const startedDate = i.started_at.slice(0, 10);
        return startedDate >= prepStart && startedDate <= checkInDate;
      }) ?? null;

    const inspectionStatus: InspectionStatus = matchingInspection?.completed_at
      ? 'complete'
      : 'not_started';

    const cleaning = previousCheckout
      ? cleaningByKey.get(`${r.property_id}|${previousCheckout}`) ?? null
      : null;

    turnovers.push({
      reservationId: r.guesty_reservation_id,
      propertyId: r.property_id,
      propertyName: property?.name ?? r.property_id,
      propertyTitle: property?.title ?? null,
      guestName: r.guest_name,
      channel: r.channel,
      checkIn: r.check_in,
      checkOut: r.check_out,
      nights: r.nights,
      status: r.status,
      isSameDayTurnover,
      previousCheckout,
      inspection: matchingInspection,
      inspectionStatus,
      plan: plansByReservation.get(r.guesty_reservation_id) ?? null,
      cleaning,
      openWorkSlipsCount: openWorkSlipsByProperty.get(r.property_id) ?? 0,
      lockBattery: lowBatteryByProperty.get(r.property_id) ?? null,
    });
  }

  // Dedupe by the natural turnover key (property + checkIn + checkOut).
  // Guesty occasionally emits a reservation twice when it's been edited and
  // re-synced — different guesty_reservation_id, same booking — which made
  // the same stay render as two adjacent identical cards on the pipeline.
  // The reservation row sorted later by check_in then guesty_reservation_id
  // wins, so we keep whichever the API returned last (most recently
  // edited).
  const turnoversByKey = new Map<string, Turnover>();
  for (const t of turnovers) {
    const key = `${t.propertyId}|${t.checkIn}|${t.checkOut}`;
    turnoversByKey.set(key, t);
  }
  const dedupedTurnovers = [...turnoversByKey.values()];

  // Sort: by check-in date, then same-day turnovers first, then property name.
  dedupedTurnovers.sort((a, b) => {
    if (a.checkIn !== b.checkIn) return a.checkIn < b.checkIn ? -1 : 1;
    if (a.isSameDayTurnover !== b.isSameDayTurnover) return a.isSameDayTurnover ? -1 : 1;
    return a.propertyName.localeCompare(b.propertyName);
  });

  const inspectionDoneCount = dedupedTurnovers.filter((t) => t.inspectionStatus === 'complete').length;

  // ── Calendar ──────────────────────────────────────────────────────────
  // One row per active property, columns = `calendarDays` consecutive dates
  // starting from today. Each cell either has a reservation occupying that
  // night (check_in <= date < check_out) or is empty (vacant).
  const calendarDayList: string[] = [];
  for (let i = 0; i < calendarDays; i += 1) {
    calendarDayList.push(addDaysStr(rangeStart, i));
  }

  const reservationsByProperty = new Map<string, ReservationRow[]>();
  for (const r of reservations) {
    const arr = reservationsByProperty.get(r.property_id) ?? [];
    arr.push(r);
    reservationsByProperty.set(r.property_id, arr);
  }

  const calendarRows: CalendarRow[] = properties.map((property) => {
    const propertyReservations = reservationsByProperty.get(property.id) ?? [];
    const cells: CalendarCell[] = calendarDayList.map((date) => {
      const occupying = propertyReservations.find(
        (r) => r.check_in <= date && date < r.check_out
      ) ?? null;
      return {
        date,
        reservation: occupying,
        isCheckIn: !!occupying && occupying.check_in === date,
        isContinuation: !!occupying && occupying.check_in !== date,
      };
    });
    return { property, cells };
  });

  return {
    rangeStart,
    rangeEnd,
    turnovers: dedupedTurnovers,
    totalCount: dedupedTurnovers.length,
    inspectionDoneCount,
    calendar: {
      days: calendarDayList,
      rows: calendarRows,
      todayIndex: 0,
    },
  };
}
