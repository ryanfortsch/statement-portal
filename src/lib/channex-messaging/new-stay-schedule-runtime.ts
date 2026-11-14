import 'server-only';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { overrideBodyProblem, renderTemplate } from '../automations-core.ts';
import { cleanerRecipientProof, readCleanerEnrollment, sameCleanerEnrollment } from './cleaner-enrollment.ts';
import { CleanerSmsTransport } from './cleaner-sms-transport.ts';
import { renderRetainedCleanerSms } from './cleaner-sms-worker.ts';
import { cleanerKeys, retainedCleanerSendId } from './cleaner-runtime.ts';
import { guestKeys, retainedGuestSendId } from './schedule-coordinator.ts';
import { fixedNewStayInputs, loadVerifiedNewStay } from './new-stay-provider.ts';
import { createNewStayScheduleInputReader, planAdmittedStay } from './new-stay-schedule-inputs.ts';
import { createCalderwoodTemplateCaptureReader } from './template-retention.ts';
import type { MessageRpc } from './store.ts';

export const newStayScheduleRequest = z.object({ bookingId: z.uuid(), templateCaptureId: z.uuid(),
  templateDigest: z.string().regex(/^[a-f0-9]{64}$/), cleanerReleaseId: z.uuid() }).strict();
type Dependencies = { rpc: MessageRpc; channexKey: () => Promise<string>;
  smsProof: () => Promise<{ receiptKey: string; keyId: string }>; fetcher?: typeof fetch; clock?: () => number };
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

/** One admitted stay, six workflows, ONE atomic write; default off. No transport
 * may POST, no send/claim/release function is invoked. Partial preparation never
 * registers half a stay. Existing schedules/holds/history keep their identities. */
export async function registerNewStaySchedules(raw: unknown, deps: Dependencies, options: { enabled?: boolean } = {}) {
  const result = (state: string, registered = 0) => ({ state, registered, canSend: false as const });
  if (options.enabled !== true) return result('disabled');
  const parsed = newStayScheduleRequest.safeParse(raw);
  if (!parsed.success) return result('invalid');
  try {
    const request = parsed.data, clock = deps.clock ?? Date.now, started = clock(); let last = started, reads = 0;
    const now = () => { const at = clock();
      if (!Number.isSafeInteger(started) || !Number.isSafeInteger(at) || at < last || at - started >= 90000) throw Error();
      last = at; return at; };
    const rpc: MessageRpc = async (name, args) => { now(); const r = await deps.rpc(name, args); now(); return r; };
    const fetcher: typeof fetch = async (url, init) => {
      now(); if (init?.method !== 'GET' || init.body !== undefined || ++reads > 14) throw Error();
      return (deps.fetcher ?? fetch)(url, init);
    };
    const reference = { captureId: request.templateCaptureId, templateDigest: request.templateDigest };
    const archive = await createCalderwoodTemplateCaptureReader(rpc, { enabled: true }).load(reference.captureId, reference.templateDigest, now());
    if (!archive) throw Error();
    const enrollment = await readCleanerEnrollment(reference, rpc, now);
    // Fingerprints only: scheduling needs no Quo API key and has no sending capability.
    const transport = new CleanerSmsTransport({ ...await deps.smsProof(), apiKey: 'disabled-scheduling', sendEnabled: false,
      fetcher: async () => { throw Error(); }, clock: now });
    const proof = cleanerRecipientProof(enrollment, transport);
    const s = await loadVerifiedNewStay(request.bookingId, { rpc, now, channexKey: deps.channexKey, fetcher });
    const release = enrollment.release;
    if (!release || release.releaseId !== request.cleanerReleaseId || release.captureId !== reference.captureId
      || release.templateDigest !== reference.templateDigest || enrollment.authority !== 'helm' || !enrollment.automationsEnabled
      || !enrollment.scopeEnabled || release.routeGeneration !== s.context.routeGeneration
      || enrollment.routeGeneration !== s.context.routeGeneration || release.recipientRevision !== enrollment.recipientRevision
      || release.keyId !== proof.keyId || release.recipientHmac !== proof.recipientHmac || release.targetHmac !== proof.targetHmac
      || Date.parse(release.reviewedAt) > now()) return result('release_required');
    const plans: Record<string, unknown>[] = [];
    for (const p of planAdmittedStay(s, archive.capturedRules, now())) {
      // A past trigger is intentionally not replayed. A held/sent/existing row is
      // retained; changed/uncertain/conflicting history blocks NEW registration.
      if (['past_not_replayed', 'already_sent', 'held', 'existing_schedule'].includes(p.state)) continue;
      if (p.state !== 'future_candidate' || !p.fireAt) return result('review_required');
      const rule = archive.capturedRules.find(r => r.key === p.key)!;
      const current = s.currentRules.find(r => r.id === rule.id);
      const fire = Date.parse(p.fireAt);
      if (fire <= now() || fire > now() + 500 * 86400000) return result('out_of_window');
      if (guestKeys.some(k => k === p.key)) {
        if (!isDeepStrictEqual(current, { ...rule, enabled: true, configured_in_ota: false, send_mode: 'auto', migration_policy: null }))
          return result('release_required');
        const rendered = renderTemplate(rule.body, s.merge);
        if (!rendered.text || Buffer.byteLength(rendered.text, 'utf8') > 10240 || rendered.missing.length
          || overrideBodyProblem(rendered.text) || /[{}]/.test(rendered.text)) return result('render_review');
        const key = p.key as typeof guestKeys[number];
        plans.push({ ...s.context, ...s.route, sendId: retainedGuestSendId(request.bookingId, key), bookingId: request.bookingId,
          automationId: rule.id, key, bodySha256: hash(rendered.text), fireAt: p.fireAt, expiresAt: new Date(fire + 1800000).toISOString() });
      } else {
        const key = p.key as typeof cleanerKeys[number];
        if (!isDeepStrictEqual(current, rule) || !isDeepStrictEqual(enrollment.currentRules.find(r => r.id === rule.id), rule))
          return result('release_required');
        const rendered = renderRetainedCleanerSms({ contextRevision: s.context.contextRevision, rule, clocks: s.admission.clocks,
          propertyName: s.merge.property_name ?? '', recipients: enrollment.recipients }, transport, now());
        if (Date.parse(rendered.fireAt) !== fire) return result('review_required');
        plans.push({ sendId: retainedCleanerSendId(request.bookingId, key), bookingId: request.bookingId,
          newStayId: request.bookingId, automationId: rule.id, releaseId: release.releaseId, propertyId: '65_calderwood', key,
          keyId: rendered.keyId, contextRevision: s.context.contextRevision, recipientHmac: rendered.recipientHmac,
          targetHmac: rendered.targetHmac, bodySha256: rendered.bodySha256, fireAt: p.fireAt, expiresAt: new Date(fire + 1800000).toISOString() });
      }
    }
    if (!plans.length) return result('waiting');
    const after = await readCleanerEnrollment(reference, rpc, now);
    if (!sameCleanerEnrollment(enrollment, after)) return result('changed');
    // SQL also locks and rechecks every dependency. This final read detects
    // context changes before attempting any write; ledger races are atomic below.
    const final = await createNewStayScheduleInputReader(rpc, { enabled: true }).load(request.bookingId, now);
    const { route: _route, ...initial } = s; void _route;
    if (!final || !isDeepStrictEqual(fixedNewStayInputs(initial), fixedNewStayInputs(final)))
      return result('changed');
    now();
    try {
      const out = await rpc('helm_channex_new_stay_schedule_register', { p_booking: request.bookingId, p_epoch: s.admission.epochId, p_plans: plans });
      if (!out || out.error !== null) throw Error();
      const saved = z.object({ state: z.literal('complete'), canSend: z.literal(false),
        results: z.array(z.object({ state: z.enum(['created', 'existing']), sendId: z.uuid() }).strict()).min(1).max(6) }).strict().parse(out.data);
      if (saved.results.length !== plans.length || saved.results.some((r, i) => r.sendId !== plans[i].sendId)) throw Error();
      return result('complete', saved.results.length);
    } catch { return result('uncertain'); } // Lost commit response: inspect history next tick, never rotate IDs or send.
  } catch { return result('unavailable'); }
}
