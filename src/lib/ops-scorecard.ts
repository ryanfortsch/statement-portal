/**
 * The operations manager's scorecard: three numbers Dotti picked for
 * Delaney (2026-11-08, cut to three on 11-09), each measured from what Helm
 * already stores. Pure, so `npm test` pins every rule; the reads are in
 * ops-scorecard-server.ts and the band is components/OpsScorecard.tsx.
 *
 *   Guest rating         the 90-day average against the letter's 4.98; the
 *                        lead tile
 *   Work board           under 120 open slips, none older than 60 days,
 *                        each closed with a clear note
 *   Missing information  blank facts on the homes we manage, from the
 *                        property page's own Facts rows
 *
 * Each tile prints its goal beside the number (`goal`) and one quiet line
 * under it (`detail`): the fact that says where the number stands.
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

export type TileState = 'met' | 'off' | 'unknown' | 'idle';

export type ScorecardTile = {
  key: 'rating' | 'work' | 'missing';
  label: string;
  value: string;
  /** The standard, printed beside the number ("goal 4.98"). */
  goal: string;
  /** The one quiet line under the number: the fact that says where it
   *  stands. Never more than that. */
  detail: string | null;
  state: TileState;
  href: string;
};

const UNAVAILABLE = 'Unavailable';

export function ratingTile(r: { avg: number | null; total: number } | null): ScorecardTile {
  const base = { key: 'rating' as const, label: 'Guest rating', goal: `goal ${RATING_GOAL}`, href: '/guests' };
  if (!r) return { ...base, value: UNAVAILABLE, detail: null, state: 'unknown' };
  if (r.avg == null || r.total === 0) return { ...base, value: 'No reviews', detail: `last ${RATING_WINDOW_DAYS} days`, state: 'idle' };
  // Two decimals, rounded down, so 4.979 never reads as the 4.98 it missed.
  const shown = Math.floor(r.avg * 100 + 1e-9) / 100;
  return {
    ...base,
    value: shown.toFixed(2),
    detail: `${r.total} review${r.total === 1 ? '' : 's'}, ${RATING_WINDOW_DAYS} days`,
    state: shown >= RATING_GOAL ? 'met' : 'off',
  };
}

export function workTile(w: { open: number; oldestDays: number | null; closed: number; closedWithNote: number } | null): ScorecardTile {
  const base = { key: 'work' as const, label: 'Work board', goal: `goal under ${OPEN_SLIPS_GOAL}`, href: '/work' };
  if (!w) return { ...base, value: UNAVAILABLE, detail: null, state: 'unknown' };
  const tooOld = w.oldestDays != null && w.oldestDays > OLDEST_SLIP_GOAL_DAYS;
  const notesMissing = w.closedWithNote < w.closed;
  const met = w.open < OPEN_SLIPS_GOAL && !tooOld && !notesMissing;
  // One line: the fact that decides the tile today, the count being the
  // number above. The oldest slip, then the notes, then all clear.
  const detail =
    tooOld ? `oldest ${w.oldestDays} days, goal ${OLDEST_SLIP_GOAL_DAYS}`
    : notesMissing ? `notes on ${w.closedWithNote} of ${w.closed}`
    : w.oldestDays != null ? `oldest ${w.oldestDays} day${w.oldestDays === 1 ? '' : 's'}`
    : 'nothing open';
  return { ...base, value: `${w.open} open`, detail, state: met ? 'met' : 'off' };
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
  const base = { key: 'missing' as const, label: 'Missing information', goal: 'goal none', href: '/properties' };
  if (!m) return { ...base, value: UNAVAILABLE, detail: null, state: 'unknown' };
  if (m.blanks === 0) return { ...base, value: 'None', detail: `every fact on ${m.homes} homes`, state: 'met' };
  return {
    ...base,
    value: `${m.blanks} blank${m.blanks === 1 ? '' : 's'}`,
    detail: `on ${m.homesWithBlanks} of ${m.homes} homes`,
    state: 'off',
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
