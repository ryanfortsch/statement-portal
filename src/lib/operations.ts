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
import { supabaseAdmin as supabase } from './supabase-admin';
import type { CleaningSession } from './cleaning-sessions';
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

// Days of history rendered before the today column on the occupancy
// calendar. The range labels above stay forward-looking ("7 days" = a week
// ahead); this just slides the window back so in-progress stays read as
// bars already in motion when they cross the today line.
export const CALENDAR_LOOKBACK_DAYS = 2;

// How far back to read lock.unlocked events for the calendar's guest-presence
// signal. A current stay's check-in can predate the visible window by up to a
// max stay length, so we look back further than the calendar lookback to catch
// a guest who keyed in a week ago and is still in residence. The lock_events
// volume is small (a few hundred unlocks across all locks), so this is cheap.
const PRESENCE_LOOKBACK_DAYS = 30;

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

// The Eastern calendar date (YYYY-MM-DD) of an instant. Lock events are stored
// in UTC, but a stay's check_in / check_out are Gloucester (Eastern) dates, so
// we compare a keypad entry to the stay window by its Eastern date -- otherwise
// a 9pm-ET entry (01:00 UTC next day) would land on the wrong calendar day.
const EASTERN_DATE_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
function easternDateStr(iso: string): string {
  return EASTERN_DATE_FMT.format(new Date(iso));
}

// Significant lowercase tokens (>= 3 chars) of a name, for matching a lock code
// name to a reservation's guest. Drops short joiners so "Julie Polvinen" ->
// {julie, polvinen} and a one-letter initial can't cause a spurious match.
function nameTokens(name: string | null): Set<string> {
  const out = new Set<string>();
  for (const t of (name ?? '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (t.length >= 3) out.add(t);
  }
  return out;
}

// Does a guest-role lock code belong to THIS stay? True when the code is a
// generic guest code (name contains "guest", e.g. "September Guest Code") or
// when it shares a name token with the stay's guest (e.g. a "Julie Polvinen"
// code for guest Julie). A blank-named guest code passes as generic (it's still
// a guest-role PIN), but a leftover personal-named code for a different guest
// is rejected, so the wrong name never lights up.
function codeFitsGuest(codeName: string | null, guestTokens: Set<string>): boolean {
  const n = (codeName ?? '').toLowerCase();
  if (!n.trim() || /guest/.test(n)) return true;
  for (const t of nameTokens(codeName)) {
    if (guestTokens.has(t)) return true;
  }
  return false;
}

/** The earlier of two ISO timestamps, ignoring nulls (null if both null).
 *  Compares by parsed instant, not lexically, since the two sources can use
 *  different ISO forms (PostgREST '+00:00' vs Seam 'Z'). */
function earliestNonNull(a: string | null, b: string | null): string | null {
  if (a == null) return b;
  if (b == null) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
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
  /** When this stay is the one happening RIGHT NOW (check_in <= today <
   *  check_out) on a lock-monitored property AND the guest has physically keyed
   *  in (a keycode unlock on a GUEST-role code during the stay), this is the
   *  ISO timestamp of that first entry. The calendar lights a "guest in
   *  residence" home glyph off it. null for past / future / lockless stays, and
   *  for a current stay where no guest keypad entry has been seen yet -- so the
   *  signal only ever appears as a positive fact, never a guess. */
  guestArrivedAt: string | null;
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

/** A work slip pinned to a specific reservation (guesty_reservation_id),
 *  e.g. an approved guest gear request. Surfaced on the turnover row so the
 *  prepper sees "set up pack-n-play" against the exact check-in. */
export type PrepSlip = {
  id: string;
  title: string;
  actionSummary: string | null;
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
  /** An inspection is actively underway for this turnover: started in the app
   *  (an inspections row with started_at, not yet complete) and, once the lock
   *  signal ships, a master / inspection code unlock. Drives the rail's real
   *  "Inspecting" state vs the awaiting "Needs inspection" so the rail never
   *  claims an inspection is happening when none has started. */
  inspectionInProgress: boolean;
  /** When the in-progress inspection started, for the live "inspecting Xm"
   *  counter. Null when not inspecting. */
  inspectionStartedAt: string | null;
  /** The in-progress inspection is known only from a lock master-code unlock
   *  (no app inspection started yet). Drives the lock glyph on the rail's
   *  inspected node. */
  inspectionViaLock: boolean;
  plan: InspectionPlanMini | null;
  cleaning: CleaningCompletion | null;
  /** Lock + text-derived cleaning lifecycle (entered / finished + provenance)
   *  for this turnover's previousCheckout. Drives the live "cleaner in /
   *  cleaning / cleaned" state; null until a signal lands. */
  cleaningSession: CleaningSession | null;
  /** Count of active, non-snoozed work slips on this property. Used to
   *  surface a "N work slips · Print" affordance on the turnover row so
   *  the operator can grab the checklist on their way out the door. */
  openWorkSlipsCount: number;
  /** Active slips pinned to THIS reservation (work_slips.guesty_reservation_id),
   *  e.g. an approved guest gear request ("set up pack-n-play + high chair").
   *  Unlike openWorkSlipsCount these are stay-scoped, so the row can say
   *  "prep for this check-in", not just "this property has slips". */
  prepSlips: PrepSlip[];
  /** Lowest low-battery lock reading on this property (via Seam), or
   *  null when every lock is healthy or unmonitored. Drives the "bring
   *  batteries" chip so the team member packs spares before they drive. */
  lockBattery: LockBattery | null;
  /** True when this property has at least one mapped, ACTIVE smart lock in
   *  lock_devices, i.e. the lock-driven cleaning signals (entered_at, set
   *  by a 2222 keypad unlock) can actually fire here. False for lockless
   *  homes (e.g. 79 Main; today everything except 3 Locust + 20 Enon), where
   *  the rail degrades: no "Cleaner in" / "Cleaning" stages and no false
   *  "Awaiting cleaner" pulse, since cleaning can only ever show via the Quo
   *  text or a manual confirm. Same predicate as guest-locks.ts getPropertyLock
   *  (property_id mapped AND active) so "monitored" means the entry-write path
   *  in cleaning-sessions.ts can genuinely fire. */
  lockMonitored: boolean;
  /** Operator marked this turnover done by hand (turnover_completions),
   *  independent of any inspection. Like a completed inspection, it sinks
   *  the row to the bottom of the pipeline. completedAt/By describe the
   *  mark; both null when not manually completed. */
  manuallyCompleted: boolean;
  completedAt: string | null;
  completedByEmail: string | null;
  /** Set when this turnover's inspection is bundled into a Field contractor
   *  packet, so the row can show who's covering it. Attached by the
   *  Operations page (not loadOperationsData) to keep the service-role Field
   *  read out of this anon-client module. */
  fieldPacket?: {
    packetId: string;
    status: string;
    contractorName: string | null;
    /** The packet's scheduled walk date (YYYY-MM-DD), for tooltips. */
    visitDate?: string | null;
  } | null;
};

export type CalendarCell = {
  date: string;
  /** Guest occupying the NIGHT of this date (check_in <= date < check_out) —
   *  the right ("PM") half of the cell. On a check-in day this is the
   *  arriving guest; on a vacant night it's null. */
  pm: ReservationRow | null;
  /** Guest occupying the MORNING of this date (check_in < date <= check_out) —
   *  the left ("AM") half. On a checkout day this is the DEPARTING guest,
   *  whose bar ends mid-cell; that's what makes checkouts legible. Equals
   *  `pm` on a continuous middle night. */
  am: ReservationRow | null;
  /** pm checks in on this date (bar starts at the cell's center). */
  isCheckIn: boolean;
  /** am checks out on this date (bar ends at the cell's center). */
  isCheckOut: boolean;
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
  // canonical (non-duplicate) rows count. Blocks (owner / maintenance
  // holds) are fetched too, but ONLY for the occupancy calendar — they
  // are split out below and never become turnovers, so the pipeline and
  // stage counts stay guest-stays-only while the calendar stops rendering
  // an owner-held week as bookable vacancy.
  const { data: resData, error: resErr } = await supabase
    .from('bookings')
    .select(
      'id, property_id, guest_name, channel, check_in, check_out, nights, status, payout, external_confirmation_code, external_booking_id'
    )
    .in('status', [...TURNOVER_STATUSES, 'block'])
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
  const toReservationRow = (b: BookingRaw): ReservationRow => ({
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
    guestArrivedAt: null,
  });
  const keepRow = (r: ReservationRow): boolean =>
    !!r.property_id &&
    !!r.check_in &&
    !!r.check_out &&
    !NON_OPERATIONS_PROPERTY_IDS.has(r.property_id) &&
    (!propertyId || r.property_id === propertyId);

  // Guest stays: everything downstream (turnovers, cleaning lifecycle,
  // presence, stage counts) works off this list, exactly as before.
  const reservations: ReservationRow[] = rawBookings
    .filter((b) => b.status !== 'block')
    .map(toReservationRow)
    .filter(keepRow);

  // Owner / maintenance holds: calendar-only. Kept in a separate list so
  // no turnover, same-day, previous-checkout, or presence logic ever sees
  // them; merged into the calendar cells at the bottom of this loader.
  const blockReservations: ReservationRow[] = rawBookings
    .filter((b) => b.status === 'block')
    .map(toReservationRow)
    .filter(keepRow);

  // Pull inspections in the same window for matching.
  const { data: inspData, error: inspErr } = await supabase
    .from('inspections')
    .select('id, property_id, started_at, completed_at')
    .gte('started_at', `${fetchStart}T00:00:00Z`)
    .order('started_at', { ascending: false });

  if (inspErr) {
    throw new Error(`Failed to load inspections: ${inspErr.message}`);
  }

  const allInspections = (inspData ?? []) as InspectionRow[];

  // Drop "empty shell" inspections from the match pool — rows where the
  // operator tapped Start Inspection, then bounced without marking a
  // single card. Those sit in the table with completed_at NULL and zero
  // inspection_results forever, and would otherwise lock the operations
  // row into "Resume →" even though there's nothing to resume. Completed
  // inspections always stay (status / counts are on the row). For
  // in-progress ones, check inspection_results: any results at all = real
  // session; none = abandoned shell, ignore it.
  const inProgressIds = allInspections.filter((i) => !i.completed_at).map((i) => i.id);
  const inProgressWithResults = new Set<string>();
  if (inProgressIds.length > 0) {
    const { data: rrows } = await supabase
      .from('inspection_results')
      .select('inspection_id')
      .in('inspection_id', inProgressIds);
    for (const r of (rrows ?? []) as { inspection_id: string }[]) {
      inProgressWithResults.add(r.inspection_id);
    }
  }
  const inspections = allInspections.filter(
    (i) => i.completed_at || inProgressWithResults.has(i.id),
  );

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
  const [
    { data: cleaningData },
    { data: openSlipsData },
    { data: batteryData },
    { data: completionData },
    { data: cleaningSessionData },
    { data: lockDeviceData },
    { data: inspectionSessionData },
    { data: guestCodeData },
    { data: unlockEventData },
  ] = await Promise.all([
    supabase
      .from('cleaning_completions')
      .select('property_id, checkout_date, completed_at, source, source_phone')
      .gte('checkout_date', fetchStart)
      .order('completed_at', { ascending: false }),
    supabase
      .from('work_slips')
      .select('id, property_id, snoozed_until, title, action_summary, guesty_reservation_id')
      .in('status', ACTIVE_WORK_SLIP_STATUSES)
      .in('property_id', propertyIdList),
    supabase
      .from('lock_battery_status')
      .select('property_id, battery_pct, battery_status')
      .in('property_id', propertyIdList),
    // Operator-marked turnover completions for the visible window, keyed
    // by (property_id, check_in) below. Presence = manually done.
    supabase
      .from('turnover_completions')
      .select('property_id, check_in, completed_at, completed_by_email')
      .gte('check_in', fetchStart),
    supabase
      .from('cleaning_sessions')
      .select(
        'property_id, checkout_date, entered_at, finished_at, entry_source, finish_source, finish_estimated',
      )
      .gte('checkout_date', fetchStart),
    // Which of the visible properties have a mapped, ACTIVE smart lock. Same
    // predicate as guest-locks.ts getPropertyLock / cleaning-sessions.ts
    // lockProperty (active=true), so lockMonitored=true iff the lock entry
    // signal can actually fire. A mapped-but-active=false lock reads as
    // lockless. Near-zero added cost: parallels the battery read above.
    supabase
      .from('lock_devices')
      .select('property_id, device_id')
      .in('property_id', propertyIdList)
      .eq('active', true),
    // The lock-driven "inspection underway" signal (a master / inspection code
    // unlock), keyed by (property_id, checkout_date) like cleaning_sessions.
    // ORs with the app "Start Inspection" signal below. Resilient: if the
    // table isn't applied yet the query resolves with an error + null data and
    // this degrades to "no lock inspection signal", never breaking the page.
    supabase
      .from('inspection_sessions')
      .select('property_id, checkout_date, started_at, started_source')
      .gte('checkout_date', fetchStart),
    // Guest-presence inputs (calendar). guestCodeData = which access_code_ids
    // are GUEST codes per device (vs cleaner / owner / staff); unlockEventData =
    // recent keypad unlocks. Joined below so a stay bar can show the guest is
    // in residence the moment they key in. Both degrade to "no signal" (null
    // data) if lock_access_codes isn't applied yet -- never breaks the page.
    supabase
      .from('lock_access_codes')
      .select('device_id, access_code_id, name, role')
      .eq('role', 'guest'),
    // Newest-first + an explicit cap above the implicit 1000-row PostgREST
    // default: presence only cares about the current stay, so if the unlock
    // volume ever outgrows the cap, the rows we drop are the OLDEST (outside any
    // active window), never a recent guest entry. ~475 unlocks / 30d today.
    supabase
      .from('lock_events')
      .select('device_id, payload')
      .eq('event_type', 'lock.unlocked')
      .gte('received_at', addDaysStr(rangeStart, -PRESENCE_LOOKBACK_DAYS))
      .order('received_at', { ascending: false })
      .limit(4000),
  ]);

  // Set of properties with a live smart lock. Anything not in here is a
  // lockless home: its turnover rail degrades to checkout -> cleaned (Quo /
  // manual) -> inspected -> ready, with no lock-only "Cleaner in"/"Cleaning"
  // stages and no false "Awaiting cleaner" pulse.
  const monitoredPropertyIds = new Set<string>();
  // device_id -> property_id, so a lock_events row (which carries only a device)
  // can be attributed to a property for the guest-presence signal below.
  const deviceToProperty = new Map<string, string>();
  for (const row of (lockDeviceData ?? []) as Array<{ property_id: string | null; device_id: string | null }>) {
    if (row.property_id) monitoredPropertyIds.add(row.property_id);
    if (row.property_id && row.device_id) deviceToProperty.set(row.device_id, row.property_id);
  }

  // Guest-presence signal for the calendar. We build, per property, the times a
  // GUEST keypad code was used (a real "someone keyed in" fact; cleaner / owner
  // / staff / repair codes are excluded by role, and thumbturn 'manual' unlocks
  // carry no code so they're ignored). Each active stay then claims the earliest
  // such entry inside its own window as its arrival time.
  //
  // device_id -> (access_code_id -> code name). The name lets the attribution
  // below stay precise: an entry counts for a stay only if it's a generic guest
  // code OR its name matches that stay's guest, so a leftover personal-named
  // code can't light the wrong guest.
  const guestCodeNameByDevice = new Map<string, Map<string, string | null>>();
  for (const row of (guestCodeData ?? []) as Array<{ device_id: string; access_code_id: string; name: string | null; role: string }>) {
    const m = guestCodeNameByDevice.get(row.device_id) ?? new Map<string, string | null>();
    m.set(row.access_code_id, row.name);
    guestCodeNameByDevice.set(row.device_id, m);
  }

  // property_id -> ascending list of guest keypad entries ({ at, codeName }).
  type GuestEntry = { at: string; codeName: string | null };
  const guestEntriesByProperty = new Map<string, GuestEntry[]>();
  for (const row of (unlockEventData ?? []) as Array<{
    device_id: string | null;
    payload: { method?: string | null; access_code_id?: string | null; occurred_at?: string | null } | null;
  }>) {
    const deviceId = row.device_id;
    const p = row.payload;
    if (!deviceId || !p) continue;
    // Only a keypad PIN entry signals an arrival; thumbturn / mobile / manual
    // unlocks (no access_code_id) are not a code we can attribute to a guest.
    if ((p.method ?? '').toLowerCase() !== 'keycode') continue;
    const codeId = p.access_code_id;
    const occurredAt = p.occurred_at;
    if (!codeId || !occurredAt) continue;
    const codeMap = guestCodeNameByDevice.get(deviceId);
    if (!codeMap || !codeMap.has(codeId)) continue; // not a guest-role code
    const propertyId = deviceToProperty.get(deviceId);
    if (!propertyId) continue;
    const arr = guestEntriesByProperty.get(propertyId) ?? [];
    arr.push({ at: occurredAt, codeName: codeMap.get(codeId) ?? null });
    guestEntriesByProperty.set(propertyId, arr);
  }
  for (const arr of guestEntriesByProperty.values()) {
    arr.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }

  // Stamp the arrival time onto the stay that is happening RIGHT NOW. A stay is
  // "current" when check_in <= today < check_out; only then does a guest's
  // keypad entry mean "they're in residence" (a past stay is over, a future one
  // hasn't started). We claim the earliest guest entry whose Eastern date falls
  // inside [check_in, check_out], whose instant is already past, AND whose code
  // is a generic guest code or matches this stay's guest name. Mutating the
  // reservation object here flows straight into the calendar cells below, which
  // reference these same objects by identity.
  const presenceNowMs = Date.now();
  // Eastern "today" (not the module's UTC rangeStart) for the current-stay gate,
  // so it agrees with the Eastern window check just below and with check_in /
  // check_out, which are Gloucester dates. Using UTC here would drop the glyph
  // during the guest's true last evening (7pm-midnight ET, already "tomorrow" in
  // UTC) even though they're still in the house.
  const easternToday = easternDateStr(new Date(presenceNowMs).toISOString());
  for (const r of reservations) {
    if (!monitoredPropertyIds.has(r.property_id)) continue;
    if (!(r.check_in <= easternToday && easternToday < r.check_out)) continue;
    const entries = guestEntriesByProperty.get(r.property_id);
    if (!entries) continue;
    const guestTokens = nameTokens(r.guest_name);
    for (const e of entries) {
      if (Date.parse(e.at) > presenceNowMs) break; // ascending: nothing later qualifies
      const etDate = easternDateStr(e.at);
      if (etDate < r.check_in || etDate > r.check_out) continue;
      if (!codeFitsGuest(e.codeName, guestTokens)) continue;
      r.guestArrivedAt = e.at;
      break; // earliest qualifying entry wins
    }
  }

  const completionByKey = new Map<string, { completedAt: string; by: string | null }>();
  for (const row of (completionData ?? []) as Array<{
    property_id: string;
    check_in: string;
    completed_at: string;
    completed_by_email: string | null;
  }>) {
    completionByKey.set(`${row.property_id}|${row.check_in.slice(0, 10)}`, {
      completedAt: row.completed_at,
      by: row.completed_by_email,
    });
  }

  const openWorkSlipsByProperty = new Map<string, number>();
  // Stay-scoped prep slips (e.g. approved guest gear requests), keyed by the
  // reservation they prep for. Same active + unsnoozed universe as the count.
  const prepSlipsByReservation = new Map<string, PrepSlip[]>();
  for (const row of (openSlipsData ?? []) as Array<{
    id: string;
    property_id: string;
    snoozed_until: string | null;
    title: string | null;
    action_summary: string | null;
    guesty_reservation_id: string | null;
  }>) {
    if (row.snoozed_until && row.snoozed_until > todayIso) continue;
    openWorkSlipsByProperty.set(row.property_id, (openWorkSlipsByProperty.get(row.property_id) ?? 0) + 1);
    if (row.guesty_reservation_id) {
      // stay-concierge stores the GUESTY reservation _id on the slip; the
      // turnover rows key on bookings.id. planKeyToBookingId maps both id
      // spaces to the canonical booking id (same split as inspection
      // plans above) — without the remap this lookup never matches.
      const bookingId =
        planKeyToBookingId.get(row.guesty_reservation_id) ?? row.guesty_reservation_id;
      const list = prepSlipsByReservation.get(bookingId) ?? [];
      list.push({
        id: row.id,
        title: row.title ?? 'Prep',
        actionSummary: row.action_summary,
      });
      prepSlipsByReservation.set(bookingId, list);
    }
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

  const cleaningSessionByKey = new Map<string, CleaningSession>();
  for (const row of (cleaningSessionData ?? []) as Array<{
    property_id: string;
    checkout_date: string;
    entered_at: string | null;
    finished_at: string | null;
    entry_source: string | null;
    finish_source: string | null;
    finish_estimated: boolean;
  }>) {
    cleaningSessionByKey.set(`${row.property_id}|${row.checkout_date}`, {
      enteredAt: row.entered_at,
      finishedAt: row.finished_at,
      entrySource: row.entry_source,
      finishSource: row.finish_source,
      finishEstimated: !!row.finish_estimated,
    });
  }

  // Lock-driven inspection starts (master / inspection code unlock), keyed by
  // (property_id, checkout_date) and joined on previousCheckout below.
  const inspectionStartByKey = new Map<string, string>();
  for (const row of (inspectionSessionData ?? []) as Array<{
    property_id: string;
    checkout_date: string;
    started_at: string | null;
  }>) {
    if (row.started_at) inspectionStartByKey.set(`${row.property_id}|${row.checkout_date}`, row.started_at);
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

    // Match an inspection: same property, started_at inside the prep
    // window for THIS turnover. The window starts at the LATER of:
    //   - one day before the previous guest checked out, OR
    //   - PREP_WINDOW_DAYS before this check-in.
    // Capping at PREP_WINDOW_DAYS before check-in prevents an orphan walk
    // done long ago (e.g. prep for a guest who later cancelled, leaving a
    // 10+ day gap) from drifting onto the next confirmed turnover. With no
    // previous checkout we fall back to the same N-day cap.
    const PREP_WINDOW_DAYS = 3;
    const tightStart = addDaysStr(checkInDate, -PREP_WINDOW_DAYS);
    const looseStart = previousCheckout ? addDaysStr(previousCheckout, -1) : null;
    const prepStart = looseStart && looseStart > tightStart ? looseStart : tightStart;

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

    // Inspection in progress, from EITHER signal, while not yet complete:
    //  - app: a matched inspections row started + not completed (Start Inspection).
    //  - lock: a master / inspection code unlock (inspection_sessions.started_at)
    //          for this turnover's previousCheckout.
    const appInspectionStartedAt =
      matchingInspection != null && !matchingInspection.completed_at ? matchingInspection.started_at : null;
    const lockInspectionStartedAt =
      inspectionStatus !== 'complete' && previousCheckout
        ? inspectionStartByKey.get(`${r.property_id}|${previousCheckout}`) ?? null
        : null;
    const inspectionInProgress = appInspectionStartedAt != null || lockInspectionStartedAt != null;
    // Earliest of the two starts drives the live "inspecting Xm" counter.
    const inspectionStartedAt = earliestNonNull(appInspectionStartedAt, lockInspectionStartedAt);
    // Lock is the source when there's a lock start and no app inspection yet,
    // which drives the lock glyph on the rail's inspected node.
    const inspectionViaLock = lockInspectionStartedAt != null && appInspectionStartedAt == null;

    const cleaning = previousCheckout
      ? cleaningByKey.get(`${r.property_id}|${previousCheckout}`) ?? null
      : null;

    const cleaningSession = previousCheckout
      ? cleaningSessionByKey.get(`${r.property_id}|${previousCheckout}`) ?? null
      : null;

    const completion =
      completionByKey.get(`${r.property_id}|${checkInDate.slice(0, 10)}`) ?? null;

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
      inspectionInProgress,
      inspectionStartedAt,
      inspectionViaLock,
      plan: plansByReservation.get(r.guesty_reservation_id) ?? null,
      cleaning,
      cleaningSession,
      openWorkSlipsCount: openWorkSlipsByProperty.get(r.property_id) ?? 0,
      prepSlips: prepSlipsByReservation.get(r.guesty_reservation_id) ?? [],
      lockBattery: lowBatteryByProperty.get(r.property_id) ?? null,
      lockMonitored: monitoredPropertyIds.has(r.property_id),
      manuallyCompleted: completion !== null,
      completedAt: completion?.completedAt ?? null,
      completedByEmail: completion?.by ?? null,
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
  // One row per active property, columns = CALENDAR_LOOKBACK_DAYS of
  // history + `calendarDays` consecutive dates starting from today. The
  // lookback makes mid-stay occupancy legible: a guest who checked in two
  // days ago renders as a bar already in motion before the today column,
  // instead of being indistinguishable from a fresh check-in (this matches
  // how Guesty's multi-calendar frames the current day). Each cell carries
  // its morning + night occupant (see CalendarCell) so the grid can draw
  // stays as bars with a visible start and end. The reservation fetch
  // already reaches 30 days back, so no extra query needed.
  const calendarDayList: string[] = [];
  for (let i = -CALENDAR_LOOKBACK_DAYS; i < calendarDays; i += 1) {
    calendarDayList.push(addDaysStr(rangeStart, i));
  }

  const reservationsByProperty = new Map<string, ReservationRow[]>();
  for (const r of reservations) {
    const arr = reservationsByProperty.get(r.property_id) ?? [];
    arr.push(r);
    reservationsByProperty.set(r.property_id, arr);
  }
  // Blocks join the calendar feed AFTER the real stays so the cell
  // occupant lookup (a linear find) always prefers a guest booking when
  // both cover the same night — the same owner stay sometimes exists as
  // both a $0 direct booking and a calendar block, and the guest row is
  // the one with a name and a tooltip worth showing.
  for (const r of blockReservations) {
    const arr = reservationsByProperty.get(r.property_id) ?? [];
    arr.push(r);
    reservationsByProperty.set(r.property_id, arr);
  }

  const calendarRows: CalendarRow[] = properties.map((property) => {
    const propertyReservations = reservationsByProperty.get(property.id) ?? [];
    const cells: CalendarCell[] = calendarDayList.map((date) => {
      // Two half-day occupants so the grid can draw stays as bars with a
      // visible start and end (the half-cell model every booking calendar
      // uses). pm = who sleeps the NIGHT of `date` (check_in <= date <
      // check_out). am = who's here the MORNING of `date` (check_in < date
      // <= check_out) — on a checkout day that's the departing guest, even
      // though they don't occupy the night, which is exactly the signal the
      // old single-occupant model couldn't show.
      const pm =
        propertyReservations.find((r) => r.check_in <= date && date < r.check_out) ?? null;
      const am =
        propertyReservations.find((r) => r.check_in < date && date <= r.check_out) ?? null;
      return {
        date,
        pm,
        am,
        isCheckIn: !!pm && pm.check_in === date,
        isCheckOut: !!am && am.check_out === date,
      };
    });
    return { property, cells };
  });

  // Order calendar rows by the next thing that happens on each property
  // (soonest upcoming check-in or check-out among guest stays), so the
  // top-left of the grid is the hot zone instead of an alphabetical
  // accident. Among properties whose next event is today, a same-day flip
  // outranks a plain check-in or check-out; name is the final tiebreak.
  // Properties with nothing on the horizon sink to the bottom.
  const FAR_FUTURE = '9999-12-31';
  const nextEventByProperty = new Map<string, string>();
  for (const r of reservations) {
    for (const d of [r.check_in, r.check_out]) {
      if (d < rangeStart) continue;
      const cur = nextEventByProperty.get(r.property_id);
      if (!cur || d < cur) nextEventByProperty.set(r.property_id, d);
    }
  }
  const sameDayFlipToday = new Set(
    dedupedTurnovers
      .filter((t) => t.isSameDayTurnover && t.checkIn.slice(0, 10) === rangeStart)
      .map((t) => t.propertyId),
  );
  calendarRows.sort((a, b) => {
    const an = nextEventByProperty.get(a.property.id) ?? FAR_FUTURE;
    const bn = nextEventByProperty.get(b.property.id) ?? FAR_FUTURE;
    if (an !== bn) return an < bn ? -1 : 1;
    const aFlip = sameDayFlipToday.has(a.property.id) ? 0 : 1;
    const bFlip = sameDayFlipToday.has(b.property.id) ? 0 : 1;
    if (aFlip !== bFlip) return aFlip - bFlip;
    return a.property.name.localeCompare(b.property.name);
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
      todayIndex: CALENDAR_LOOKBACK_DAYS,
    },
  };
}
