/** Owner-side, explicitly reviewed timing import. No environment credential,
 * browser entry point, provider calls, source-history claims or sender activation.
 */
import { z } from 'zod';
import type { MessageRpc } from './worker.ts';
import { CALDERWOOD } from '../calderwood-readonly/guesty-reader.ts';
import { timingCaptureFingerprint } from '../calderwood-readonly/timing-capture.ts';
import { confirmedInstant } from '../calderwood-readonly/confirmation-reader.ts';
const uuid = z.string().uuid(), id = z.string().regex(/^[a-f0-9]{24}$/i);
const instant = z.string().refine(s => confirmedInstant(s, new Date('9999-12-31T23:59:59Z')) !== null);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const at = Date.parse(s + 'T00:00:00Z');
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === s;
});
const candidate = z.object({ reservationId: id, listingId: z.literal(CALDERWOOD.guestyListingId),
  checkIn: day, checkOut: day, arrivalAt: instant, departureAt: instant, confirmedAt: instant,
  arrivalBasis: z.enum(['plannedArrival', 'listing.defaultCheckInTime']),
  departureBasis: z.enum(['plannedDeparture', 'listing.defaultCheckOutTime']),
}).strict();
const packetSchema = z.object({
  capture: z.object({ mode: z.literal('review-only-timing-capture'), canSend: z.literal(false), automaticImport: z.literal(false),
    startedAt: instant, finishedAt: instant, fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    candidates: z.array(candidate).max(12), incompleteReservationIds: z.array(id).max(12),
  }).strict(),
  binding: z.object({ bookingId: uuid, sourceReservationId: id, canonicalRevision: z.string().regex(/^[a-f0-9]{32}$/),
    expectedObservationRevision: uuid.nullable(),
  }).strict(),
  review: z.object({ id: uuid, reviewedAt: instant, source: z.literal('guesty-local-clock-review'),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
}).strict();
export type ReviewedTimingPacket = z.infer<typeof packetSchema>;
const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function clock(at: string, date: string) {
  const parts = Object.fromEntries(local.formatToParts(new Date(at)).map(p => [p.type, p.value]));
  if (`${parts.year}-${parts.month}-${parts.day}` !== date || parts.second !== '00' || Date.parse(at) % 60000 !== 0) throw Error('Reviewed local clock mismatch');
  // Ambiguous fall-back wall clocks cannot be represented by the time-only DB column.
  const sameWallClock = (delta: number) => local.format(new Date(Date.parse(at) + delta)) === local.format(new Date(at));
  if (sameWallClock(-3600000) || sameWallClock(3600000)) throw Error('Reviewed local clock is ambiguous');
  return `${parts.hour}:${parts.minute}`;
}
/** Hashes are integrity checks, not authority. Only a trusted owner review may
 * supply the exact canonical/source binding and this packet. The underlying RPC
 * independently enforces dates, canonical status, freshness and compare/swap.
 * The snapshot's fingerprint is labeled as a capture, not a provider revision.
 */
export async function ingestReviewedMessageTiming(rpc: MessageRpc, input: unknown, now: Date = new Date()) {
  if (typeof window !== 'undefined') throw Error('Timing import requires a server');
  const parsed = packetSchema.safeParse(input);
  if (!parsed.success || !Number.isFinite(now.getTime())) throw Error('Complete reviewed timing packet required');
  const { capture, binding, review } = parsed.data;
  const start = Date.parse(capture.startedAt), end = Date.parse(capture.finishedAt), reviewed = Date.parse(review.reviewedAt);
  const ids = [...capture.candidates.map(c => c.reservationId), ...capture.incompleteReservationIds];
  if (ids.length > 12 || new Set(ids).size !== ids.length || start > end || end - start > 120000 ||
      start < now.getTime() - 300000 || end > reviewed || reviewed > now.getTime() ||
      capture.fingerprint !== review.fingerprint || capture.fingerprint !== timingCaptureFingerprint(capture.candidates, capture.incompleteReservationIds)) throw Error('Timing review is stale or mismatched');
  const value = capture.candidates.find(c => c.reservationId === binding.sourceReservationId);
  if (!value || value.checkIn >= value.checkOut || Date.parse(value.confirmedAt) > end) throw Error('Exact complete timing candidate required');
  const observation = { check_in: value.checkIn, check_out: value.checkOut,
    arrival_time: clock(value.arrivalAt, value.checkIn), departure_time: clock(value.departureAt, value.checkOut),
    confirmed_at: value.confirmedAt, observed_at: capture.finishedAt,
    source_revision: `capture:${capture.fingerprint}`, evidence_id: `review:${review.id}`,
  };
  try {
    const response = await rpc('automation_message_observe_times', {
      p_booking_id: binding.bookingId, p_canonical_revision: binding.canonicalRevision,
      p_expected_revision: binding.expectedObservationRevision, p_observation: observation,
    });
    if (response.error || !uuid.safeParse(response.data).success) throw Error();
    return { state: 'observed' as const, observationRevision: response.data as string, canSend: false as const };
  } catch { throw Error('Timing import unconfirmed; reconcile this review before continuing'); }
}
