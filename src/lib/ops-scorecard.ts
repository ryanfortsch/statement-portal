/**
 * The operations manager's scorecard: the goals in Delaney's offer letter
 * ("What success looks like", due May 1, 2027), measured from what Helm
 * already stores. Pure, so `npm test` pins every rule; the reads are in
 * ops-scorecard-server.ts and the band is components/OpsScorecard.tsx.
 *
 * Each tile reads one standard from the letter:
 *   Guest rating     a 4.98-star average across the portfolio
 *   Work board       under 120 open slips, none older than 60 days, each
 *                    closed with a clear note
 *   Cleaner schedule checked every workday (the day's digest went out)
 *   Statement close  field data on time every month
 *   Home records     room-by-room details and guest notes for every home
 *   Winter care      a logged weekly check of every empty home, Dec to Apr
 *
 * A tile whose read failed says so ("Unavailable") and is never counted as
 * met: absence is not a fact.
 */

export const SCORECARD_DUE = '2027-05-01';
export const RATING_GOAL = 4.98;
export const RATING_WINDOW_DAYS = 90;
export const OPEN_SLIPS_GOAL = 120;
export const OLDEST_SLIP_GOAL_DAYS = 60;
export const NOTE_WINDOW_DAYS = 30;
export const SCHEDULE_WINDOW_DAYS = 7;
export const WINTER_CHECK_DAYS = 7;

export type TileState = 'met' | 'off' | 'unknown' | 'idle';

export type ScorecardTile = {
  key: 'rating' | 'work' | 'schedule' | 'close' | 'records' | 'winter';
  label: string;
  value: string;
  /** The one quiet line under the number: the goal, and the fact that
   *  says why it is met or missed. Never more than that. */
  detail: string | null;
  state: TileState;
  href: string;
};

const UNAVAILABLE = 'Unavailable';

export function ratingTile(r: { avg: number | null; total: number } | null): ScorecardTile {
  const base = { key: 'rating' as const, label: 'Guest rating', href: '/guests' };
  if (!r) return { ...base, value: UNAVAILABLE, detail: null, state: 'unknown' };
  if (r.avg == null || r.total === 0) return { ...base, value: 'No reviews', detail: `goal ${RATING_GOAL} · ${RATING_WINDOW_DAYS} days`, state: 'idle' };
  // Two decimals, rounded down, so 4.979 never reads as the 4.98 it missed.
  const shown = Math.floor(r.avg * 100 + 1e-9) / 100;
  return {
    ...base,
    value: shown.toFixed(2),
    detail: `goal ${RATING_GOAL} · ${r.total} review${r.total === 1 ? '' : 's'}`,
    state: shown >= RATING_GOAL ? 'met' : 'off',
  };
}

export function workTile(w: { open: number; oldestDays: number | null; closed: number; closedWithNote: number } | null): ScorecardTile {
  const base = { key: 'work' as const, label: 'Work board', href: '/work' };
  if (!w) return { ...base, value: UNAVAILABLE, detail: null, state: 'unknown' };
  const tooOld = w.oldestDays != null && w.oldestDays > OLDEST_SLIP_GOAL_DAYS;
  const notesMissing = w.closedWithNote < w.closed;
  const met = w.open < OPEN_SLIPS_GOAL && !tooOld && !notesMissing;
  // One line: the standard that decides the tile today. The count first,
  // because it is the number above; then the oldest slip; then the notes.
  const detail =
    w.open >= OPEN_SLIPS_GOAL ? `goal under ${OPEN_SLIPS_GOAL}`
    : tooOld ? `oldest ${w.oldestDays} days, goal ${OLDEST_SLIP_GOAL_DAYS}`
    : notesMissing ? `notes on ${w.closedWithNote} of ${w.closed}`
    : `under ${OPEN_SLIPS_GOAL}, none over ${OLDEST_SLIP_GOAL_DAYS}`;
  return { ...base, value: `${w.open} open`, detail, state: met ? 'met' : 'off' };
}

export function scheduleTile(s: { days: number; sent: number } | null): ScorecardTile {
  const base = { key: 'schedule' as const, label: 'Cleaner schedule', href: '/turnovers/schedule' };
  if (!s) return { ...base, value: UNAVAILABLE, detail: null, state: 'unknown' };
  if (s.days === 0) return { ...base, value: 'No cleanings', detail: `last ${SCHEDULE_WINDOW_DAYS} days`, state: 'idle' };
  return {
    ...base,
    value: `${s.sent} of ${s.days}`,
    detail: `days sent, last ${SCHEDULE_WINDOW_DAYS}`,
    state: s.sent >= s.days ? 'met' : 'off',
  };
}

export type CloseInput = {
  /** The month whose field handoff is in play, YYYY-MM. */
  month: string;
  monthName: string;
  /** Its due date, YYYY-MM-DD, and how it prints ("Nov 27"). */
  due: string;
  dueLabel: string;
  today: string;
  open: number;
  sent: number;
  /** The latest send, YYYY-MM-DD (Eastern), when anything was sent. */
  lastSentDay: string | null;
};

export function closeTile(c: CloseInput | null): ScorecardTile {
  const base = { key: 'close' as const, label: 'Statement close', href: '/fieldwork/close' };
  if (!c) return { ...base, value: UNAVAILABLE, detail: null, state: 'unknown' };
  const href = `/fieldwork/close?month=${c.month}`;
  if (c.open > 0) {
    const late = c.today > c.due;
    return {
      ...base,
      href,
      value: `${c.open} to send`,
      detail: `${c.monthName} · ${late ? 'was due' : 'due'} ${c.dueLabel}`,
      state: late ? 'off' : 'idle',
    };
  }
  if (c.sent > 0 && c.lastSentDay) {
    const onTime = c.lastSentDay <= c.due;
    return { ...base, href, value: onTime ? 'On time' : 'Late', detail: `${c.monthName} · due ${c.dueLabel}`, state: onTime ? 'met' : 'off' };
  }
  return { ...base, href, value: 'Nothing yet', detail: `${c.monthName} · due ${c.dueLabel}`, state: 'idle' };
}

/** Which month's handoff the tile follows: the previous month until its
 *  close window ends, then the current one. */
export function closeMonthFor(today: string, closeWindowDay: number): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const d = Number(today.slice(8, 10));
  if (d > closeWindowDay) return today.slice(0, 7);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function recordsTile(r: { homes: number; complete: number } | null): ScorecardTile {
  const base = { key: 'records' as const, label: 'Home records', href: '/properties' };
  if (!r) return { ...base, value: UNAVAILABLE, detail: null, state: 'unknown' };
  return {
    ...base,
    value: `${r.complete} of ${r.homes}`,
    detail: 'rooms and guest notes',
    state: r.homes > 0 && r.complete >= r.homes ? 'met' : 'off',
  };
}

/** December through April, the letter's winter. */
export function isWinter(today: string): boolean {
  const m = Number(today.slice(5, 7));
  return m === 12 || m <= 4;
}

export function winterTile(today: string, w: { empty: number; checked: number } | null): ScorecardTile {
  const base = { key: 'winter' as const, label: 'Winter care', href: '/turnovers' };
  if (!isWinter(today)) return { ...base, value: 'Starts Dec 1', detail: 'weekly, Dec to Apr', state: 'idle' };
  if (!w) return { ...base, value: UNAVAILABLE, detail: null, state: 'unknown' };
  if (w.empty === 0) return { ...base, value: 'No empty homes', detail: 'nothing to check', state: 'met' };
  return {
    ...base,
    value: `${w.checked} of ${w.empty}`,
    detail: `empty homes, ${WINTER_CHECK_DAYS} days`,
    state: w.checked >= w.empty ? 'met' : 'off',
  };
}

/** Whole days from an ISO timestamp's date to `today` (YYYY-MM-DD). */
export function ageDays(createdIso: string, today: string): number {
  const a = Date.UTC(Number(createdIso.slice(0, 4)), Number(createdIso.slice(5, 7)) - 1, Number(createdIso.slice(8, 10)));
  const b = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** A closing note counts when it says something: more than a word or two. */
export function hasClearNote(note: string | null | undefined): boolean {
  return (note ?? '').trim().length >= 12;
}

/** Who sees the band: the operations seat it measures, and the owners who
 *  set it (in their own view or in View as staff, so they can preview it). */
export function seesScorecard(args: { teamRole: string | null | undefined; ownerLogin: boolean }): boolean {
  return args.ownerLogin || args.teamRole === 'operations';
}
