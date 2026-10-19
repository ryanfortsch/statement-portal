/**
 * When a packet trade is paid (Dotti, 2026-10-19): weekly, on Friday, for
 * every trip approved by the end of Wednesday, Cape Ann time. A trip
 * approved Thursday through Sunday is paid the Friday after.
 *
 * Inspection and maintenance trips only. Creative contributors are paid
 * monthly on their own ledger and never read this.
 *
 * Pure, under test (field-payday.test.ts).
 */

export const PAYDAY_RULE = 'Paid Fridays. A trip approved by Wednesday is paid that Friday.';

const TZ = 'America/New_York';
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The Cape Ann calendar day of an instant, as YYYY-MM-DD, and its weekday (0 = Sunday). */
function easternDay(iso: string): { day: string; weekday: number } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, weekday: WEEKDAY.indexOf(get('weekday')) };
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The Friday a trip approved at `approvedAt` is paid, as YYYY-MM-DD. */
export function paydayFor(approvedAt: string): string | null {
  const e = easternDay(approvedAt);
  if (!e) return null;
  // Days to the coming Friday (0 on a Friday). Sunday through Wednesday are
  // paid that Friday, and Saturday's coming Friday is already the next week.
  // Thursday and Friday missed the Wednesday cutoff: a week later.
  const toFriday = (5 - e.weekday + 7) % 7;
  return addDays(e.day, e.weekday === 4 || e.weekday === 5 ? toFriday + 7 : toFriday);
}

/** "Friday, Oct 24", for a YYYY-MM-DD payday. */
export function paydayWords(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
