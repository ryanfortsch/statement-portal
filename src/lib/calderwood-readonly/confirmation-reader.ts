/** GET-only, bounded V3 confirmation evidence for the protected Calderwood preview.
 * https://open-api-docs.guesty.com/reference/reservationsopenapicontroller_getreservationsbyids
 * V3 detail has no field projection. Raw detail records never leave this reader.
 */
import { CALDERWOOD } from './guesty-reader.ts';
import type { readCalderwoodGuesty } from './guesty-reader.ts';

type Reservation = Awaited<ReturnType<typeof readCalderwoodGuesty>>['reservations'][number];
type Fetcher = (input: string, init: RequestInit) => Promise<Response>;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid confirmation response');
  return value as Record<string, unknown>;
}
export function confirmedInstant(value: unknown, now: Date): string | null {
  if (!Number.isFinite(now.getTime())) throw Error('Valid observation time required');
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) return null;
  const date = value.slice(0, 10), day = Date.parse(date + 'T00:00:00Z'), at = Date.parse(value);
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== date || !Number.isFinite(at) || at > now.getTime()) return null;
  return new Date(at).toISOString();
}
export async function readCalderwoodConfirmations(token: string, reservations: Reservation[], now: Date, fetcher: Fetcher = fetch): Promise<Reservation[]> {
  if (typeof globalThis.window !== 'undefined' || !token.trim() || /[\r\n]/.test(token) || !Number.isFinite(now.getTime())) throw Error('Explicit server token and observation time required');
  const confirmed = reservations.filter(r => r.status === 'confirmed');
  if (confirmed.length > 12) throw Error('Confirmation review is limited to 12 confirmed stays');
  const seen = new Set<string>();
  for (const r of confirmed) {
    if (!/^[a-f0-9]{24}$/i.test(r.id) || r.listingId !== CALDERWOOD.guestyListingId || seen.has(r.id)) throw Error('Invalid confirmation request scope');
    seen.add(r.id);
  }
  const confirmations = new Map<string, string | null>();
  // The supported endpoint accepts at most ten reservation IDs per request.
  for (let offset = 0; offset < confirmed.length; offset += 10) {
    const batch = confirmed.slice(offset, offset + 10), expected = new Map(batch.map(r => [r.id, r]));
    const query = new URLSearchParams();
    for (const r of batch) query.append('reservationIds[]', r.id);
    let response: Response;
    try {
      response = await fetcher(`https://open-api.guesty.com/v1/reservations-v3?${query}`, {
        method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${token.trim()}`, Accept: 'application/json' },
      });
    } catch { throw Error('Confirmation request failed; details withheld'); }
    if (!response.ok) throw Error(`Confirmation HTTP ${response.status}; response withheld`);
    let payload: unknown;
    try { payload = await response.json(); } catch { throw Error('Invalid confirmation JSON; details withheld'); }
    if (!Array.isArray(payload) || payload.length !== batch.length) throw Error('Incomplete confirmation response');
    for (const value of payload) {
      const d = record(value), r = typeof d._id === 'string' ? expected.get(d._id) : undefined;
      if (!r || confirmations.has(r.id) || d.status !== r.status || !Array.isArray(d.stay) || d.stay.length !== 1) throw Error('Confirmation identity or status mismatch');
      const stay = record(d.stay[0]);
      if (stay.unitId !== r.listingId || stay.unitTypeId !== r.listingId || stay.checkInDateLocalized !== r.start || stay.checkOutDateLocalized !== r.end) throw Error('Confirmation stay changed or outside scope');
      confirmations.set(r.id, confirmedInstant(d.confirmedAt, now));
    }
  }
  return reservations.map(r => r.status !== 'confirmed' ? r : {
    ...r, timing: { ...r.timing, confirmation: confirmations.get(r.id) ? { source: 'guesty-v3-confirmedAt' as const, at: confirmations.get(r.id)! } : null },
  });
}
