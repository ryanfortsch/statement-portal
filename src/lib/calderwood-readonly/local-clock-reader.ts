/** Temporary, field-projected legacy API read for preview clock reconciliation only.
 * https://open-api-docs.guesty.com/reference/reservationsv2get documents local
 * plannedArrival/plannedDeparture overriding listing defaults. V3 eta/etd share
 * the search feed's observed timezone discrepancy and cannot verify that feed.
 */
import { CALDERWOOD } from './guesty-reader.ts';
import type { readCalderwoodGuesty } from './guesty-reader.ts';
import { normalizeCalderwoodLocalTiming } from './message-timing.ts';

type Reservation = Awaited<ReturnType<typeof readCalderwoodGuesty>>['reservations'][number];
type Fetcher = (input: string, init: RequestInit) => Promise<Response>;
const fields = '_id listingId checkInDateLocalized checkOutDateLocalized status plannedArrival plannedDeparture listing.defaultCheckInTime listing.defaultCheckOutTime listing.timezone';
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid clock response');
  return value as Record<string, unknown>;
}
export async function readCalderwoodLocalClocks(token: string, reservations: Reservation[], fetcher: Fetcher = fetch): Promise<Reservation[]> {
  if (typeof globalThis.window !== 'undefined' || !token.trim() || /[\r\n]/.test(token)) throw Error('Explicit server token required');
  const confirmed = reservations.filter(r => r.status === 'confirmed');
  // Bound this diagnostic to a small pilot. Narrow the review window for larger collections.
  if (confirmed.length > 12) throw Error('Local clock review is limited to 12 confirmed stays');
  const seen = new Set<string>();
  for (const r of confirmed) {
    if (!/^[a-f0-9]{24}$/i.test(r.id) || r.listingId !== CALDERWOOD.guestyListingId || seen.has(r.id)) throw Error('Invalid clock request scope');
    seen.add(r.id);
  }
  const result: Reservation[] = [];
  for (const r of reservations) {
    if (r.status !== 'confirmed') { result.push(r); continue; }
    let response: Response;
    try {
      response = await fetcher(`https://open-api.guesty.com/v1/reservations/${r.id}?${new URLSearchParams({ fields })}`, {
        method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000),
        headers: { Authorization: `Bearer ${token.trim()}`, Accept: 'application/json' },
      });
    } catch { throw Error('Local clock request failed; details withheld'); }
    if (!response.ok) throw Error(`Local clock HTTP ${response.status}; response withheld`);
    let d: Record<string, unknown>, listing: Record<string, unknown>;
    try { d = record(await response.json()); listing = record(d.listing); }
    catch { throw Error('Invalid local clock response; details withheld'); }
    if (d._id !== r.id || d.listingId !== r.listingId || d.status !== r.status
      || d.checkInDateLocalized !== r.start || d.checkOutDateLocalized !== r.end) throw Error('Reservation changed or clock response outside scope');
    result.push({ ...r, timing: normalizeCalderwoodLocalTiming({ start: r.start, end: r.end,
      timezone: listing.timezone, plannedArrival: d.plannedArrival, plannedDeparture: d.plannedDeparture,
      defaultArrival: listing.defaultCheckInTime, defaultDeparture: listing.defaultCheckOutTime,
    }, r.timing) });
  }
  return result;
}
