/** GET-only review capture. Matching reads detect changes; they are not a provider
 * revision, an atomic snapshot, queue history or permission to send. Legacy local
 * fields remain a temporary review dependency, never an automatic live source.
 */
import { createHash } from 'node:crypto';
import { CALDERWOOD, readCalderwoodGuesty } from './guesty-reader.ts';
import { readCalderwoodLocalClocks } from './local-clock-reader.ts';
import { readCalderwoodConfirmations } from './confirmation-reader.ts';
import { confirmedInstant } from './confirmation-reader.ts';
type Snapshot = Awaited<ReturnType<typeof readCalderwoodGuesty>>;
type Reservation = Snapshot['reservations'][number];
export type TimingCandidate = {
  reservationId: string; listingId: string; checkIn: string; checkOut: string;
  arrivalAt: string; departureAt: string; confirmedAt: string;
  arrivalBasis: string; departureBasis: string;
};
export type TimingCapture = {
  mode: 'review-only-timing-capture'; canSend: false; automaticImport: false;
  startedAt: string; finishedAt: string; fingerprint: string;
  candidates: TimingCandidate[]; incompleteReservationIds: string[];
};
export function timingCaptureFingerprint(candidates: TimingCandidate[], incompleteReservationIds: string[]) {
  return createHash('sha256').update(JSON.stringify({ candidates, incompleteReservationIds })).digest('hex');
}
function identity(rows: Reservation[]) {
  return rows.map(r => ({ id: r.id, listingId: r.listingId, start: r.start, end: r.end, status: r.status, source: r.source }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
function timings(rows: Reservation[]) {
  return rows.filter(r => r.status === 'confirmed').map(r => ({
    ...identity([r])[0], arrivalAt: r.timing.arrivalAt, departureAt: r.timing.departureAt,
    clockVerified: r.timing.clockVerified, confirmation: r.timing.confirmation ?? null,
    arrivalBasis: r.timing.localEvidence?.arrivalBasis ?? null,
    departureBasis: r.timing.localEvidence?.departureBasis ?? null,
  })).sort((a, b) => a.id.localeCompare(b.id));
}
/** The opening reservation list is captured by the caller. Re-read it after both
 * clock/confirmation passes; cancellation, additions, disappearance or date changes
 * invalidate this whole capture. This still cannot detect change-and-revert or
 * changes after the final read; review and canonical compare/swap remain required.
 */
export async function captureCalderwoodTiming(token: string, initial: Snapshot, dependencies: {
  read?: typeof readCalderwoodGuesty; localClocks?: typeof readCalderwoodLocalClocks;
  confirmations?: typeof readCalderwoodConfirmations; clock?: () => Date;
} = {}): Promise<{ reservations: Reservation[]; capture: TimingCapture }> {
  if (typeof window !== 'undefined' || !token.trim() || /[\r\n]/.test(token)) throw Error('Server timing capture required');
  const clock = dependencies.clock ?? (() => new Date()), start = clock().getTime();
  let previous = start;
  const stamp = () => {
    const now = clock().getTime();
    if (!Number.isFinite(start) || !Number.isFinite(now) || now < previous || now - start > 120000) throw Error();
    previous = now; return new Date(now);
  };
  try {
    stamp();
    const rows = initial.reservations;
    if (initial.paginationComplete !== true || rows.filter(r => r.status === 'confirmed').length > 12 ||
        new Set(rows.map(r => r.id)).size !== rows.length || rows.some(r =>
          r.listingId !== CALDERWOOD.guestyListingId || !/^[a-f0-9]{24}$/i.test(r.id))) throw Error();
    const clocks = dependencies.localClocks ?? readCalderwoodLocalClocks;
    const confirmations = dependencies.confirmations ?? readCalderwoodConfirmations;
    const firstClocks = await clocks(token, rows); stamp();
    const first = await confirmations(token, firstClocks, stamp()); stamp();
    // Reverse endpoint order so a change during either enrichment is observable.
    const secondConfirmations = await confirmations(token, rows, stamp()); stamp();
    const second = await clocks(token, secondConfirmations); stamp();
    const closing = await (dependencies.read ?? readCalderwoodGuesty)(token, initial.window); stamp();
    if (closing.paginationComplete !== true || JSON.stringify(closing.window) !== JSON.stringify(initial.window) ||
        [firstClocks, first, secondConfirmations, second, closing.reservations].some(result =>
          JSON.stringify(identity(result)) !== JSON.stringify(identity(rows))) ||
        JSON.stringify(timings(first)) !== JSON.stringify(timings(second))) throw Error();
    const candidates: TimingCandidate[] = [], incompleteReservationIds: string[] = [];
    for (const r of second.filter(r => r.status === 'confirmed').sort((a, b) => a.id.localeCompare(b.id))) {
      const t = r.timing, evidence = t.localEvidence;
      const confirmedAt = t.confirmation?.source === 'guesty-v3-confirmedAt' ? confirmedInstant(t.confirmation.at, stamp()) : null;
      if (!t.clockVerified || !t.arrivalAt || !t.departureAt || !confirmedAt ||
          evidence?.source !== 'guesty-legacy-local-fields' || !evidence.arrivalBasis || !evidence.departureBasis) {
        incompleteReservationIds.push(r.id); continue;
      }
      candidates.push({ reservationId: r.id, listingId: r.listingId, checkIn: r.start, checkOut: r.end,
        arrivalAt: t.arrivalAt, departureAt: t.departureAt, confirmedAt,
        arrivalBasis: evidence.arrivalBasis, departureBasis: evidence.departureBasis });
    }
    const finishedAt = stamp().toISOString();
    return { reservations: second, capture: { mode: 'review-only-timing-capture', canSend: false, automaticImport: false,
      startedAt: new Date(start).toISOString(), finishedAt, fingerprint: timingCaptureFingerprint(candidates, incompleteReservationIds),
      candidates, incompleteReservationIds } };
  } catch { throw Error('Booking times changed, were incomplete or could not be cross-checked; reload before reviewing'); }
}
