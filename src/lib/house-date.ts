/**
 * The house date in operator copy: "Fri, Oct 16". Never a raw ISO day in a
 * sentence a person reads (walk of 2026-10-18: "before 2026-10-16 check-in").
 *
 * Reads a YYYY-MM-DD (or the date part of a timestamp) as a calendar day, at
 * noon UTC, so no time zone moves it a day either way, on the server or in a
 * browser. Import-free, so a test, a client component and a generator of
 * stored text can all use it.
 */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Fri, Oct 16". Anything that is not a date comes back as given. */
export function houseDay(iso: string | null | undefined): string {
  const s = String(iso ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return String(iso ?? '');
  const d = new Date(`${s}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return s;
  return `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "Fri, Oct 16 to Mon, Oct 19". */
export function houseRange(from: string | null | undefined, to: string | null | undefined): string {
  return `${houseDay(from)} to ${houseDay(to)}`;
}
