import 'server-only';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { confirmationInstant, MESSAGE_TIMEZONE, type SourceClocks } from './preparation-timing.ts';
import { scheduleContextSchema } from './schedule-store.ts';

const localTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const sourceTimingIdentitySchema = z.object({
  guestyId: z.string().regex(/^[a-f0-9]{24}$/), code: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/),
  source: z.enum(['ical_import', 'guesty_legacy']),
}).strict();
export const sourceTimingRowSchema = sourceTimingIdentitySchema.extend({
  bookingId: z.uuid(), start: z.iso.date(), end: z.iso.date(), status: z.literal('confirmed'),
  clocks: z.object({ timezone: z.literal(MESSAGE_TIMEZONE), plannedArrival: localTime.nullable(),
    plannedDeparture: localTime.nullable(), defaultArrival: localTime, defaultDeparture: localTime,
    confirmedAt: z.iso.datetime({ precision: 3 }) }).strict(),
}).strict();
const evidenceSchema = z.object({
  kind: z.literal('reviewed_guesty_capture'),
  captureId: z.uuid(), sourceContract: z.literal('guesty_v2_clocks_v3_confirmed_at_double_read'),
  checkedAt: z.iso.datetime({ precision: 3 }), row: sourceTimingRowSchema,
  binding: scheduleContextSchema.extend({ reviewedAt: z.iso.datetime({ precision: 3 }),
    remoteBookingId: z.uuid(), threadId: z.uuid() }).strict(),
}).strict();
export type SourceTimingEvidence = z.infer<typeof evidenceSchema>;
export class TimingEvidenceError extends Error {
  constructor() { super('Timing evidence requires review'); }
}

/** Validates evidence supplied by a TRUSTED loader, not browser assertions or a
 * provider payload. The loader must read a retained capture and a separately
 * reviewed, persistent handover binding; it must never stamp the current context
 * onto an old capture during a read. This function cannot prove storage origin.
 *
 * No supported Channex source currently supplies original confirmation time or
 * reservation-specific arrival/departure overrides. inserted_at, raw_message,
 * first-seen time and property arrival_hour are deliberately not alternatives.
 * timing-binding-store.ts reads retained database bindings. Its trusted provider
 * review caller and the full runtime loader are not wired. Capturing alone is insufficient.
 */
export function requireTimingEvidence(raw: unknown, expected: {
  bookingId: string; sourceIdentity: unknown; clocks: SourceClocks; observedAt: string;
  route: { remoteBookingId: string; threadId: string }; context: unknown;
}, now: number): SourceTimingEvidence {
  try {
    const evidence = evidenceSchema.parse(raw), context = scheduleContextSchema.parse(expected.context);
    const sourceIdentity = sourceTimingIdentitySchema.parse(expected.sourceIdentity);
    const { bookingId, start, end, status: _status, clocks, ...identity } = evidence.row;
    void _status;
    const { reviewedAt, remoteBookingId, threadId, ...boundContext } = evidence.binding;
    const checked = Date.parse(evidence.checkedAt), reviewed = Date.parse(reviewedAt), observed = Date.parse(expected.observedAt);
    if (!Number.isFinite(now) || !Number.isFinite(observed) || checked > reviewed || reviewed > observed || observed > now
      || Date.parse(context.sourceEvidenceAt) > reviewed
      || confirmationInstant(clocks.confirmedAt, checked) !== clocks.confirmedAt
      || start >= end || bookingId !== expected.bookingId
      || !isDeepStrictEqual(identity, sourceIdentity)
      || !isDeepStrictEqual({ start, end, ...clocks }, expected.clocks)
      || !isDeepStrictEqual(boundContext, context)
      || !isDeepStrictEqual({ remoteBookingId, threadId }, expected.route)) throw Error();
    return evidence;
  } catch { throw new TimingEvidenceError(); }
}
