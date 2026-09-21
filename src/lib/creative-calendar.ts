/**
 * The creative planner grid: which homes a contributor can be sent to on
 * which day. The board on /fieldwork/shoots renders it the way the packets
 * board renders inspection windows (a property x day grid you click), and
 * the verdict per cell is dayClearRange -- the SAME report behind the shoot
 * brief, the shoot page's "Shoot day" card and the 8 AM go/no-go text, so a
 * day the grid offers is a day those rails will also call clear.
 *
 * A cell is one of:
 *   open      nobody in the house, no hold, no arrival: shoot any time
 *   checkout  guests leave ~11 AM; empty after that
 *   checkin   empty, but a guest arrives ~3 PM (not clear, per the day-of check)
 *   occupied  a guest sleeps there
 *   held      owner / manual / mirror hold
 * plus, on any of those, a shoot already booked there that day, or an offer
 * out and unanswered.
 *
 * Managed rentals only: HQ and prospect homes never carry bookings, so they
 * would be permanent green lanes with no listing to shoot.
 */

import 'server-only';
import { fieldDb } from '@/lib/field-db';
import { initialsOf, loadFieldProperties } from '@/lib/field-packets';
import type { FieldProperty } from '@/lib/field-types';
import { dayClearRange, type DayClearInfo } from '@/lib/maintenance-runs';

export type ShootCellState = 'open' | 'checkout' | 'checkin' | 'occupied' | 'held';

export type ShootCalBooking = {
  id: string;
  title: string;
  /** Contributor initials, for the cell. */
  who: string;
  contractorName: string;
  /** An offer they have not answered yet is NOT a booking: the cell says
   *  pending, and nothing downstream treats the day as covered. */
  pending: boolean;
};

export type ShootCalCell = {
  date: string;
  state: ShootCellState;
  /** Why the home is not shootable that day, in operator words. Null when it is. */
  reason: string | null;
  /** Next guest arrival on or after the day (the "next guests" line). */
  nextCheckin: string | null;
  /** A shoot already logged at this home on this day, if any. */
  shoot: ShootCalBooking | null;
};

export type ShootCalRow = {
  propertyId: string;
  propertyName: string;
  /** The most recent shoot on or before today. Null = never shot. */
  lastShot: string | null;
  cells: ShootCalCell[];
};

export type ShootCalendarData = { days: string[]; rows: ShootCalRow[] };

type ShootLite = {
  id: string;
  property_id: string | null;
  shoot_date: string;
  title: string;
  contractor_id: string;
  status: string;
};

export function todayET(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

/**
 * Whole days since an ISO timestamp, or null if there isn't one.
 *
 * Lives here rather than inline in a page because reading the clock inside
 * a component is an impure render (react-hooks/purity), and the rest of
 * Helm gets "now" from a lib helper for the same reason.
 */
export function daysSinceIso(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): string[] {
  const out: string[] = [];
  let cur = a;
  let guard = 0;
  while (cur <= b && guard < 120) {
    out.push(cur);
    cur = addDays(cur, 1);
    guard++;
  }
  return out;
}

function cellState(info: DayClearInfo | undefined, day: string): { state: ShootCellState; reason: string | null } {
  // No report row (a property the calendars have never seen) reads open:
  // the send action re-checks the day fresh before anything goes out.
  if (!info) return { state: 'open', reason: null };
  if (info.clear) {
    return { state: info.priorGuestCheckout === day ? 'checkout' : 'open', reason: null };
  }
  const state: ShootCellState = info.why === 'guest_night' ? 'occupied' : info.why === 'check_in' ? 'checkin' : 'held';
  return { state, reason: info.reason };
}

export async function loadShootCalendar(
  windowStart: string = todayET(),
  windowEnd: string = addDays(todayET(), 13),
  /** The Field property list, when the caller already has it (the board
   *  loads it for the log-a-shoot form); otherwise loaded here. */
  fieldProperties?: FieldProperty[],
): Promise<ShootCalendarData> {
  const days = daysBetween(windowStart, windowEnd);
  const properties = (fieldProperties ?? (await loadFieldProperties()))
    .filter((p) => p.kind === 'managed')
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  const ids = properties.map((p) => p.id);
  if (ids.length === 0 || days.length === 0) return { days, rows: [] };

  // creative_shoots is a few rows a month; a bare select is fine here.
  const [clear, { data: sData }] = await Promise.all([
    dayClearRange(ids, windowStart, windowEnd),
    fieldDb()
      .from('creative_shoots')
      .select('id, property_id, shoot_date, title, contractor_id, status')
      // A withdrawn offer and a declined one both free the day: the grid
      // shows it green again so the office can offer it to someone else.
      // Only a live offer or a real booking occupies a cell.
      .not('status', 'in', '(cancelled,declined)')
      .in('property_id', ids)
      .order('shoot_date', { ascending: false }),
  ]);
  const shoots = (sData ?? []) as ShootLite[];

  const inWindow = shoots.filter((s) => s.shoot_date >= windowStart && s.shoot_date <= windowEnd);
  const names = new Map<string, string>();
  const contractorIds = [...new Set(inWindow.map((s) => s.contractor_id))];
  if (contractorIds.length > 0) {
    const { data } = await fieldDb().from('contractors').select('id, full_name').in('id', contractorIds);
    for (const c of (data ?? []) as { id: string; full_name: string }[]) names.set(c.id, c.full_name);
  }
  const booked = new Map<string, ShootCalBooking>();
  // Descending date order, so the first one seen per (home, day) wins; a
  // second shoot on the same day is rare and still visible on the ledger.
  for (const s of inWindow) {
    if (!s.property_id) continue;
    const key = `${s.property_id}:${s.shoot_date}`;
    if (booked.has(key)) continue;
    const contractorName = names.get(s.contractor_id) ?? 'Contributor';
    booked.set(key, {
      id: s.id,
      title: s.title,
      who: initialsOf(contractorName) ?? '?',
      contractorName,
      pending: s.status === 'offered',
    });
  }

  const today = todayET();
  const lastShot = new Map<string, string>();
  for (const s of shoots) {
    // "last shoot here" means a day someone actually shot. An offer that was
    // never answered is not a visit, however old it is.
    if (!s.property_id || s.shoot_date > today || s.status === 'offered') continue;
    const cur = lastShot.get(s.property_id);
    if (!cur || s.shoot_date > cur) lastShot.set(s.property_id, s.shoot_date);
  }

  const rows: ShootCalRow[] = properties.map((p) => {
    const byDay = clear.get(p.id);
    return {
      propertyId: p.id,
      propertyName: p.name,
      lastShot: lastShot.get(p.id) ?? null,
      cells: days.map((date) => {
        const info = byDay?.get(date);
        const { state, reason } = cellState(info, date);
        return { date, state, reason, nextCheckin: info?.nextCheckin ?? null, shoot: booked.get(`${p.id}:${date}`) ?? null };
      }),
    };
  });
  return { days, rows };
}
