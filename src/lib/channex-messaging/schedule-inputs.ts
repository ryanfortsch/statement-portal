import 'server-only';
import { z } from 'zod';
import { firstNameOf, guestNameIdentity } from '../automations-core.ts';
import { formatGuestyMessageDate } from './preparation-render.ts';
import { parsePreparationRules } from './preparation-rules.ts';
import { parseScheduleLedger } from './schedule-plan.ts';
import { scheduleContextSchema } from './schedule-store.ts';
import { requireTimingEvidence, sourceTimingRowSchema } from './timing-evidence.ts';
import type { MessageRpc } from './store.ts';

const id = z.uuid(), text = z.string().max(16000).nullable();
const schema = z.object({
  format: z.literal(1), observedAt: z.iso.datetime({ offset: true }), context: scheduleContextSchema,
  binding: z.object({ bindingId: id, evidence: z.unknown() }).strict(),
  booking: z.object({ id, propertyId: z.literal('65_calderwood'), status: z.literal('confirmed'),
    duplicateOf: z.null(), start: z.iso.date(), end: z.iso.date(), guestName: text }).strict(),
  property: z.object({ id: z.literal('65_calderwood'), name: text, wifiName: text }).strict(),
  access: z.object({ smartLockCode: text, wifiPassword: text }).strict().nullable(),
  lockMapped: z.boolean(), currentRules: z.unknown(), ledger: z.unknown(),
}).strict();
const trim = (s: string | null | undefined) => s?.trim() || null;

/** Default-off private database loader, not an HTTP DTO. Secrets and source
 * identities stay in server memory. One stable SQL statement reads all inputs,
 * including every canonical history row (no silent pagination/truncation).
 *
 * This intentionally does not invent capturedRules from the active rules: the
 * retained-template reader must provide archived templates separately. A saved
 * binding proves a past review, not fresh provider clocks. schedule-runtime.ts
 * adds fresh provider checks; release, dispatch and activation remain gated.
 */
export function createCalderwoodScheduleInputReader(rpc: MessageRpc, options: { enabled?: boolean } = {}) {
  return {
    async load(bookingId: string, bindingId: string, clock: () => number = Date.now) {
      if (options.enabled !== true) return null;
      try {
        id.parse(bookingId); id.parse(bindingId);
        const started = clock();
        if (!Number.isSafeInteger(started)) throw Error();
        const result = await rpc('helm_channex_message_schedule_inputs', { p_booking_id: bookingId, p_binding_id: bindingId });
        const now = clock();
        if (!Number.isSafeInteger(now) || now < started || now - started > 30_000 || !result || result.error !== null) throw Error();
        if (result.data === null) return null;
        const s = schema.parse(result.data), observed = Date.parse(s.observedAt);
        if (observed > now || now - observed > 30_000 || s.booking.id !== bookingId
          || s.binding.bindingId !== bindingId || s.booking.start >= s.booking.end) throw Error();
        // First project the retained row/route, then validate the entire evidence
        // against the independently read current context and canonical booking.
        const retained = z.object({ row: sourceTimingRowSchema,
          binding: z.object({ remoteBookingId: id, threadId: id }) }).parse(s.binding.evidence);
        const { clocks: sourceClocks, start, end, bookingId: sourceBooking, status: _status, ...sourceIdentity } = retained.row;
        void _status;
        if (sourceBooking !== bookingId || start !== s.booking.start || end !== s.booking.end) throw Error();
        const clocks = { start, end, ...sourceClocks }, route = retained.binding;
        const timingEvidence = requireTimingEvidence(s.binding.evidence, { bookingId, sourceIdentity,
          clocks, route, context: s.context, observedAt: s.observedAt }, now);
        const currentRules = parsePreparationRules(s.currentRules), ledger = parseScheduleLedger(s.ledger);
        if (ledger.some(r => r.booking_id !== bookingId)) throw Error();
        const { guestName, ...booking } = s.booking;
        // Only the seven fields used by the captured Calderwood guest templates.
        // A mapped lock needs independently verified per-stay code support; a
        // static fallback or a key-location description must not fill that gap.
        const merge = {
          guest_first: guestNameIdentity(guestName) ? firstNameOf(guestName) : null,
          property_name: trim(s.property.name),
          check_in_long: formatGuestyMessageDate(start), check_out_long: formatGuestyMessageDate(end),
          door_code: s.lockMapped ? null : trim(s.access?.smartLockCode),
          wifi_name: trim(s.property.wifiName), wifi_password: trim(s.access?.wifiPassword),
        };
        return { context: s.context, snapshot: { observedAt: s.observedAt, booking, clocks, route,
          sourceIdentity, timingEvidence, currentRules, ledger, merge } };
      } catch { throw Error('Message scheduling inputs unavailable'); }
    },
  };
}
