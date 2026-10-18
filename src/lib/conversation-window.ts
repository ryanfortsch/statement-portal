/**
 * The check-in windows the Conversations list walks (2026-10-18).
 *
 * The list was every confirmed stay within 60 days of today and nothing else,
 * so a guest from August was unreachable from Helm and the list simply ended.
 * The concierge now answers any check-in window up to 120 days (stay-concierge
 * #90), so the list can step back a window at a time, or jump to the dates
 * asked for. Past the floor, the list says older conversations are in Guesty
 * rather than ending without a word.
 */

/** The widest window one concierge list answers. */
export const WINDOW_DAYS = 120;
/** How far back Helm walks before it hands off to Guesty: two years. */
export const FLOOR_DAYS = 730;
export const GUESTY_INBOX_URL = 'https://app.guesty.com/';

const DAY = 86_400_000;

function toDate(ymd: string): Date {
  return new Date(`${ymd}T12:00:00Z`);
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return ymd(new Date(toDate(day).getTime() + n * DAY));
}

/** The window just before `from`: the WINDOW_DAYS days ending the day before. */
export function earlierWindow(from: string): { from: string; to: string } {
  return { from: addDays(from, -WINDOW_DAYS), to: addDays(from, -1) };
}

/** The oldest check-in Helm reaches for, from today. */
export function floorFor(today: string): string {
  return addDays(today, -FLOOR_DAYS);
}

/** True once the list has walked back to the floor. */
export function reachedFloor(from: string, today: string): boolean {
  return from <= floorFor(today);
}

/** Why a window cannot be asked for, or null when it can. */
export function windowProblem(from: string, to: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return 'Pick both dates.';
  if (to < from) return 'The second date is before the first.';
  if ((toDate(to).getTime() - toDate(from).getTime()) / DAY > WINDOW_DAYS) return `Pick ${WINDOW_DAYS} days or fewer at a time.`;
  return null;
}

/** "Jun 20 to Oct 17, 2026", the year once when both ends share it. */
export function formatWindow(from: string, to: string): string {
  const f = toDate(from);
  const t = toDate(to);
  const md = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const sameYear = f.getUTCFullYear() === t.getUTCFullYear();
  return `${md(f)}${sameYear ? '' : `, ${f.getUTCFullYear()}`} to ${md(t)}, ${t.getUTCFullYear()}`;
}

export function shortDay(day: string): string {
  return toDate(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
