import 'server-only';
import { z } from 'zod';
import { parseAirbnbBookingReceipt } from '../channex-bookings/ingestion.ts';
import { reviewNewAirbnbConfirmation } from './new-booking-confirmation.ts';
import { newStayClocks, newStayClockRecordSchema } from './new-stay-clocks.ts';
import type { MessageRpc } from './store.ts';

const id = z.uuid();
const snapshot = z.object({ format: z.literal(1), observedAt: z.iso.datetime({ offset: true }),
  epochId: id, bookingId: id, remoteBookingId: id, routeGeneration: id, sourceEvidenceId: id,
  firstReceipt: z.unknown(), currentReceipt: z.unknown(), clocks: newStayClockRecordSchema,
}).strict();
const admissionResult = z.discriminatedUnion('state', [
  z.object({ state: z.literal('disabled'), admitted: z.literal(0), canSend: z.literal(false) }).strict(),
  z.object({ state: z.literal('complete'), admitted: z.number().int().min(0).max(5), canSend: z.literal(false) }).strict(),
]);
export const newStayClockChangeSchema = z.object({ id, bookingId: id, replaces: id.nullable(),
  start: z.iso.date(), end: z.iso.date(), arrival: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable(),
  departure: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable(),
}).strict().refine(x => x.start < x.end && x.id !== x.replaces);

/** Private persistence only. It cannot open a handover epoch, create a message
 * scope, change sender authority, schedule or dispatch. load() contains private
 * receipt data and must never be returned from an HTTP endpoint. */
export function createNewStayStore(rpc: MessageRpc, options: { enabled?: boolean } = {}) {
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await rpc(name, args);
    if (!r || r.error !== null) throw Error('New-stay storage unavailable');
    return r.data;
  };
  return {
    async admit() {
      if (options.enabled !== true) return { state: 'disabled' as const, admitted: 0, canSend: false as const };
      try { return admissionResult.parse(await call('helm_channex_new_stays_admit', {})); }
      catch { return { state: 'uncertain' as const, admitted: null, canSend: false as const }; }
    },
    async load(bookingId: string, now: () => number = Date.now) {
      if (options.enabled !== true) return null;
      try {
        id.parse(bookingId); const started = now();
        const raw = await call('helm_channex_new_stay_read', { p_booking: bookingId });
        const at = now();
        if (!Number.isSafeInteger(started) || !Number.isSafeInteger(at) || at < started || at - started > 30000) throw Error();
        if (raw === null) return null;
        const s = snapshot.parse(raw), observed = Date.parse(s.observedAt);
        if (s.bookingId !== bookingId || observed > at || at - observed > 30000) throw Error();
        const first = parseAirbnbBookingReceipt(s.firstReceipt), current = parseAirbnbBookingReceipt(s.currentReceipt);
        const stay = { id: bookingId, remoteBookingId: s.remoteBookingId, code: current.revision.reservationCode,
          start: s.clocks.start, end: s.clocks.end, status: 'confirmed', duplicateOf: null };
        const confirmation = reviewNewAirbnbConfirmation({ origin: 'verified_new', stay, firstReceipt: first,
          currentReceipt: current, now: at });
        if (!['future_candidate', 'past_not_replayed'].includes(confirmation.state)) throw Error();
        return { ...s, firstReceipt: first, currentReceipt: current, clocks: newStayClocks(s.clocks, stay), confirmation };
      } catch { throw Error('New-stay inputs unavailable'); }
    },
    async saveClocks(raw: unknown, actor: string) {
      if (options.enabled !== true) return { state: 'disabled' as const };
      const change = newStayClockChangeSchema.safeParse(raw);
      if (!change.success || typeof actor !== 'string' || !actor.trim() || actor.trim().length > 200)
        return { state: 'invalid' as const };
      try {
        const r = z.object({ state: z.enum(['created', 'existing']), id }).strict().parse(
          await call('helm_channex_new_stay_clock_save', { p_change: change.data, p_actor: actor.trim() }));
        if (r.id !== change.data.id) throw Error();
        return r;
      } catch { return { state: 'uncertain' as const }; }
    },
  };
}
