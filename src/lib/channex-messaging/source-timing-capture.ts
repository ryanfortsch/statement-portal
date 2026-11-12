import 'server-only';
import { z } from 'zod';
import { readVerifiedMessagePreparation, type PreparationDeps } from './preparation.ts';
import { confirmationInstant, MESSAGE_TIMEZONE } from './preparation-timing.ts';

const localTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const row = z.object({
  bookingId: z.uuid(), guestyId: z.string().regex(/^[a-f0-9]{24}$/),
  code: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/), start: z.iso.date(), end: z.iso.date(),
  source: z.enum(['ical_import', 'guesty_legacy']), status: z.literal('confirmed'),
  clocks: z.object({ timezone: z.literal(MESSAGE_TIMEZONE), plannedArrival: localTime.nullable(),
    plannedDeparture: localTime.nullable(), defaultArrival: localTime, defaultDeparture: localTime,
    confirmedAt: z.iso.datetime({ precision: 3 }) }).strict(),
}).strict();
export type SourceTimingRow = z.infer<typeof row>;
export type SourceTimingCapture = { rows: SourceTimingRow[]; startedAt: string; checkedAt: string };
export class SourceTimingCaptureError extends Error {
  constructor() { super('SOURCE_TIMING_CAPTURE_UNAVAILABLE'); }
}

/** Explicit owner capture, not part of a GET/review. The callback stores only
 * verified timing/identity evidence. It must not schedule, enable or send.
 * A capture is a historical observation, not proof of current clocks after cutover. */
export async function captureSourceTiming(env: Record<string, string | undefined>, deps: PreparationDeps & {
  commit: (capture: SourceTimingCapture) => Promise<unknown>;
}) {
  try {
    const { before, first, started, observedAt } = await readVerifiedMessagePreparation(env, deps);
    if (!first.length) return { ok: true as const, saved: 0, captureId: null, jobsCreated: 0, messagesSent: 0 };
    const rows = first.map(r => {
      const stay = before.stays.find(s => s.canonicalId === r.canonicalId)!;
      const booking = before.canonical.rows.find(b => b.id === r.canonicalId)!;
      const { start, end, ...clocks } = r.clocks;
      const parsed = row.parse({ bookingId: booking.id, guestyId: stay.id, code: stay.code, start, end,
        source: booking.source, status: booking.status, clocks });
      if (start >= end || confirmationInstant(parsed.clocks.confirmedAt, started) !== parsed.clocks.confirmedAt) throw Error();
      return parsed;
    });
    const result = z.object({ captureId: z.uuid(), saved: z.literal(rows.length) }).strict().parse(await deps.commit({
      rows, startedAt: new Date(started).toISOString(), checkedAt: new Date(observedAt).toISOString(),
    }));
    return { ok: true as const, ...result, jobsCreated: 0, messagesSent: 0 };
  } catch { throw new SourceTimingCaptureError(); }
}
