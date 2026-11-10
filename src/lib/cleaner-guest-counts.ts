import { z } from 'zod';
import type { CleanerReportBooking, CleanerStayReport } from './cleaner-stay-report.ts';
import { GUESTY_ACCOUNT, GUESTY_CALDERWOOD } from './channex-bookings/message-identity.ts';

const objectId = z.string().regex(/^[a-f0-9]{24}$/);
const mirrorSchema = z.array(z.object({
  guesty_reservation_id: z.string().min(1).max(200), property_id: z.literal('65_calderwood'),
  listing_id: objectId.nullable(), confirmation_code: z.string().max(160).nullable(),
  check_in: z.iso.date().nullable(), check_out: z.iso.date().nullable(), status: z.string().nullable(),
}).strict()).max(5000);
export type CleanerCountContext = {
  report: CleanerStayReport; bookings: CleanerReportBooking[];
  authority: 'guesty' | 'helm'; mirror: unknown;
};
type CountTarget = { id: string; code: string; checkIn: string; checkOut: string };
const normalize = (value: string | null) => value?.trim().toUpperCase() || null;

/** Missing counts may be enriched for this private preview only. An exact,
 * unique confirmation code discovers the source ID; dates alone never do. */
export function resolveCleanerCountTargets(context: CleanerCountContext): CountTarget[] {
  if (context.authority !== 'guesty') throw Error('Counts unavailable');
  const mirror = mirrorSchema.parse(context.mirror);
  if (new Set(mirror.map(r => r.guesty_reservation_id)).size !== mirror.length) throw Error('Counts unavailable');
  const missing = context.report.stays.filter(s => s.guests === null);
  if (missing.length > 12) throw Error('Counts unavailable');
  return missing.map(stay => {
    const matches = context.bookings.filter(b => b.check_in === stay.checkIn && b.check_out === stay.checkOut);
    const b = matches[0];
    if (stay.needsReview || matches.length !== 1 || !b || b.property_id !== '65_calderwood'
      || b.duplicate_of !== null || !['confirmed', 'completed'].includes(b.status)) throw Error('Counts unavailable');
    const key = normalize(b.external_confirmation_code);
    const sources = mirror.filter(r => key && normalize(r.confirmation_code) === key);
    const source = sources[0];
    if (!key || !/^[A-Za-z0-9_-]+$/.test(b.external_confirmation_code!)
      || context.bookings.filter(r => normalize(r.external_confirmation_code) === key).length !== 1
      || sources.length !== 1 || source.confirmation_code !== b.external_confirmation_code
      || source.listing_id !== GUESTY_CALDERWOOD || source.status !== 'confirmed'
      || source.check_in !== stay.checkIn || source.check_out !== stay.checkOut) throw Error('Counts unavailable');
    return { id: objectId.parse(source.guesty_reservation_id), code: b.external_confirmation_code!,
      checkIn: stay.checkIn, checkOut: stay.checkOut };
  });
}

const sourceSchema = z.object({
  _id: objectId, accountId: z.literal(GUESTY_ACCOUNT), listingId: z.literal(GUESTY_CALDERWOOD),
  confirmationCode: z.string(), checkInDateLocalized: z.iso.date(), checkOutDateLocalized: z.iso.date(),
  status: z.literal('confirmed'), guestsCount: z.number().int().positive().max(100),
});
function verifiedCount(target: CountTarget, input: unknown): number {
  const source = sourceSchema.parse(input);
  if (source._id !== target.id || source.confirmationCode !== target.code
    || source.checkInDateLocalized !== target.checkIn || source.checkOutDateLocalized !== target.checkOut) {
    throw Error('Counts unavailable');
  }
  return source.guestsCount;
}
export function unavailableCleanerCounts(report: CleanerStayReport): CleanerStayReport {
  return { ...report, guestCountCheck: { status: 'unavailable', checkedAt: null } };
}

/** No persistence or sends. Two independent source reads must agree, then the
 * entire local report, authority and ID discovery set must still be unchanged. */
export async function enrichCleanerGuestCounts(before: CleanerCountContext, deps: {
  readReservation: (id: string) => Promise<unknown>;
  reloadContext: () => Promise<CleanerCountContext>;
  now?: () => Date;
}): Promise<CleanerStayReport> {
  if (!before.report.stays.some(s => s.guests === null)) return before.report;
  let targets: CountTarget[] = [], counts: number[] | null = null;
  try {
    targets = resolveCleanerCountTargets(before);
    const read = () => Promise.all(targets.map(async target => verifiedCount(target, await deps.readReservation(target.id))));
    counts = await read();
    if (JSON.stringify(counts) !== JSON.stringify(await read())) throw Error('Counts unavailable');
  } catch { counts = null; }
  // Do not show the earlier schedule if a cancellation, date change or authority
  // change landed during the reads. The page displays Schedule unavailable.
  const after = await deps.reloadContext();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('Cleaner schedule changed');
  if (!counts) return unavailableCleanerCounts(after.report);
  const byArrival = new Map(targets.map((t, i) => [t.checkIn, counts[i]]));
  return { ...before.report,
    guestCountCheck: { status: 'verified', checkedAt: (deps.now?.() ?? new Date()).toISOString() },
    stays: before.report.stays.map(stay => byArrival.has(stay.checkIn)
      ? { ...stay, guests: byArrival.get(stay.checkIn)!, guestCountSource: 'guesty' } : stay),
  };
}

/** Fixed origin, no redirects/retries/cache, bounded body and deadline. A fresh
 * signal on each call also prevents Next's request memoization joining passes. */
export async function readCleanerCountReservation(id: string, token: string, signal: AbortSignal,
  fetcher: typeof fetch = fetch): Promise<unknown> {
  objectId.parse(id);
  signal.throwIfAborted();
  const fields = '_id accountId listingId confirmationCode checkInDateLocalized checkOutDateLocalized status guestsCount';
  const response = await fetcher(`https://open-api.guesty.com/v1/reservations/${id}?${new URLSearchParams({ fields })}`, {
    method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    redirect: 'error', cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
  });
  if (response.status !== 200 || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw Error('Counts unavailable');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) throw Error('Counts unavailable');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
