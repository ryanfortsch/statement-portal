/**
 * The week grid on Turnovers: who is going where.
 *
 * One row per home, one column per day, today forward. A cell says what the
 * house is doing that day (a guest in, a guest leaving, a guest arriving, an
 * owner's hold, or open) and who is going there: the teammate who planned
 * the walk (inspection_plans), the contractor a Field packet is out to, or
 * whoever walked it. A tap on an open day before an arrival says "I'll walk
 * it that day"; a tap on your own mark lets it go. The record behind a tap
 * is the stay's inspection plan, the same row the board's walk column, the
 * home feed and the Field packet board already read, so one tap is seen
 * everywhere and nothing is stored twice.
 *
 * Pure, given the clock: the page reads the facts once (operations.ts) and
 * hands them in as GridStay rows; the browser recomposes the same grid with
 * the taps it has not yet confirmed layered over, so a tap shows at once.
 * No runtime imports, so node:test loads it.
 */

export type GridOccupant = { stayId: string; kind: 'guest' | 'block' };

export type GridDayCell = {
  date: string;
  /** The morning: who slept there last night (check_in < date <= check_out). */
  am: GridOccupant | null;
  /** The night: who sleeps there tonight (check_in <= date < check_out). */
  pm: GridOccupant | null;
};

export type GridHome = { id: string; name: string; cells: GridDayCell[] };

export type GridPlan = {
  id: string;
  /** YYYY-MM-DD, or null for a plan saved without a day. */
  date: string | null;
  assignee: string | null;
  plannedBy: string;
  /** Someone wrote a note on it: a release keeps the plan and drops the name. */
  hasNotes: boolean;
};

/** A guest arrival the house must be prepped for, as the grid needs it. */
export type GridStay = {
  reservationId: string;
  propertyId: string;
  /** YYYY-MM-DD */
  checkIn: string;
  checkOut: string;
  guest: string | null;
  /** bookings.channel: airbnb, vrbo, booking_com, direct, manual. */
  channel: string | null;
  plan: GridPlan | null;
  /** done = walked or marked ready; walking = a walk is underway. */
  walk: 'open' | 'walking' | 'done';
  /** The Eastern day the walk finished (done) or started (walking), and who. */
  walkedOn: string | null;
  walkedBy: string | null;
  /** A live Field packet covering this arrival: the contractor and their day. */
  field: { status: string; contractor: string | null; visitDate: string | null } | null;
};

export type BadgeKind = 'plan' | 'unassigned' | 'field' | 'walking' | 'walked';

export type GridBadge = {
  kind: BadgeKind;
  initials: string;
  name: string;
  email: string | null;
  mine: boolean;
  /** A planned day that passed with the walk still open. */
  late: boolean;
  stayId: string;
};

export type GridCellState = 'open' | 'occupied' | 'blocked';

/** What a tap on a cell does. The component asks before `take`. */
export type GridTap =
  | { kind: 'none' }
  | { kind: 'claim'; stay: GridStay }
  | { kind: 'move'; stay: GridStay }
  /** keep: the plan stays (someone else's, or it carries a note) and only
   *  the name comes off; otherwise your own tap is undone and it goes. */
  | { kind: 'release'; stay: GridStay; planId: string; keep: boolean }
  | { kind: 'take'; stay: GridStay; planId: string; holder: string; holderDay: string | null };

export type GridCell = {
  date: string;
  state: GridCellState;
  am: 'guest' | 'block' | null;
  pm: 'guest' | 'block' | null;
  /** The morning's guest leaves today (the bar ends mid-cell). */
  leaving: boolean;
  /** Tonight's guest arrives today (the bar starts mid-cell, the deadline). */
  arriving: boolean;
  /** Tonight's occupant is yesterday's: the bar runs through, no break. */
  continues: boolean;
  /** The arriving stay's channel on its arrival day (the dot on its bar);
   *  null on every other day. */
  channel: string | null;
  /** Workable, and the arrival after it still needs someone. */
  needs: boolean;
  /** The arrival is out to the Field roster and nobody has claimed it:
   *  the day asks for someone, but a tap here would walk the house twice. */
  fieldOpen: boolean;
  tap: GridTap;
  badges: GridBadge[];
};

export type GridRow = {
  propertyId: string;
  propertyName: string;
  cells: GridCell[];
  /** The next arrival nobody is covering yet, for the row's deadline chip. */
  nextNeed: string | null;
};

export type VisitGrid = {
  today: string;
  days: string[];
  rows: GridRow[];
  /** How many of my walks the grid shows, for the one-line summary. */
  mine: number;
};

export type VisitGridInput = {
  today: string;
  /** Today forward, in order. */
  days: string[];
  homes: GridHome[];
  stays: GridStay[];
  myEmail: string;
  nameFor: (email: string) => string;
  initialsFor: (email: string) => string;
  /** The one person behind an address: a teammate's Field contractor
   *  address and her Workspace email are the same hands. Default: the
   *  address itself. */
  identityFor?: (email: string) => string;
};

/** How many days before an arrival a walk is worth making: the arrival
 *  day and the three before it read green ("needs someone"). An earlier
 *  open day can still be tapped, but the board does not ask for it. */
export const PREP_DAYS = 3;

// ── small words ───────────────────────────────────────────────────────

const ET_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });

/** The Eastern day of an instant, or null. */
export function etDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : ET_DATE.format(d);
}

/** "Delaney Jordan" -> "DJ"; "Rosa" -> "R". */
export function initialsOfName(name: string | null | undefined): string | null {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

const lower = (e: string): string => e.trim().toLowerCase();

/** A Field packet that still covers the walk (a draft is nobody's yet). */
const LIVE_FIELD = new Set(['published', 'claimed', 'in_progress', 'submitted', 'approved']);

type WalkState = 'done' | 'walking' | 'field' | 'planned' | 'open';

function walkState(s: GridStay): WalkState {
  if (s.walk === 'done') return 'done';
  if (s.walk === 'walking') return 'walking';
  if (s.field && LIVE_FIELD.has(s.field.status)) return 'field';
  // A plan with a day but nobody named is still a house needing someone.
  if (s.plan?.date && s.plan.assignee?.trim()) return 'planned';
  return 'open';
}

/** A plan whose day passed with the walk still open. */
function isLate(s: GridStay, today: string): boolean {
  return s.walk === 'open' && !!s.plan?.date && s.plan.date < today;
}

/** The day a plan's mark sits on: its own day, or today once that day has
 *  passed with the walk still open, so a missed walk is never off-screen. */
function markDay(plan: GridPlan, today: string): string | null {
  if (!plan.date) return null;
  return plan.date < today ? today : plan.date;
}

// ── the grid ──────────────────────────────────────────────────────────

export function composeVisitGrid(input: VisitGridInput): VisitGrid {
  const { today, days, homes, myEmail, nameFor, initialsFor } = input;
  const identity = (e: string): string => lower(input.identityFor ? input.identityFor(e) : e);
  const me = myEmail.trim() ? identity(myEmail) : '';
  const same = (a: string | null | undefined, b: string): boolean => !!a && !!b && identity(a) === b;
  const staysByHome = new Map<string, GridStay[]>();
  for (const s of input.stays) {
    const list = staysByHome.get(s.propertyId) ?? [];
    list.push(s);
    staysByHome.set(s.propertyId, list);
  }
  for (const list of staysByHome.values()) list.sort((a, b) => a.checkIn.localeCompare(b.checkIn));

  const rows: GridRow[] = [];
  let mine = 0;

  for (const home of homes) {
    const stays = staysByHome.get(home.id) ?? [];
    const cellByDate = new Map(home.cells.map((c) => [c.date, c]));
    let seenArrival = false;
    let seenNeed = false;
    let seenBadge = false;

    const cells: GridCell[] = days.map((date, i) => {
      const c = cellByDate.get(date) ?? { date, am: null, pm: null };
      // Yesterday, from the home's own cells: the calendar carries the days
      // before today, so a guest who slept here last night runs through.
      const prev = cellByDate.get(i > 0 ? days[i - 1] : addDays(date, -1)) ?? null;
      const am = c.am;
      const pm = c.pm;
      const sameStay = !!am && !!pm && am.stayId === pm.stayId;
      const leaving = !!am && am.kind === 'guest' && !sameStay;
      const arriving = !!pm && pm.kind === 'guest' && !sameStay;
      const continues = !!am && !!prev?.pm && prev.pm.stayId === am.stayId;
      const state: GridCellState = sameStay ? (am!.kind === 'block' ? 'blocked' : 'occupied') : 'open';
      if (arriving) seenArrival = true;
      const arrival = arriving ? stays.find((s) => s.checkIn === date) ?? null : null;

      const next = stays.find((s) => s.checkIn >= date) ?? null;
      const ws = next ? walkState(next) : null;
      const late = !!next && isLate(next, today);
      const workable = state === 'open' && date >= today;
      const claimable = workable && !!next && (ws === 'open' || ws === 'planned');
      const inPrep = !!next && daysBetween(date, next.checkIn) <= PREP_DAYS;
      const fieldOpen = !!next && ws === 'field' && next.field!.status === 'published';
      const needs = (claimable && inPrep && (ws === 'open' || late)) || (fieldOpen && workable && inPrep);
      if (needs) seenNeed = true;

      // Who is going there that day, from every record Helm keeps.
      const badges: GridBadge[] = [];
      for (const s of stays) {
        if (s.walk === 'open' && s.plan && markDay(s.plan, today) === date) {
          const email = s.plan.assignee?.trim() || null;
          badges.push(
            email
              ? { kind: 'plan', initials: initialsFor(email), name: nameFor(email), email, mine: same(email, me), late: s.plan.date! < today, stayId: s.reservationId }
              : { kind: 'unassigned', initials: '?', name: `Planned by ${nameFor(s.plan.plannedBy)}, nobody named`, email: null, mine: false, late: s.plan.date! < today, stayId: s.reservationId },
          );
        }
        // A packet whose walk already happened is history: the walker's mark
        // says it, and the contractor is usually the same person.
        if (s.walk === 'open' && s.field && LIVE_FIELD.has(s.field.status) && s.field.visitDate === date) {
          badges.push({
            kind: 'field',
            initials: initialsOfName(s.field.contractor) ?? 'F',
            name: s.field.contractor ? `${s.field.contractor} (Field)` : 'Out to Field, unclaimed',
            email: null,
            mine: false,
            late: false,
            stayId: s.reservationId,
          });
        }
        if (s.walk !== 'open' && s.walkedOn === date) {
          const email = s.walkedBy?.trim() || null;
          badges.push({
            kind: s.walk === 'done' ? 'walked' : 'walking',
            initials: email ? initialsFor(email) : '✓',
            name: email ? nameFor(email) : s.walk === 'done' ? 'Walked' : 'Walking',
            email,
            mine: same(email, me),
            late: false,
            stayId: s.reservationId,
          });
        }
      }
      if (badges.length) seenBadge = true;
      for (const b of badges) if (b.mine && b.kind === 'plan') mine += 1;

      const tapFor = (stay: GridStay): GridTap => {
        const plan = stay.plan;
        const holder = plan?.assignee?.trim() || null;
        if (!plan || !plan.date || !holder) return { kind: 'claim', stay };
        if (!same(holder, me)) return { kind: 'take', stay, planId: plan.id, holder, holderDay: plan.date };
        if (markDay(plan, today) !== date) return { kind: 'move', stay };
        return { kind: 'release', stay, planId: plan.id, keep: plan.hasNotes || !same(plan.plannedBy, me) };
      };
      let tap: GridTap = { kind: 'none' };
      if (claimable && next) tap = tapFor(next);
      // A late mark carried to today belongs to a later stay than today's
      // own arrival: the tap acts on the mark, whatever the day's state.
      const carried = date === today ? stays.find((s) => s !== next && isLate(s, today)) ?? null : null;
      if (carried && (tap.kind === 'none' || tap.kind === 'claim')) tap = tapFor(carried);

      return {
        date,
        state,
        am: am?.kind ?? null,
        pm: pm?.kind ?? null,
        leaving,
        arriving,
        continues,
        channel: arrival?.channel ?? null,
        needs,
        fieldOpen,
        tap,
        badges,
      };
    });

    // Every home is on the grid, so the whole fleet is accounted for at a
    // glance (Dotti, 2026-10-31, after a quiet first week of November left
    // nine rows and the rest looked lost). A home with nothing coming sorts
    // to the bottom below, where it reads as quiet rather than missing.
    void seenArrival; void seenNeed; void seenBadge;

    const nextNeed =
      stays
        .filter((s) => s.checkIn >= today && (walkState(s) === 'open' || isLate(s, today)))
        .map((s) => s.checkIn)
        .sort()[0] ?? null;
    rows.push({ propertyId: home.id, propertyName: home.name, cells, nextNeed });
  }

  // The order the week happens in: the home that turns next at the top,
  // then by name; a home with no arrival ahead sorts last, by name. Stable
  // as people claim, so a house never jumps.
  const nextArrival = (r: GridRow): string =>
    (staysByHome.get(r.propertyId) ?? []).map((s) => s.checkIn).filter((d) => d >= today).sort()[0] ?? '9999-99-99';
  rows.sort((a, b) => nextArrival(a).localeCompare(nextArrival(b)) || a.propertyName.localeCompare(b.propertyName));

  return { today, days, rows, mine };
}

/** "today", "1d", "2d" for a deadline at most two days out; null beyond. */
export function deadlineChip(nextNeed: string | null, today: string): string | null {
  if (!nextNeed) return null;
  const n = daysBetween(today, nextNeed);
  if (n < 0 || n > 2) return null;
  return n === 0 ? 'today' : `${n}d`;
}

/** The days the grid shows: today and the next `n - 1`. */
export function gridDays(today: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) out.push(addDays(today, i));
  return out;
}

/** How many days the grid shows. Two weeks: the packet board's horizon,
 *  and a phone shows the first of them without scrolling. */
export const GRID_DAYS = 14;

// ── from the page's facts ─────────────────────────────────────────────

import type { CalendarData, Turnover } from './operations';

/** The homes and their days, from the occupancy calendar's half-day cells. */
export function homesFromCalendar(calendar: Pick<CalendarData, 'rows'>): GridHome[] {
  const occ = (r: { guesty_reservation_id: string; status: string | null } | null): GridOccupant | null =>
    r ? { stayId: r.guesty_reservation_id, kind: r.status === 'block' ? 'block' : 'guest' } : null;
  return calendar.rows.map((row) => ({
    id: row.property.id,
    name: row.property.name,
    cells: row.cells.map((c) => ({ date: c.date, am: occ(c.am), pm: occ(c.pm) })),
  }));
}

/** A turnover as the grid needs it: the arrival, its plan, its walk, its packet. */
export function toGridStay(t: Turnover): GridStay {
  const done = t.inspectionStatus === 'complete' || t.manuallyCompleted;
  const walking = !done && t.inspectionInProgress;
  const fp = t.fieldPacket ?? null;
  return {
    reservationId: t.reservationId,
    propertyId: t.propertyId,
    checkIn: t.checkIn.slice(0, 10),
    checkOut: t.checkOut.slice(0, 10),
    guest: t.guestName,
    channel: t.channel,
    plan: t.plan
      ? {
          id: t.plan.id,
          date: t.plan.planned_for_date,
          assignee: t.plan.assigned_to_email,
          plannedBy: t.plan.planned_by_email,
          hasNotes: !!t.plan.notes?.trim(),
        }
      : null,
    walk: done ? 'done' : walking ? 'walking' : 'open',
    walkedOn: done
      ? etDay(t.inspection?.completed_at ?? t.completedAt)
      : walking
        ? etDay(t.inspection?.started_at ?? t.inspectionStartedAt)
        : null,
    walkedBy: done ? (t.inspection?.inspector_email ?? t.completedByEmail ?? null) : walking ? (t.inspection?.inspector_email ?? null) : null,
    field: fp && fp.status !== 'draft' ? { status: fp.status, contractor: fp.contractorName, visitDate: fp.visitDate ?? null } : null,
  };
}
