/**
 * Turnover-pipeline data loader. Reads upcoming check-ins from
 * `guesty_reservations` (already synced via /api/sync-guesty) and matches each
 * one against existing `inspections` records to figure out where each property
 * stands in its prep window.
 *
 * Mirrors the data assembly in Perfection's TurnoversPage / fetchGuestyTurnovers
 * Edge Function but reads the local Supabase mirror instead of hitting Guesty
 * live, and (for now) skips the bits that require tables Helm hasn't ported
 * yet: cleaning status, work slips, AI reservation intel, inspection plans,
 * assignees, skip workflow.
 */
import { supabase } from './supabase';

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

const ALLOWED_STATUSES = new Set([
  'confirmed',
  'reserved',
  'checked_in',
  'checked-in',
  'checkedin',
  'checked_out',
  'checked-out',
  'checkedout',
  'closed',
]);

function normalizeStatus(s: string | null): string {
  return (s || '').toLowerCase().replace(/_/g, '-').replace(/\s+/g, '-');
}

function isAllowed(status: string | null): boolean {
  const n = normalizeStatus(status);
  return (
    ALLOWED_STATUSES.has(n) ||
    n.includes('confirmed') ||
    n.includes('checked') ||
    n.includes('closed')
  );
}

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
};

export type OperationsData = {
  rangeStart: string;
  rangeEnd: string;
  turnovers: Turnover[];
  totalCount: number;
  inspectionDoneCount: number;
};

/**
 * Load all turnovers (check-ins) where check-in falls within [today, today+days].
 *
 * To resolve "previous checkout date" and "same-day turnover" we also need to
 * see reservations in the surrounding window, so we fetch a wider slice and
 * then narrow down at the end.
 */
export async function loadOperationsData(range: Range): Promise<OperationsData> {
  const rangeStart = todayStr();
  const days = RANGE_DAYS[range];
  const rangeEnd = addDaysStr(rangeStart, days);

  // Lookback 30 days so we can resolve previous checkouts; lookahead +1 so
  // ranges that include "today" still match reservations on the boundary.
  const fetchStart = addDaysStr(rangeStart, -30);
  const fetchEnd = addDaysStr(rangeEnd, 1);

  const { data: resData, error: resErr } = await supabase
    .from('guesty_reservations')
    .select(
      'guesty_reservation_id, property_id, guest_name, channel, guesty_channel_id, check_in, check_out, nights, status'
    )
    .gte('check_in', fetchStart)
    .lte('check_in', fetchEnd)
    .order('check_in', { ascending: true });

  if (resErr) {
    throw new Error(`Failed to load reservations: ${resErr.message}`);
  }

  const reservations = ((resData ?? []) as ReservationRow[]).filter(
    (r) => r.property_id && r.check_in && r.check_out && isAllowed(r.status)
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

  // Property metadata for display (active only — but we still want to surface
  // any reservation pointing at a property we know about).
  const propertyIds = Array.from(new Set(reservations.map((r) => r.property_id)));
  let properties: PropertyMini[] = [];
  if (propertyIds.length > 0) {
    const { data: propData, error: propErr } = await supabase
      .from('properties')
      .select('id, name, title, city')
      .in('id', propertyIds);
    if (propErr) {
      throw new Error(`Failed to load properties: ${propErr.message}`);
    }
    properties = (propData ?? []) as PropertyMini[];
  }
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
    });
  }

  // Sort: by check-in date, then same-day turnovers first, then property name.
  turnovers.sort((a, b) => {
    if (a.checkIn !== b.checkIn) return a.checkIn < b.checkIn ? -1 : 1;
    if (a.isSameDayTurnover !== b.isSameDayTurnover) return a.isSameDayTurnover ? -1 : 1;
    return a.propertyName.localeCompare(b.propertyName);
  });

  const inspectionDoneCount = turnovers.filter((t) => t.inspectionStatus === 'complete').length;

  return {
    rangeStart,
    rangeEnd,
    turnovers,
    totalCount: turnovers.length,
    inspectionDoneCount,
  };
}
