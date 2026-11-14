import 'server-only';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { parseAirbnbBookingReceipt } from '../channex-bookings/ingestion.ts';
import { revisionTime } from '../channex-bookings/primitives.ts';
import { CALDERWOOD_PRODUCTION as mapping } from '../channex-production-preflight.ts';
import { CALDERWOOD_NEW_CONFIRMATION_POLICY as policy } from './confirmation-policy.ts';

export type NewAirbnbOrigin = 'verified_new' | 'retained_or_imported' | 'unverified';
export type NewConfirmationReview = {
  policy: typeof policy.id; anchor: typeof policy.anchor;
  state: 'future_candidate' | 'past_not_replayed' | 'origin_review' | 'receipt_review' | 'stay_inactive';
  firstReceivedAt: string | null; fireAt: string | null; canSchedule: false; canSend: false;
};
const staySchema = z.object({ id: z.uuid(), remoteBookingId: z.uuid(), code: z.string().min(1).max(160),
  start: z.iso.date(), end: z.iso.date(), status: z.string(), duplicateOf: z.uuid().nullable(),
}).strict().refine(s => s.start < s.end);
export type NewConfirmationStay = z.infer<typeof staySchema>;

/** Read-only policy calculation, NOT new-booking admission or evidence creation.
 * A trusted loader must provide the saved first and current receipts, current
 * canonical identity and an independently verified origin. Channex status=new,
 * inserted_at and an empty message history cannot establish that origin.
 *
 * Keep receipt provenance separate from Guesty's original confirmedAt. In
 * particular, this result cannot satisfy requireTimingEvidence or enter the
 * retained-stay writer/dispatcher. The production new-stay admission path still
 * needs persisted origin/source-ownership evidence before using this policy.
 */
export function reviewNewAirbnbConfirmation(input: {
  origin: NewAirbnbOrigin; stay: NewConfirmationStay;
  firstReceipt: unknown; currentReceipt: unknown; now: number;
}): NewConfirmationReview {
  const result = (state: NewConfirmationReview['state'], firstReceivedAt: string | null = null,
    fireAt: string | null = null): NewConfirmationReview => ({
    policy: policy.id, anchor: policy.anchor, state, firstReceivedAt, fireAt, canSchedule: false, canSend: false,
  });
  if (input.origin !== 'verified_new') return result('origin_review');
  try {
    const stay = staySchema.parse(input.stay);
    if (stay.status !== 'confirmed' || stay.duplicateOf !== null) return result('stay_inactive');
    if (!Number.isSafeInteger(input.now)) throw Error();
    const observed = revisionTime(new Date(input.now).toISOString());
    const first = parseAirbnbBookingReceipt(input.firstReceipt), current = parseAirbnbBookingReceipt(input.currentReceipt);
    for (const r of [first, current]) {
      const v = r.revision;
      if (r.outcome !== 'applied' || r.canonicalBookingId !== stay.id || v.bookingId !== stay.remoteBookingId
        || v.reservationCode !== stay.code || v.environment !== 'production' || v.channel !== 'airbnb'
        || v.propertyId !== mapping.propertyId || v.roomTypeId !== mapping.roomTypeId
        || v.ratePlanId !== mapping.ratePlanId || v.mappingGeneration !== 1 || r.committedAt > observed) throw Error();
    }
    if (first.revision.status !== 'new' || current.revision.status === 'cancelled'
      || current.firstReceivedAt !== first.firstReceivedAt || current.committedAt < first.committedAt
      || current.revision.providerReceivedAt < first.revision.providerReceivedAt
      || current.revision.checkIn !== stay.start || current.revision.checkOut !== stay.end
      || (first.revision.revisionId === current.revision.revisionId && !isDeepStrictEqual(first, current))
      || (first.revision.revisionId !== current.revision.revisionId
        && current.revision.providerReceivedAt === first.revision.providerReceivedAt)) throw Error();
    // SQL retains microseconds. Round UP to the next representable millisecond,
    // never a fraction earlier than first receipt + 30 elapsed minutes. Do not
    // use now, committedAt, provider inserted_at or a later modification time.
    const fractionalMicros = Number(first.firstReceivedAt.slice(-4, -1));
    const fire = Date.parse(first.firstReceivedAt) + (fractionalMicros ? 1 : 0) + policy.minutes * 60_000;
    const fireAt = new Date(fire).toISOString();
    return result(fire > input.now ? 'future_candidate' : 'past_not_replayed', first.firstReceivedAt, fireAt);
  } catch { return result('receipt_review'); }
}
