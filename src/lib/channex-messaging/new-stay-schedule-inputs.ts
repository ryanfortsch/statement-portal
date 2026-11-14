import 'server-only';
import { z } from 'zod';
import { firstNameOf, guestNameIdentity } from '../automations-core.ts';
import { CALDERWOOD_PRODUCTION as mapping } from '../channex-production-preflight.ts';
import { parseNewStaySnapshot } from './new-stay-store.ts';
import { formatGuestyMessageDate } from './preparation-render.ts';
import { parsePreparationRules } from './preparation-rules.ts';
import { parseScheduleLedger, planNewAirbnbSchedule } from './schedule-plan.ts';
import { scheduleContextSchema } from './schedule-store.ts';
import type { MessageRpc } from './store.ts';

const id = z.uuid(), text = z.string().max(16000).nullable();
const schema = z.object({
  format: z.literal(1), observedAt: z.iso.datetime({ offset: true }), context: scheduleContextSchema,
  admission: z.unknown(), scope: z.object({ environment: z.literal('production'),
    propertyId: z.literal(mapping.propertyId), channelId: id, provider: z.literal('Airbnb') }).strict(),
  booking: z.object({ id, propertyId: z.literal('65_calderwood'), status: z.literal('confirmed'),
    duplicateOf: z.null(), start: z.iso.date(), end: z.iso.date(), guestName: text }).strict(),
  property: z.object({ id: z.literal('65_calderwood'), name: text, wifiName: text }).strict(),
  access: z.object({ smartLockCode: text, wifiPassword: text }).strict().nullable(),
  lockMapped: z.boolean(), currentRules: z.unknown(), ledger: z.unknown(),
}).strict();
const trim = (s: string | null | undefined) => s?.trim() || null;

/** One consistent private SQL snapshot, including immutable admission and ALL
 * workflow history. Not a browser DTO: merge inputs contain access credentials. */
export function createNewStayScheduleInputReader(rpc: MessageRpc, options: { enabled?: boolean } = {}) {
  return { async load(bookingId: string, clock: () => number = Date.now) {
    if (options.enabled !== true) return null;
    try {
      id.parse(bookingId); const started = clock();
      const r = await rpc('helm_channex_new_stay_schedule_inputs', { p_booking_id: bookingId });
      const at = clock();
      if (!Number.isSafeInteger(started) || !Number.isSafeInteger(at) || at < started || at - started > 30000
        || !r || r.error !== null) throw Error();
      if (r.data === null) return null;
      const s = schema.parse(r.data), observed = Date.parse(s.observedAt);
      const admission = parseNewStaySnapshot(s.admission, bookingId, at);
      if (observed > at || at - observed > 30000 || s.booking.id !== bookingId
        || admission.clocks.start !== s.booking.start || admission.clocks.end !== s.booking.end
        || admission.routeGeneration !== s.context.routeGeneration || admission.sourceEvidenceId !== s.context.sourceEvidenceId
        || Date.parse(s.context.sourceEvidenceAt) > at) throw Error();
      const currentRules = parsePreparationRules(s.currentRules), ledger = parseScheduleLedger(s.ledger);
      if (ledger.some(h => h.booking_id !== bookingId)) throw Error();
      const { guestName, ...booking } = s.booking;
      // Intake preserves the operational name in the immutable pre-ACK receipt;
      // canonical bookings may not yet project it. Never invent a greeting from
      // an email or a masked provider read, or ignore a conflicting stored name.
      const details = admission.currentReceipt.revision.guestDetails;
      const receiptName = [trim(details.name), trim(details.surname)].filter(Boolean).join(' ');
      if (guestNameIdentity(guestName) && guestNameIdentity(receiptName)
        && guestNameIdentity(guestName) !== guestNameIdentity(receiptName)) throw Error();
      const name = guestNameIdentity(guestName) ? guestName : receiptName;
      return { observedAt: s.observedAt, context: s.context, scope: s.scope, admission, booking,
        currentRules, ledger, merge: {
          guest_first: guestNameIdentity(name) ? firstNameOf(name) : null,
          property_name: trim(s.property.name), check_in_long: formatGuestyMessageDate(booking.start),
          check_out_long: formatGuestyMessageDate(booking.end), door_code: s.lockMapped ? null : trim(s.access?.smartLockCode),
          wifi_name: trim(s.property.wifiName), wifi_password: trim(s.access?.wifiPassword),
        } };
    } catch { throw Error('New-stay schedule inputs unavailable'); }
  } };
}
export type NewStayScheduleInputs = NonNullable<Awaited<ReturnType<ReturnType<typeof createNewStayScheduleInputReader>['load']>>>;
export function planAdmittedStay(s: NewStayScheduleInputs, rules: Parameters<typeof planNewAirbnbSchedule>[0]['rules'], now: number) {
  return planNewAirbnbSchedule({ stay: { canonicalId: s.booking.id, status: s.booking.status,
    duplicateOf: s.booking.duplicateOf, clocks: s.admission.clocks }, rules, ledger: s.ledger, now,
    confirmation: { origin: 'verified_new', remoteBookingId: s.admission.remoteBookingId,
      code: s.admission.currentReceipt.revision.reservationCode,
      firstReceipt: s.admission.firstReceipt, currentReceipt: s.admission.currentReceipt } }).workflows;
}
