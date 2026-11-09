/**
 * The operations manager's scorecard: four numbers Dotti picked for
 * Delaney on 2026-11-08, each measured from what Helm already stores. Pure,
 * so `npm test` pins every rule; the reads are in ops-scorecard-server.ts
 * and the band is components/OpsScorecard.tsx.
 *
 *   Guest rating            the 90-day average against the letter's 4.98
 *   Work board              under 120 open slips, none older than 60 days,
 *                           each closed with a clear note
 *   Perfection inspections  walks completed this week (Monday to today),
 *                           Helm's and the Field crew's, and what is planned
 *   Missing information     blank facts on the homes we manage, from the
 *                           property page's own Facts rows
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

/** 'plain' is a count with no standard behind it (walks this week): it
 *  prints in ink, neither met nor missed. */
export type TileState = 'met' | 'off' | 'unknown' | 'idle' | 'plain';

export type ScorecardTile = {
  key: 'rating' | 'work' | 'inspections' | 'missing';
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

/**
 * Walks completed this week, Monday through today (Eastern), from the one
 * `inspections` table Helm's walks and the Field crew's Perfection stops
 * both land in; `planned` is the week's remaining inspection_plans rows.
 */
export function inspectionsTile(i: { done: number; planned: number } | null): ScorecardTile {
  const base = { key: 'inspections' as const, label: 'Perfection inspections', href: '/inspections' };
  if (!i) return { ...base, value: UNAVAILABLE, detail: null, state: 'unknown' };
  const planned = i.planned > 0 ? ` · ${i.planned} planned` : '';
  return { ...base, value: String(i.done), detail: `this week${planned}`, state: 'plain' };
}

/**
 * The facts every managed home must carry, each a `col:` row on the
 * property page's Facts tab (ops-scorecard.test.ts reads the page to hold
 * that), so "missing information" is exactly what that page shows blank.
 * Conditional facts (gate code, HOA, a second Wi-Fi) are left out: a blank
 * there is often the truth.
 */
export const MISSING_INFO_COLUMNS = [
  'guest_access_method', 'key_code_location', 'supply_closet_location',
  'wifi_name', 'wifi_password', 'internet_provider',
  'bedrooms', 'bathrooms', 'heating', 'cooling',
  'trash_notes', 'parking',
  'gas_shutoff_location', 'water_shutoff_location', 'electrical_panel_location',
  'fire_extinguisher_locations', 'smoke_detector_locations',
  'emergency_contact_name', 'emergency_contact_phone',
] as const;

export type MissingInfoColumn = (typeof MISSING_INFO_COLUMNS)[number];

export function isBlankFact(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim() === '';
  return false;
}

/** Blank facts across the managed homes: the count, and how many homes carry one. */
export function countMissingInfo(homes: ReadonlyArray<Partial<Record<MissingInfoColumn, unknown>>>): { blanks: number; homes: number; homesWithBlanks: number } {
  let blanks = 0;
  let homesWithBlanks = 0;
  for (const h of homes) {
    const n = MISSING_INFO_COLUMNS.filter((c) => isBlankFact(h[c])).length;
    blanks += n;
    if (n > 0) homesWithBlanks += 1;
  }
  return { blanks, homes: homes.length, homesWithBlanks };
}

export function missingInfoTile(m: { blanks: number; homes: number; homesWithBlanks: number } | null): ScorecardTile {
  const base = { key: 'missing' as const, label: 'Missing information', href: '/properties' };
  if (!m) return { ...base, value: UNAVAILABLE, detail: null, state: 'unknown' };
  if (m.blanks === 0) return { ...base, value: 'None', detail: `every fact on ${m.homes} homes`, state: 'met' };
  return {
    ...base,
    value: `${m.blanks} blank${m.blanks === 1 ? '' : 's'}`,
    detail: `on ${m.homesWithBlanks} of ${m.homes} homes`,
    state: 'off',
  };
}

/** The Monday of the week holding `today` (YYYY-MM-DD). */
export function mondayOf(today: string): string {
  const d = new Date(`${today}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
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
