import 'server-only';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { renderTemplate, overrideBodyProblem } from '../automations-core.ts';
import { loadVerifiedRetainedStay, retainedStayRequestSchema } from './retained-stay.ts';
import { planCalderwoodSchedule } from './schedule-plan.ts';
import { ChannexMessageTransport } from './transport.ts';
import { ChannexMessageWorker, type ChannexJob, type WorkerResult } from './worker.ts';
import { createChannexJobStore, type MessageRpc } from './store.ts';

const schema = retainedStayRequestSchema.extend({ sendId: z.uuid() }).strict();
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
type Snapshot = Awaited<ReturnType<typeof loadVerifiedRetainedStay>>;

function renderCurrent(job: ChannexJob, loaded: Snapshot, at: number) {
  const { snapshot: s, scope } = loaded;
  if (job.environment !== scope.environment || job.propertyId !== scope.propertyId
    || job.channelId !== scope.channelId || job.provider !== scope.provider
    || job.bookingId !== s.route.remoteBookingId || job.threadId !== s.route.threadId
    || job.contextRevision !== s.timingEvidence.binding.contextRevision) throw Error();
  const row = s.ledger.find(r => r.id === job.sendId);
  const captured = s.capturedRules.find(r => r.id === row?.automation_id && r.audience === 'guest');
  if (!row || !captured || row.automation_key !== captured.key || row.booking_id !== s.booking.id) throw Error();
  const plan = planCalderwoodSchedule({ stay: { canonicalId: s.booking.id, status: s.booking.status,
    duplicateOf: s.booking.duplicateOf, clocks: s.clocks }, rules: s.capturedRules, ledger: s.ledger, now: at })
    .find(p => p.key === captured.key);
  if (plan?.state !== 'existing_schedule' || !plan.fireAt || Date.parse(plan.fireAt) > at) throw Error();
  const execution = s.currentRules.find(r => r.id === captured.id);
  if (!isDeepStrictEqual(execution, { ...captured, enabled: true, configured_in_ota: false,
    send_mode: 'auto', migration_policy: null })) throw Error();
  const rendered = renderTemplate(captured.body, s.merge);
  if (rendered.missing.length || !rendered.text || Buffer.byteLength(rendered.text) > 10240
    || overrideBodyProblem(rendered.text) || /[{}]/.test(rendered.text) || sha(rendered.text) !== job.bodySha256) throw Error();
  return { text: rendered.text, contextRevision: job.contextRevision };
}

/** ONE explicitly identified retained-stay job. Default off, no HTTP/cron/env
 * caller. Double provider reads and current rendering run before transport and
 * again immediately before the SQL one-use claim. No automatic provider retry.
 * Unknown outcomes stay in the durable ledger; accepted does not mean delivered.
 */
export async function dispatchRetainedCalderwoodMessage(raw: unknown, deps: {
  rpc: MessageRpc; credentials: () => Promise<{ guestyToken: string; channexKey: string }>;
  fetcher?: typeof fetch; clock?: () => number;
}, options: { enabled?: boolean } = {}): Promise<WorkerResult & { providerReads: number; providerPosts: number }> {
  let providerReads = 0, providerPosts = 0;
  const result = (r: WorkerResult) => ({ ...r, providerReads, providerPosts });
  if (options.enabled !== true) return result({ state: 'disabled' });
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return result({ state: 'blocked' });
  const { sendId, ...request } = parsed.data;
  const clock = deps.clock ?? Date.now;
  try {
    const started = clock(); let last = started;
    const now = () => {
      const at = clock();
      if (!Number.isSafeInteger(at) || !Number.isSafeInteger(started) || at < last || at - started >= 90_000) throw Error();
      last = at; return at;
    };
    const readRpc: MessageRpc = async (name, args) => {
      now(); const response = await deps.rpc(name, args); now(); return response;
    };
    const fetcher: typeof fetch = async (url, init) => {
      now();
      if (init?.method === 'GET' && init.body === undefined) {
        if (++providerReads > 17) throw Error();
      } else if (init?.method === 'POST') {
        if (++providerPosts > 1) throw Error();
      } else throw Error();
      const remaining = 90_000 - (now() - started);
      const signal = AbortSignal.any([AbortSignal.timeout(Math.min(8000, remaining)), ...(init.signal ? [init.signal] : [])]);
      return (deps.fetcher ?? fetch)(url, { ...init, signal });
    };
    const store = createChannexJobStore(readRpc);
    const job = await store.read(sendId);
    if (!job) return result({ state: 'blocked' });
    if (job.state !== 'prepared' || job.attemptId !== null) return result({ state: 'needs_reconciliation' });
    const credentials = await deps.credentials(); now();
    const load = () => loadVerifiedRetainedStay(request, { rpc: readRpc, now, fetcher, credentials: async () => credentials });
    const initial = await load(), initialRender = renderCurrent(job, initial, now());
    const transport = new ChannexMessageTransport({ scope: initial.scope, apiKey: credentials.channexKey, sendEnabled: true,
      fetcher: (url, init) => fetcher(url, init) });
    const worker = new ChannexMessageWorker({ enabled: true, transport, store: {
      read: store.read,
      claim: async (id, attemptId, attempt) => {
        try {
          const current = await load();
          const rendered = renderCurrent(job, current, now());
          if (!isDeepStrictEqual(rendered, initialRender)) return false;
        } catch { return false; } // No claim was attempted, so no delivery uncertainty.
        // SQL independently checks hold, canonical dates, history, source proof,
        // release, context and schedule under locks. Only this claim allows POST.
        return store.claim(id, attemptId, attempt);
      },
      // Receipt/uncertainty must still be recorded if the provider used the entire
      // time budget. Never discard an accepted/unknown outcome on a local deadline.
      finish: createChannexJobStore(deps.rpc).finish,
    } });
    return result(await worker.dispatch(sendId, async current => {
      if (!isDeepStrictEqual(job, current)) throw Error();
      now(); return initialRender;
    }));
  } catch { return result({ state: 'blocked' }); }
}
