import 'server-only';
import { isDeepStrictEqual } from 'node:util';
import { renderTemplate, overrideBodyProblem } from '../automations-core.ts';
import { retainedPilotManifestSchema } from './runtime-config.ts';
import { guestKeys, retainedGuestSendId } from './schedule-coordinator.ts';
import { createCalderwoodScheduleInputReader } from './schedule-inputs.ts';
import { createCalderwoodTemplateCaptureReader } from './template-retention.ts';
import { createChannexJobStore, type MessageRpc } from './store.ts';
import { planCalderwoodSchedule } from './schedule-plan.ts';
import { scheduleRetainedCalderwoodStay } from './schedule-runtime.ts';
import { dispatchRetainedCalderwoodMessage } from './dispatch-runtime.ts';
import { reconcileCalderwoodMessage } from './receipt-runtime.ts';

const LATE_WINDOW = 30 * 60_000;
type StayResult = { action: 'idle' | 'schedule' | 'dispatch'; state: string; receiptState?: string;
  attention: boolean; providerReads: number; providerPosts: number };
type Dependencies = { rpc: MessageRpc; credentials: () => Promise<{ guestyToken: string; channexKey: string }>;
  receiptKey: () => Promise<string>; fetcher?: typeof fetch; clock?: () => number };

/** At most four explicitly enrolled retained stays, one execution action and one
 * independent receipt check per stay/tick. Due sends precede future registration.
 * The deterministic identities also allow receipt recovery when current booking
 * inputs become unavailable. No arbitrary job discovery or legacy-send fallback.
 * Independent stays run concurrently; SQL owns cross-process claim exclusion.
 */
export async function runRetainedCalderwoodPilot(raw: unknown, deps: Dependencies, options: { enabled?: boolean } = {}) {
  if (options.enabled !== true) return { state: 'disabled', ok: true, stays: [] as StayResult[] };
  const parsed = retainedPilotManifestSchema.safeParse(raw);
  if (!parsed.success) return { state: 'configuration_required', ok: false, stays: [] as StayResult[] };
  const clock = deps.clock ?? Date.now;
  const stays = await Promise.all(parsed.data.stays.map(async (request): Promise<StayResult> => {
    const idle = (state: string, attention = true): StayResult => ({ action: 'idle', state, attention, providerReads: 0, providerPosts: 0 });
    try {
      const started = clock(); let last = started;
      const now = () => {
        const at = clock();
        if (!Number.isSafeInteger(at) || !Number.isSafeInteger(started) || at < last || at - started >= 135_000) throw Error();
        last = at; return at;
      };
      const store = createChannexJobStore(deps.rpc);
      const jobs = await Promise.all(guestKeys.map(async key => ({ key, job: await store.read(retainedGuestSendId(request.bookingId, key)) })));
      now();
      const operate = async (): Promise<StayResult> => {
        let attention = jobs.some(({ job }) => job && ['attempting', 'unknown', 'rejected'].includes(job.state));
        let future = false, dueSendId: string | null = null;
        try {
          const [inputs, archive] = await Promise.all([
            createCalderwoodScheduleInputReader(deps.rpc, { enabled: true }).load(request.bookingId, request.bindingId, now),
            createCalderwoodTemplateCaptureReader(deps.rpc, { enabled: true }).load(request.templateCaptureId, request.templateDigest, now()),
          ]);
          if (!inputs || !archive) throw Error();
          const s = inputs.snapshot, at = now();
          const plans = planCalderwoodSchedule({ stay: { canonicalId: request.bookingId, status: s.booking.status,
            duplicateOf: s.booking.duplicateOf, clocks: s.clocks }, rules: archive.capturedRules, ledger: s.ledger, now: at })
            .filter(p => guestKeys.some(key => key === p.key));
          for (const p of plans.filter(p => p.state === 'future_candidate')) {
            const original = archive.capturedRules.find(r => r.key === p.key)!;
            const current = s.currentRules.find(r => r.id === original.id);
            const rendered = renderTemplate(original.body, s.merge);
            // Avoid repeated provider scans for a known missing code/frozen rule.
            // This is only work selection; the scheduler revalidates everything.
            if (!isDeepStrictEqual(current, { ...original, enabled: true, configured_in_ota: false,
              send_mode: 'auto', migration_policy: null }) || !rendered.text || rendered.missing.length
              || Buffer.byteLength(rendered.text) > 10240 || overrideBodyProblem(rendered.text) || /[{}]/.test(rendered.text)
              || !p.fireAt || Date.parse(p.fireAt) > at + 500 * 86_400_000) attention = true;
            else future = true;
          }
          attention ||= plans.some(p => !['future_candidate', 'existing_schedule', 'already_sent', 'past_not_replayed'].includes(p.state)
            && !(p.state === 'delivery_uncertain' && jobs.some(j => j.key === p.key && j.job?.state === 'accepted')));
          const due = plans.filter(p => p.state === 'existing_schedule' && p.fireAt && Date.parse(p.fireAt) <= at)
            .sort((a, b) => Date.parse(a.fireAt!) - Date.parse(b.fireAt!));
          for (const plan of due) {
            const job = jobs.find(j => j.key === plan.key)?.job;
            const row = s.ledger.find(r => r.id === job?.sendId);
            if (at >= Date.parse(plan.fireAt!) + LATE_WINDOW || !job || !row || job.state !== 'prepared'
              || job.bookingId !== s.route.remoteBookingId || job.threadId !== s.route.threadId
              || job.contextRevision !== inputs.context.contextRevision) { attention = true; continue; }
            dueSendId = job.sendId; break;
          }
        } catch { attention = true; }
        if (dueSendId) {
          // Dispatch performs its own fresh full review and one-use SQL claim.
          now();
          const out = await dispatchRetainedCalderwoodMessage({ ...request, sendId: dueSendId }, deps, { enabled: true });
          return { action: 'dispatch', state: out.state, attention: attention || out.state !== 'accepted',
            providerReads: out.providerReads, providerPosts: out.providerPosts };
        }
        if (future) {
          now();
          const out = await scheduleRetainedCalderwoodStay(request, deps, { enabled: true, expiresAfterMs: LATE_WINDOW });
          return { action: 'schedule', state: out.state, attention: attention || out.state !== 'complete'
            || out.outcomes.some(o => !['created', 'existing', 'existing_schedule', 'already_sent', 'past_not_replayed'].includes(o.state)),
          providerReads: out.providerReads, providerPosts: 0 };
        }
        return idle(attention ? 'review_required' : 'waiting', attention);
      };
      const accepted = jobs.flatMap(j => j.job?.state === 'accepted' ? [j.job] : []);
      // Rotate across unresolved receipts so one missing provider row cannot
      // indefinitely hide other accepted receipts on the same stay.
      const receipt = accepted.length ? accepted[Math.floor(now() / 60_000) % accepted.length] : null;
      const [out, recovered] = await Promise.all([
        operate().catch(() => idle('unavailable')),
        receipt ? reconcileCalderwoodMessage(receipt.sendId, { ...deps, key: deps.receiptKey }, { enabled: true }) : null,
      ]);
      return recovered ? { ...out, receiptState: recovered.state, attention: out.attention || recovered.state !== 'recorded',
        providerReads: out.providerReads + recovered.providerReads } : out;
    } catch { return idle('unavailable'); }
  }));
  return { state: 'complete', ok: stays.every(s => !s.attention), stays };
}
