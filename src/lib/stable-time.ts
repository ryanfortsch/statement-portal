/**
 * Time text a client component can render the same way on the server and in
 * the browser.
 *
 * A client component renders twice: once on the server (Vercel, UTC) for the
 * HTML, then again in the browser (Gloucester, Eastern) to hydrate it. Text
 * that differs between the two is React error #418 (walk of 2026-10-18), and
 * React throws the server HTML away. Two causes in Helm:
 *
 *   - A timestamp formatted with no time zone prints the server's UTC hour
 *     and the browser's Eastern hour: "2:15 PM" against "10:15 AM", every
 *     time. Format it here, in Gloucester's zone, and both agree (and the
 *     server copy is no longer four hours off).
 *   - An age read off the clock ("3m ago") can tick between the two renders.
 *     That one cannot be made equal; the element holding it carries
 *     `suppressHydrationWarning`, React's escape hatch for timestamps, and
 *     the next render brings it current.
 *
 * Import-free.
 */

export const GLOUCESTER_TZ = 'America/New_York';

/** "Oct 18, 10:15 AM" in Gloucester. Empty for an unreadable value. */
export function etStamp(
  iso: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { ...opts, timeZone: GLOUCESTER_TZ });
}
