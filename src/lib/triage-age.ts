/**
 * How old a triage row on /crm can be before it folds.
 *
 * /crm opened on "New numbers reaching out · 50" on 2026-10-17 (the query
 * stopped at fifty; the queue was longer), each row a 24-option picker and
 * three buttons, with nothing to tell this week's stranger from one who
 * texted once in August. The Quo address-book box had the same shape.
 *
 * The rule: a row with no decision whose last sign of life is more than 30
 * days back (Eastern calendar days) folds under "Older · N". It is not
 * deleted and not dismissed; it can still be attached, added or skipped from
 * the fold. The count on each box is the last 30 days.
 *
 * - An unknown number's sign of life is its last message, else when it was
 *   first seen (quo_unknown_numbers.last_message_at is forward-only, so a
 *   backfill cannot make an old number look new).
 * - An address-book suggestion's is when the Quo contact was last edited
 *   (quo_contact_updated_at). The suggestion rows themselves are rebuilt
 *   every night, so their created_at says nothing about age.
 *
 * A row with no date at all reads as recent: absence is not evidence it is
 * stale, and a fold must never hide something new.
 *
 * Import-free so `npm test` covers it.
 */

export const TRIAGE_RECENT_DAYS = 30;

const ET_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });

/** The Eastern calendar day of an instant, YYYY-MM-DD. */
export function easternDay(iso: string): string {
  return ET_DAY.format(new Date(iso));
}

/** YYYY-MM-DD plus n days (noon-UTC anchor, DST-safe). */
export function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Older than the window: its last sign of life is before today minus `days`. */
export function isOlderThanWindow(
  activityIso: string | null | undefined,
  today: string,
  days: number = TRIAGE_RECENT_DAYS,
): boolean {
  if (!activityIso) return false;
  const t = Date.parse(activityIso);
  if (!Number.isFinite(t)) return false;
  return easternDay(activityIso) < shiftDay(today, -days);
}

export function unknownNumberActivity(u: {
  last_message_at: string | null;
  first_seen_at?: string | null;
}): string | null {
  return u.last_message_at ?? u.first_seen_at ?? null;
}

export function suggestionActivity(s: { quo_contact_updated_at?: string | null }): string | null {
  return s.quo_contact_updated_at ?? null;
}

/** Split a queue into the box (recent) and the fold (older), order kept. */
export function splitByAge<T>(
  rows: readonly T[],
  activityOf: (row: T) => string | null,
  today: string,
  days: number = TRIAGE_RECENT_DAYS,
): { recent: T[]; older: T[] } {
  const recent: T[] = [];
  const older: T[] = [];
  for (const r of rows) (isOlderThanWindow(activityOf(r), today, days) ? older : recent).push(r);
  return { recent, older };
}
