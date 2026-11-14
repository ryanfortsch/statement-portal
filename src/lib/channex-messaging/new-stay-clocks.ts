import 'server-only';
import { z } from 'zod';
import { CALDERWOOD_NEW_STAY_POLICY as policy } from './new-stay-policy.ts';
import type { SourceClocks } from './preparation-timing.ts';

const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const newStayClockRecordSchema = z.object({
  policy: z.literal(policy.id), bookingId: z.uuid(), start: z.iso.date(), end: z.iso.date(),
  // Explicit null means the trusted store found no recorded exception. Omitted
  // data, a failed query, and Channex arrival_hour must never mean "default".
  exception: z.object({ id: z.uuid(), start: z.iso.date(), end: z.iso.date(),
    arrival: time.nullable(), departure: time.nullable() }).strict().nullable(),
  checkoutAdjustment: z.object({ id: z.uuid(), start: z.iso.date(), originalEnd: z.iso.date(),
    end: z.iso.date().nullable(), departure: time.nullable() }).strict().nullable(),
}).strict();

/** Fresh Helm-owned timing, separate from original Guesty confirmation evidence.
 * A dated exception does not silently move to the next incarnation of a stay. */
export function newStayClocks(raw: unknown, booking: { id: string; start: string; end: string }): SourceClocks {
  const s = newStayClockRecordSchema.parse(raw);
  if (s.bookingId !== booking.id || s.start !== booking.start || s.end !== booking.end || s.start >= s.end
    || (s.exception && (s.exception.start !== s.start || s.exception.end !== s.end)))
    throw Error('New-stay timing requires review');
  const adjustment = s.checkoutAdjustment;
  if (adjustment && (adjustment.start !== s.start
    || (adjustment.originalEnd !== s.end && adjustment.end !== s.end)
    || (adjustment.end !== null && adjustment.end !== s.end)
    || (s.exception?.departure && adjustment.departure && s.exception.departure !== adjustment.departure)))
    throw Error('Checkout adjustment requires reconciliation');
  return { start: s.start, end: s.end, timezone: policy.timezone,
    plannedArrival: s.exception?.arrival ?? null, plannedDeparture: s.exception?.departure ?? adjustment?.departure ?? null,
    defaultArrival: policy.arrival, defaultDeparture: policy.departure, confirmedAt: null };
}
