/**
 * The turnover board: one line per house per day.
 *
 * A row is one house turning: the guest who leaves (Out) and the guest who
 * arrives (In), with what stands between them, which is a clean and a walk.
 * Four facts a person needs at 9 AM print on the line, each from the one
 * place that knows it:
 *
 *   - the pair, "Out 10:00 · In 4:00": the departure time from the checkout
 *     schedule (adjustments included), the arrival from the home's rate plan;
 *   - the cleaner: Cape Ann Elite's own booking against that checkout
 *     (cleaning-days.ts), or what Helm saw of the clean itself;
 *   - the walk: walked, being walked, planned, covered by Field, or not;
 *   - one verb: Summary, Resume, Review, Start walk or Plan walk.
 *
 * Where a row sits: under the day the house next turns. That is the
 * departure day when it is today or later (the crew cleans that day), else
 * the arrival day. A row whose clean or walk is live right now sits under
 * Today whatever its dates, so Today holds everything in motion and there is
 * no separate band for it. A checkout with no arrival behind it is still a
 * row ("Out 10:00 · Vacant"), so every checkout's cleaner verdict is on the
 * board.
 *
 * Pure, given the clock: the page reads the time once and passes it, so the
 * strip and every row agree about what "today" and "now" are. No runtime
 * imports beyond rate-plan's timezone helper, so node:test loads it.
 */

import type { DepartureSignal, Turnover } from './operations';
import type { CleaningDay, CleaningItem, CleaningStatus } from './cleaning-days';
import { zonedTimeToMs } from './rate-plan.ts';

/** How a slot reads: ok and done are quiet, warn and bad ask for a human,
 *  live is something happening now, mute is not knowable yet. */
export type BoardTone = 'ok' | 'warn' | 'bad' | 'mute' | 'live' | 'done';

/** The states the strip above the board counts. Each is printed, in these
 *  exact words, on every row it counts, so the strip never names a state
 *  the rows do not show. */
export type BoardStateKey =
  | 'no_cleaner'
  | 'cleaner_late'
  | 'cleaner_early'
  | 'clean_unconfirmed'
  | 'cleaning_now'
  | 'walking'
  | 'needs_walk';

export const BOARD_STATE_LABEL: Record<BoardStateKey, string> = {
  no_cleaner: 'No cleaner booked',
  cleaner_late: 'Cleaner after check-in',
  cleaner_early: 'Cleaner before checkout',
  clean_unconfirmed: 'Clean not confirmed',
  cleaning_now: 'Cleaning now',
  walking: 'Walking',
  needs_walk: 'Needs walk',
};

/** Strip order: what can still be fixed by a phone call first. */
export const BOARD_STATE_ORDER: BoardStateKey[] = [
  'no_cleaner',
  'cleaner_late',
  'cleaner_early',
  'clean_unconfirmed',
  'cleaning_now',
  'walking',
  'needs_walk',
];

export type BoardSlot = {
  label: string;
  tone: BoardTone;
  /** The strip state this slot shows, if it is one the strip counts. */
  key: BoardStateKey | null;
};

export type BoardVerb = 'summary' | 'resume' | 'review' | 'start' | 'plan';

export type BoardRow = {
  /** DOM id. Turnover rows keep `turnover-<pid>-<reservationId>`, which the
   *  home feed and the property page already link to. */
  id: string;
  /** A second anchor, `out-<pid>-<date>`, on every row with a departure in
   *  the range, so the checkout schedule can link to the row by the one key
   *  it knows. Null when the row's id already is that key. */
  outAnchor: string | null;
  /** The board day the row sits under. */
  day: string;
  propertyId: string;
  propertyName: string;
  sameDay: boolean;
  out: {
    date: string;
    /** HH:MM 24h, from the checkout schedule; null when the schedule does not list it. */
    time: string | null;
    /** As the pair prints it: "10:00", "Sat". */
    when: string;
    guest: string | null;
    /** The departing stay's check-in as the checkout schedule keys it, for
     *  the `#stay-<pid>-<checkIn>` link. Null when the schedule does not list it. */
    scheduleCheckIn: string | null;
  } | null;
  arrive: { date: string; time: string; when: string; guest: string | null; nights: number | null } | null;
  /** "Out 10:00 · In 4:00" */
  pair: string;
  cleaner: BoardSlot | null;
  walk: BoardSlot | null;
  verb: BoardVerb | null;
  done: boolean;
  /** Lock-monitored homes show the six-stage rail when opened; the rest the
   *  three steps Helm can actually see (Out, Cleaned, Walked). */
  lockMonitored: boolean;
  /** When the clean finished, if Helm knows (any source). */
  cleanedAt: string | null;
  /** The arriving turnover. Null for a checkout with no arrival behind it. */
  turnover: Turnover | null;
};

export type BoardDay = { date: string; rows: BoardRow[] };

export type BoardCount = { key: BoardStateKey; label: string; n: number; firstId: string };

export type Board = {
  today: string;
  /** Rows still open, grouped by day in date order. */
  days: BoardDay[];
  /** Walked or marked ready (or, with no arrival, cleaned): folded at the end. */
  done: BoardRow[];
  counts: BoardCount[];
  total: number;
};

export type BoardInput = {
  turnovers: Turnover[];
  /** The crew's schedule for every day of the range (cleaning-schedule.ts),
   *  or null when it could not be read: the rows then carry no verdict. */
  cleaningDays: CleaningDay[] | null;
  departureSignals: Record<string, DepartureSignal>;
  today: string;
  rangeEnd: string;
  nowMs: number;
  /** Display name for a team email ("Delaney"). */
  nameFor?: (email: string) => string;
};

// ── time and date words ───────────────────────────────────────────────

/** "09:30" -> "9:30", "16:00" -> "4:00". The board's clock: twelve-hour,
 *  no AM/PM, because a checkout, a check-in and a cleaner's start are never
 *  ambiguous about which half of the day they are in. */
export function clock(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]) % 12 || 12;
  return `${h}:${m[2]}`;
}

const ET_CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: '2-digit',
  hourCycle: 'h12',
});
const ET_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });

/** The Eastern wall-clock time of an instant, "1:40". */
export function etClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return ET_CLOCK.format(d).replace(/\s?[AP]M$/i, '');
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "Thu" within a week of `ref`, else "Oct 30". */
export function shortDay(date: string, ref: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (Math.abs(daysBetween(ref, date)) <= 6) {
    return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(d);
  }
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
}

/** "today", "tomorrow", then shortDay. */
function relativeDay(date: string, today: string): string {
  if (date === today) return 'today';
  if (date === addDays(today, 1)) return 'tomorrow';
  return shortDay(date, today);
}

/** When the guest leaves, read from the board day: "10:00", "Sat", "Sat 10:00". */
export function outWhen(day: string, out: { date: string; time: string | null }): string {
  const when = [out.date !== day ? shortDay(out.date, day) : null, out.time ? clock(out.time) : null]
    .filter(Boolean)
    .join(' ');
  return when || 'today';
}

/** When the guest arrives, read from the board day: "4:00", "Thu 4:00", "Nov 2". */
export function inWhen(day: string, arrive: { date: string; time: string }): string {
  if (arrive.date === day) return clock(arrive.time);
  if (Math.abs(daysBetween(day, arrive.date)) > 6) return shortDay(arrive.date, day);
  return `${shortDay(arrive.date, day)} ${clock(arrive.time)}`;
}

/**
 * The row's pair, read from the board day it sits under: a time alone for
 * that day, a weekday for another day this week, a date beyond it.
 */
export function pairText(
  day: string,
  out: { date: string; time: string | null } | null,
  arrive: { date: string; time: string } | null,
): string {
  const parts: string[] = [];
  if (out) parts.push(`Out ${outWhen(day, out)}`);
  if (arrive) parts.push(`In ${inWhen(day, arrive)}`);
  else if (out) parts.push('Vacant');
  return parts.join(' · ');
}

// ── the lifecycle, on the Eastern clock ───────────────────────────────

export type BoardLifecycle = {
  checkedOut: boolean;
  cleaned: boolean;
  cleanerIn: boolean;
  inspected: boolean;
  inspecting: boolean;
  /** The stage being waited on, as the six-stage rail names it. */
  active: 'in' | 'cleaning' | 'clean' | 'inspected' | null;
  /** The check-in time has passed with something still open. */
  overdue: boolean;
  /** The prep window is live: something is happening, or the guest
   *  arrives within 36 hours. Start walk outranks Plan walk from here. */
  due: boolean;
};

const PREP_WINDOW_MS = 36 * 3_600_000;

/**
 * Where a turnover stands. The same stages the six-stage rail draws, but
 * on the Eastern clock: the check-in instant is the home's check-in time in
 * Gloucester, so a server in UTC and a phone in Eastern agree.
 */
export function boardLifecycle(t: Turnover, nowMs: number, today: string): BoardLifecycle {
  const cs = t.cleaningSession;
  const monitored = t.lockMonitored;
  const checkedOut = t.previousCheckout !== null && t.previousCheckout <= today;
  const cleanerIn = monitored && !!cs?.enteredAt;
  const cleaned = !!(cs?.finishedAt ?? t.cleaning);
  const inspected = t.inspectionStatus === 'complete' || t.manuallyCompleted;
  const inspecting = t.inspectionInProgress && !inspected;
  const target = zonedTimeToMs(t.checkIn.slice(0, 10), t.checkInTime || '16:00');
  const soon = target - nowMs < PREP_WINDOW_MS;
  const cleanDue = checkedOut && (t.isSameDayTurnover || soon);

  let active: BoardLifecycle['active'] = null;
  if (checkedOut) {
    if (monitored) {
      if (!cleanerIn && !cleaned) active = cleanDue ? 'in' : null;
      else if (!cleaned) active = 'cleaning';
      else if (!inspected) active = inspecting || cleanDue ? 'inspected' : null;
    } else if (!cleaned) {
      active = cleanDue ? 'clean' : null;
    } else if (!inspected) {
      active = inspecting || cleanDue ? 'inspected' : null;
    }
  }
  return {
    checkedOut,
    cleaned,
    cleanerIn,
    inspected,
    inspecting,
    active,
    overdue: active !== null && target < nowMs,
    due: active !== null || soon,
  };
}

// ── slots ─────────────────────────────────────────────────────────────

function verdictSlot(status: CleaningStatus, time: string | null): BoardSlot | null {
  const at = time ? clock(time) : '';
  switch (status) {
    case 'agree':
    case 'unchecked':
      return { label: at ? `Cleaner booked ${at}` : 'Cleaner booked', tone: 'ok', key: null };
    case 'early':
      return { label: `${BOARD_STATE_LABEL.cleaner_early}${at ? ` · ${at}` : ''}`, tone: 'warn', key: 'cleaner_early' };
    case 'late':
      return { label: `${BOARD_STATE_LABEL.cleaner_late}${at ? ` · ${at}` : ''}`, tone: 'bad', key: 'cleaner_late' };
    case 'no_appointment':
      return { label: BOARD_STATE_LABEL.no_cleaner, tone: 'bad', key: 'no_cleaner' };
    case 'unannounced':
      return { label: 'Not announced yet', tone: 'mute', key: null };
    case 'no_checkout':
      return null;
  }
}

/**
 * What the row says about the clean. A finished clean outranks everything;
 * a cleaner keyed in (lock homes) is next; before and on the checkout day
 * the vendor's own booking speaks; once the checkout day has passed with no
 * signal, Helm says only that nobody confirmed it.
 */
function cleanerSlot(args: {
  outDate: string | null;
  today: string;
  cleanedAt: string | null;
  cleaned: boolean;
  cleaningNow: boolean;
  verdict: CleaningItem | null;
  skipped: boolean;
  due: boolean;
  /** Walked or marked ready: a house someone has signed off is not a clean
   *  anyone needs to chase, whatever the cleaner did or did not text. */
  signedOff: boolean;
}): BoardSlot | null {
  const { outDate, today, cleanedAt, cleaned, cleaningNow, verdict, skipped, due, signedOff } = args;
  if (!outDate) return null;
  if (cleaned) {
    const sameDay = cleanedAt ? ET_DATE.format(new Date(cleanedAt)) === today : false;
    return { label: sameDay && cleanedAt ? `Cleaned ${etClock(cleanedAt)}` : 'Cleaned', tone: 'done', key: null };
  }
  if (cleaningNow) return { label: BOARD_STATE_LABEL.cleaning_now, tone: 'live', key: 'cleaning_now' };
  if (skipped) return { label: 'No cleaning needed', tone: 'mute', key: null };
  if (outDate >= today) return verdict ? verdictSlot(verdict.status, verdict.cleaningTime) : null;
  if (signedOff) return null;
  return { label: BOARD_STATE_LABEL.clean_unconfirmed, tone: due ? 'warn' : 'mute', key: 'clean_unconfirmed' };
}

function firstName(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

/** What the row says about the walk. */
export function walkSlot(
  t: Turnover,
  lc: BoardLifecycle,
  today: string,
  nameFor: (email: string) => string = firstName,
): BoardSlot {
  if (t.inspectionStatus === 'complete') return { label: 'Walked', tone: 'done', key: null };
  if (t.manuallyCompleted) return { label: 'Marked ready', tone: 'done', key: null };
  if (lc.inspecting) return { label: BOARD_STATE_LABEL.walking, tone: 'live', key: 'walking' };
  const fp = t.fieldPacket;
  if (fp && fp.status !== 'draft') {
    if (fp.status === 'published') return { label: 'Field · open for claim', tone: 'warn', key: null };
    if (fp.status === 'claimed' || fp.status === 'in_progress') {
      const who = fp.contractorName ?? 'claimed';
      return fp.stopActive
        ? { label: `Field · ${who} on site`, tone: 'live', key: null }
        : { label: `Field · ${who}`, tone: 'ok', key: null };
    }
    if (fp.status === 'submitted') return { label: 'Field · submitted', tone: 'warn', key: null };
    if (fp.status === 'approved') return { label: 'Field · done', tone: 'done', key: null };
  }
  // A planned walk names its day and its person all the way through the prep
  // window (Ryan, 10/15: a self-assigned walk should say whose it is).
  if (t.plan?.planned_for_date) {
    const who = t.plan.assigned_to_email?.trim() ? nameFor(t.plan.assigned_to_email.trim()) : null;
    return { label: `Walk ${relativeDay(t.plan.planned_for_date, today)}${who ? ` · ${who}` : ''}`, tone: 'ok', key: null };
  }
  if (lc.active === 'inspected') {
    return { label: BOARD_STATE_LABEL.needs_walk, tone: lc.overdue ? 'bad' : 'warn', key: 'needs_walk' };
  }
  return { label: 'Not walked', tone: 'mute', key: null };
}

/** The one verb a row offers. Mark ready and Undo live in the opened row. */
export function walkVerb(t: Turnover, lc: BoardLifecycle): BoardVerb | null {
  if (t.inspectionStatus === 'complete') return t.inspection ? 'summary' : null;
  if (t.manuallyCompleted) return null;
  if (t.inspection) return 'resume';
  const fp = t.fieldPacket;
  // A live Field packet covers the walk: a staff Start would walk the house
  // twice. A draft is not published to anyone, so it never blocks Start.
  if (fp && fp.status !== 'draft') return fp.status === 'submitted' ? 'review' : null;
  return lc.due ? 'start' : 'plan';
}

// ── the board ─────────────────────────────────────────────────────────

type ScheduleEntry = {
  date: string;
  propertyId: string;
  item: CleaningItem | null;
  skipped: boolean;
  propertyName: string;
  guestName: string | null;
  checkIn: string;
  checkoutTime: string;
  consumed: boolean;
};

function displayGuest(name: string | null): string | null {
  const n = (name ?? '').trim();
  if (!n) return null;
  return /^(reservation|tbd|guest|n\/a|hold|blocked|airbnb|vrbo|not)$/i.test(n.split(/\s+/)[0]) ? null : n;
}

export function composeBoard(input: BoardInput): Board {
  const { turnovers, cleaningDays, departureSignals, today, rangeEnd, nowMs } = input;
  const nameFor = input.nameFor ?? firstName;

  // Every checkout on the crew's schedule, by day and by stay, so a turnover
  // finds its departure even when Helm moved it (an extension changes the
  // date, never the stay's check-in).
  const byDay = new Map<string, ScheduleEntry>();
  const byStay = new Map<string, ScheduleEntry>();
  const entries: ScheduleEntry[] = [];
  for (const day of cleaningDays ?? []) {
    for (const item of day.items) {
      if (item.checkoutTime === null || item.checkIn === null) continue; // a vendor visit with no checkout
      entries.push({
        date: day.date,
        propertyId: item.propertyId,
        item,
        skipped: false,
        propertyName: item.propertyName,
        guestName: item.guestName,
        checkIn: item.checkIn,
        checkoutTime: item.checkoutTime,
        consumed: false,
      });
    }
    for (const s of day.skipped ?? []) {
      entries.push({
        date: day.date,
        propertyId: s.propertyId,
        item: null,
        skipped: true,
        propertyName: s.propertyName,
        guestName: s.guestName,
        checkIn: s.checkIn,
        checkoutTime: s.checkoutTime,
        consumed: false,
      });
    }
  }
  for (const e of entries) {
    byDay.set(`${e.propertyId}|${e.date}`, e);
    byStay.set(`${e.propertyId}|${e.checkIn}`, e);
  }

  const rows: BoardRow[] = [];

  for (const t of turnovers) {
    const lc = boardLifecycle(t, nowMs, today);
    const sched =
      (t.previousCheckout ? byDay.get(`${t.propertyId}|${t.previousCheckout}`) : undefined) ??
      (t.previousStayCheckIn ? byStay.get(`${t.propertyId}|${t.previousStayCheckIn}`) : undefined) ??
      null;
    if (sched) sched.consumed = true;

    const outDate = sched?.date ?? t.previousCheckout;
    const outBase = outDate ? { date: outDate, time: sched?.checkoutTime ?? null } : null;
    const arriveBase = { date: t.checkIn.slice(0, 10), time: t.checkInTime || '16:00' };

    // The clean is live (or the house is being walked) right now: Today.
    const live = lc.active === 'in' || lc.active === 'cleaning' || lc.active === 'clean' || lc.inspecting;
    let day: string;
    if (outBase && outBase.date >= today && outBase.date <= rangeEnd) day = outBase.date;
    else if (live && (!outBase || outBase.date < today)) day = today;
    else day = arriveBase.date;
    if (day < today || day > rangeEnd) continue;

    const out = outBase
      ? {
          ...outBase,
          when: outWhen(day, outBase),
          guest: displayGuest(sched?.guestName ?? t.previousGuestName),
          scheduleCheckIn: sched?.checkIn ?? null,
        }
      : null;
    const arrive = { ...arriveBase, when: inWhen(day, arriveBase), guest: displayGuest(t.guestName), nights: t.nights };

    const cleanedAt = t.cleaningSession?.finishedAt ?? t.cleaning?.completedAt ?? null;
    const cleaner = cleanerSlot({
      outDate: out?.date ?? null,
      today,
      cleanedAt,
      cleaned: lc.cleaned,
      cleaningNow: lc.active === 'cleaning',
      verdict: sched?.item ?? null,
      skipped: sched?.skipped ?? false,
      due: lc.due,
      signedOff: lc.inspected,
    });

    const inRange = !!out && out.date >= today && out.date <= rangeEnd;
    rows.push({
      id: `turnover-${t.propertyId}-${t.reservationId}`,
      outAnchor: inRange && out ? `out-${t.propertyId}-${out.date}` : null,
      day,
      propertyId: t.propertyId,
      propertyName: t.propertyName,
      sameDay: !!out && out.date === arrive.date,
      out,
      arrive,
      pair: pairText(day, out, arrive),
      cleaner,
      walk: walkSlot(t, lc, today, nameFor),
      verb: walkVerb(t, lc),
      done: t.inspectionStatus === 'complete' || t.manuallyCompleted,
      lockMonitored: t.lockMonitored,
      cleanedAt,
      turnover: t,
    });
  }

  // A checkout nobody arrives after: still a house the crew turns.
  for (const e of entries) {
    if (e.consumed || e.date < today || e.date > rangeEnd) continue;
    const pid = e.propertyId;
    const signal = departureSignals[`${pid}|${e.date}`] ?? null;
    const cleanedAt = signal?.cleanedAt ?? null;
    const out = {
      date: e.date,
      time: e.checkoutTime,
      when: outWhen(e.date, { date: e.date, time: e.checkoutTime }),
      guest: displayGuest(e.guestName),
      scheduleCheckIn: e.checkIn,
    };
    rows.push({
      id: `out-${pid}-${e.date}`,
      outAnchor: null,
      day: e.date,
      propertyId: pid,
      propertyName: e.propertyName,
      sameDay: false,
      out,
      arrive: null,
      pair: pairText(e.date, out, null),
      cleaner: cleanerSlot({
        outDate: e.date,
        today,
        cleanedAt,
        cleaned: !!cleanedAt,
        cleaningNow: signal?.cleaningNow ?? false,
        verdict: e.item,
        skipped: e.skipped,
        due: false,
        signedOff: false,
      }),
      walk: null,
      verb: null,
      done: !!cleanedAt || e.skipped,
      lockMonitored: false,
      cleanedAt,
      turnover: null,
    });
  }

  // Within a day, the order the day happens in: a row's own event time on
  // that day (its checkout, else its check-in), then the house.
  const eventTime = (r: BoardRow): string =>
    r.out && r.out.date === r.day ? (r.out.time ?? '10:00') : r.arrive && r.arrive.date === r.day ? r.arrive.time : '00:00';
  rows.sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      eventTime(a).localeCompare(eventTime(b)) ||
      a.propertyName.localeCompare(b.propertyName),
  );

  const days: BoardDay[] = [];
  const done: BoardRow[] = [];
  for (const r of rows) {
    if (r.done) {
      done.push(r);
      continue;
    }
    const last = days[days.length - 1];
    if (last && last.date === r.day) last.rows.push(r);
    else days.push({ date: r.day, rows: [r] });
  }

  const tally = new Map<BoardStateKey, { n: number; firstId: string }>();
  for (const d of days) {
    for (const r of d.rows) {
      for (const key of [r.cleaner?.key, r.walk?.key]) {
        if (!key) continue;
        const cur = tally.get(key);
        if (cur) cur.n += 1;
        else tally.set(key, { n: 1, firstId: r.id });
      }
    }
  }
  const counts: BoardCount[] = BOARD_STATE_ORDER.filter((k) => tally.has(k)).map((k) => ({
    key: k,
    label: BOARD_STATE_LABEL[k],
    n: tally.get(k)!.n,
    firstId: tally.get(k)!.firstId,
  }));

  return { today, days, done, counts, total: rows.length };
}
