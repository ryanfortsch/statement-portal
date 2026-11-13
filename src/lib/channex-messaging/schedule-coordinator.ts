import 'server-only';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { MERGE_FIELDS, overrideBodyProblem, renderTemplate } from '../automations-core.ts';
import { formatGuestyMessageDate } from './preparation-render.ts';
import { parsePreparationRules, preparedRulePolicy } from './preparation-rules.ts';
import { parseScheduleLedger, planCalderwoodSchedule, type ScheduleState } from './schedule-plan.ts';
import { scheduleContextSchema, type createChannexScheduleStore } from './schedule-store.ts';
import { requireTimingEvidence, TimingEvidenceError } from './timing-evidence.ts';

export const guestKeys = ['booking_confirmed', 'pre_arrival', 'checkin_day', 'pre_checkout'] as const;
type GuestKey = typeof guestKeys[number];
const text = z.string().max(16000).nullable();
const snapshotSchema = z.object({
  observedAt: z.iso.datetime({ offset: true }),
  booking: z.object({ id: z.uuid(), propertyId: z.literal('65_calderwood'), status: z.string().max(80),
    duplicateOf: z.uuid().nullable(), start: z.iso.date(), end: z.iso.date() }).strict(),
  clocks: z.object({ start: z.iso.date(), end: z.iso.date(), timezone: text,
    plannedArrival: text, plannedDeparture: text, defaultArrival: text, defaultDeparture: text,
    confirmedAt: text }).strict(),
  route: z.object({ remoteBookingId: z.uuid(), threadId: z.uuid() }).strict(),
  sourceIdentity: z.unknown(), timingEvidence: z.unknown(),
  capturedRules: z.unknown(), currentRules: z.unknown(), ledger: z.unknown(),
  merge: z.partialRecord(z.enum(MERGE_FIELDS), text),
}).strict();
type Store = Pick<ReturnType<typeof createChannexScheduleStore>, 'context' | 'register'>;
type Outcome = { key: GuestKey; state: Exclude<ScheduleState, 'future_candidate'>
  | 'release_required' | 'render_review' | 'out_of_window' | 'created' | 'existing' | 'uncertain'; sendId?: string };
export type ScheduleCycleResult = {
  state: 'disabled' | 'invalid' | 'complete' | 'unavailable' | 'changed' | 'uncertain' | 'timing_review';
  outcomes: Outcome[]; canSend: false;
};
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
// A namespaced UUIDv8 derived only from the canonical stay + workflow. Never
// rotate it for a timeout, rule replacement, booking edit, or new route generation.
export function retainedGuestSendId(bookingId: string, key: GuestKey) {
  z.uuid().parse(bookingId); z.enum(guestKeys).parse(key);
  const h = hash(`helm:channex:guest-schedule:v1:65_calderwood:${bookingId}:${key}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
function parseSnapshot(raw: unknown, bookingId: string, now: number) {
  const s = snapshotSchema.parse(raw);
  const age = now - Date.parse(s.observedAt);
  if (age < 0 || age > 30_000 || s.booking.id !== bookingId || s.booking.start >= s.booking.end
    || s.clocks.start !== s.booking.start || s.clocks.end !== s.booking.end) throw Error('Unavailable');
  const ledger = parseScheduleLedger(s.ledger);
  if (ledger.some(r => r.booking_id !== bookingId)) throw Error('Unavailable');
  return { ...s, ledger, capturedRules: parsePreparationRules(s.capturedRules), currentRules: parsePreparationRules(s.currentRules) };
}
type Snapshot = ReturnType<typeof parseSnapshot>;
function unchangedInputs(s: Snapshot) {
  // Ledger changes are reconciled by the planner, including our own successful
  // registrations. Never ignore concurrent holds, cancellations or sent history.
  const { observedAt: _observedAt, ledger: _ledger, ...input } = s;
  void _observedAt; void _ledger;
  return hash(JSON.stringify(input));
}

/** Bounded orchestration for ONE canonical stay, at most four registrations.
 * Default off. It has no environment loader, route, cron, release or sender.
 *
 * The trusted loader must provide COMPLETE stay history and current context-bound
 * merge inputs, clocks and booking/thread mapping. Timing must match retained
 * Guesty evidence and a reviewed binding to this exact context and route; a
 * capture alone cannot schedule. capturedRules must come from
 * retained release evidence, not a fabricated copy of active rules. Double reads
 * detect changes; they do NOT establish the clocks' provenance or release approval.
 * schedule-runtime.ts supplies retained templates and fresh provider/database
 * reads. The reviewed template-release flow and production caller remain gated.
 * Present frozen templates fail both this comparison and the existing SQL guards.
 */
export async function registerCalderwoodStaySchedules(bookingId: string, deps: {
  store: Store; load: (bookingId: string) => Promise<unknown>; now: () => number;
}, options: { enabled?: boolean; expiresAfterMs: number }): Promise<ScheduleCycleResult> {
  const outcomes: Outcome[] = [];
  const result = (state: ScheduleCycleResult['state']): ScheduleCycleResult => ({ state, outcomes, canSend: false });
  if (options.enabled !== true) return result('disabled');
  if (!z.uuid().safeParse(bookingId).success || !Number.isSafeInteger(options.expiresAfterMs)
    || options.expiresAfterMs <= 0 || options.expiresAfterMs > 86_400_000) return result('invalid');
  let started: number;
  try { started = deps.now(); } catch { return result('unavailable'); }
  const now = () => {
    const value = deps.now();
    if (!Number.isFinite(started) || !Number.isFinite(value) || value < started || value - started > 60_000)
      throw Error('Unavailable');
    return value;
  };
  const read = async () => {
    now();
    const before = scheduleContextSchema.parse(await deps.store.context(bookingId));
    const snapshot = parseSnapshot(await deps.load(bookingId), bookingId, now());
    const after = scheduleContextSchema.parse(await deps.store.context(bookingId));
    now();
    if (!isDeepStrictEqual(before, after)) throw Error('Unavailable');
    requireTimingEvidence(snapshot.timingEvidence, { bookingId, sourceIdentity: snapshot.sourceIdentity,
      clocks: snapshot.clocks, observedAt: snapshot.observedAt, route: snapshot.route, context: after }, now());
    return { snapshot, context: after };
  };
  try {
    const initial = await read(), baseline = unchangedInputs(initial.snapshot);
    for (const key of guestKeys) {
      // Re-read immediately before each write, including the first. No stale batch
      // may finish inserting after a source, route, booking or template change.
      const current = await read();
      if (unchangedInputs(current.snapshot) !== baseline || !isDeepStrictEqual(current.context, initial.context)) return result('changed');
      const s = current.snapshot, at = now();
      const plan = planCalderwoodSchedule({ stay: { canonicalId: bookingId, status: s.booking.status,
        duplicateOf: s.booking.duplicateOf, clocks: s.clocks }, rules: s.capturedRules, ledger: s.ledger, now: at }).find(p => p.key === key)!;
      if (plan.state !== 'future_candidate') { outcomes.push({ key, state: plan.state }); continue; }
      const captured = s.capturedRules.find(r => r.property_id === '65_calderwood' && r.key === key)!;
      const execution = s.currentRules.find(r => r.property_id === '65_calderwood' && r.key === key);
      // The future release may change only dispatch flags and remove the archived
      // policy. IDs, text, clock policy and every other field must remain exact.
      const expected = { ...captured, enabled: true, configured_in_ota: false, send_mode: 'auto', migration_policy: null };
      if (!preparedRulePolicy(captured, at) || !isDeepStrictEqual(execution, expected)) {
        outcomes.push({ key, state: 'release_required' }); continue;
      }
      const fire = Date.parse(plan.fireAt!);
      if (fire <= at || fire > at + 500 * 86_400_000) { outcomes.push({ key, state: 'out_of_window' }); continue; }
      // These date fields use Guesty's captured format, never generic Helm dates.
      const rendered = renderTemplate(captured.body, { ...s.merge,
        check_in_long: formatGuestyMessageDate(s.booking.start), check_out_long: formatGuestyMessageDate(s.booking.end) });
      if (!rendered.text || rendered.text.length > 16000 || rendered.missing.length
        || overrideBodyProblem(rendered.text) || /[{}]/.test(rendered.text)) {
        outcomes.push({ key, state: 'render_review' }); continue;
      }
      now();
      const sendId = retainedGuestSendId(bookingId, key);
      let saved;
      try {
        saved = await deps.store.register({ ...current.context, ...s.route, sendId, bookingId,
          automationId: captured.id, key, bodySha256: hash(rendered.text), fireAt: plan.fireAt!,
          expiresAt: new Date(fire + options.expiresAfterMs).toISOString() });
      } catch { saved = { state: 'uncertain' as const }; }
      // A write might have committed. Stop, return no body/exception and reconcile
      // history on the next invocation; never retry within this run.
      if ((saved.state !== 'created' && saved.state !== 'existing') || saved.sendId !== sendId) {
        outcomes.push({ key, state: 'uncertain', sendId }); return result('uncertain');
      }
      outcomes.push({ key, state: saved.state, sendId });
    }
    return result('complete');
  } catch (error) { return result(error instanceof TimingEvidenceError ? 'timing_review' : 'unavailable'); }
}
