import 'server-only';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { createCalderwoodScheduleInputReader } from './schedule-inputs.ts';
import { registerCalderwoodStaySchedules, type ScheduleCycleResult } from './schedule-coordinator.ts';
import { createChannexScheduleStore } from './schedule-store.ts';
import { createCalderwoodTemplateCaptureReader } from './template-retention.ts';
import { inspectCalderwoodTimingProviders } from './timing-provider-review.ts';
import type { MessageRpc } from './store.ts';

const requestSchema = z.object({ bookingId: z.uuid(), bindingId: z.uuid(),
  templateCaptureId: z.uuid(), templateDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type Inputs = NonNullable<Awaited<ReturnType<ReturnType<typeof createCalderwoodScheduleInputReader>['load']>>>;
function fixedInputs(inputs: Inputs) {
  const { observedAt: _at, ledger: _ledger, ...snapshot } = inputs.snapshot;
  void _at; void _ledger;
  return { context: inputs.context, snapshot };
}

/** One retained, reviewed stay -> current database inputs -> fresh double provider
 * read -> source-offset coordinator -> atomic registration. Default off; no env,
 * HTTP/cron caller, binding writer, template release or message transport.
 *
 * Identifiers must come from an explicitly reviewed server-side release manifest.
 * There is no latest-capture fallback. Existing frozen templates stay frozen.
 * New bookings without retained Guesty evidence cannot use this path. A successful
 * result creates only schedules, never permission to send. Provider observations
 * are not a distributed lock: dispatch still requires fresh checks and one-use claim.
 */
export async function scheduleRetainedCalderwoodStay(raw: unknown, deps: {
  rpc: MessageRpc;
  credentials: () => Promise<{ guestyToken: string; channexKey: string }>;
  fetcher?: typeof fetch; clock?: () => number;
}, options: { enabled?: boolean; expiresAfterMs: number }) {
  let providerReads = 0;
  const result = (cycle: ScheduleCycleResult) => ({ ...cycle, providerReads, messagesSent: 0 as const });
  const empty = (state: ScheduleCycleResult['state']) => result({ state, outcomes: [], canSend: false });
  if (options.enabled !== true) return empty('disabled');
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success || !Number.isSafeInteger(options.expiresAfterMs)
    || options.expiresAfterMs <= 0 || options.expiresAfterMs > 86_400_000) return empty('invalid');
  const request = parsed.data, clock = deps.clock ?? Date.now;
  try {
    const started = clock(); let last = started;
    const now = () => {
      const at = clock();
      if (!Number.isSafeInteger(started) || !Number.isSafeInteger(at) || at < last || at - started >= 60_000) throw Error();
      last = at; return at;
    };
    now();
    const rpc: MessageRpc = async (name, args) => {
      now(); const response = await deps.rpc(name, args); now(); return response;
    };
    const reader = createCalderwoodScheduleInputReader(rpc, { enabled: true });
    const templates = createCalderwoodTemplateCaptureReader(rpc, { enabled: true });
    const store = createChannexScheduleStore(rpc, { enabled: true });
    const fetcher: typeof fetch = async (url, init) => {
      // Five snapshots maximum: initial + one before each of four registrations.
      // Each has two four-request scans. No discovery: the saved binding has a thread.
      if (++providerReads > 40 || init?.method !== 'GET' || init.body !== undefined) throw Error();
      const remaining = 60_000 - (now() - started);
      const signal = AbortSignal.any([AbortSignal.timeout(Math.min(8000, remaining)), ...(init.signal ? [init.signal] : [])]);
      const response = await (deps.fetcher ?? fetch)(url, { ...init, signal }); now(); return response;
    };
    const load = async (bookingId: string) => {
      if (bookingId !== request.bookingId) throw Error();
      const before = await reader.load(bookingId, request.bindingId, now);
      if (!before) throw Error();
      const archive = await templates.load(request.templateCaptureId, request.templateDigest, now());
      if (!archive) throw Error();
      const evidence = before.snapshot.timingEvidence;
      const inspected = await inspectCalderwoodTimingProviders({ bookingId, captureId: evidence.captureId }, {
        clock: now, fetcher,
        credentials: async () => { now(); const keys = await deps.credentials(); now(); return keys; },
        load: async ({ captureId }) => {
          const response = await rpc('helm_channex_timing_review_snapshot', { p_capture_id: captureId, p_booking_id: bookingId });
          if (!response || response.error !== null || !response.data) throw Error();
          // Pin the existing bound thread. Never discover a replacement and attach
          // it to old review evidence during a background scheduling read.
          const s = z.object({ route: z.object({ remoteBookingId: z.uuid(), threadId: z.uuid().optional(), revisionId: z.uuid() }).strict() })
            .passthrough().parse(response.data);
          if (s.route.remoteBookingId !== before.snapshot.route.remoteBookingId
            || (s.route.threadId && s.route.threadId !== before.snapshot.route.threadId)) throw Error();
          return { ...s, route: { ...s.route, threadId: before.snapshot.route.threadId } };
        },
      }, { enabled: true });
      if (inspected.state !== 'verified' || !isDeepStrictEqual(inspected.snapshot.context, before.context)
        || !isDeepStrictEqual(inspected.snapshot.capture.row, evidence.row)
        || inspected.snapshot.capture.id !== evidence.captureId
        || inspected.threadId !== before.snapshot.route.threadId) throw Error();
      const after = await reader.load(bookingId, request.bindingId, now);
      if (!after || !isDeepStrictEqual(fixedInputs(before), fixedInputs(after))) throw Error();
      // Use the newly read ledger, including holds/cancellation/other registrations
      // that arrived while provider reads were in progress. The coordinator then
      // rechecks context and reconciles this history before its one atomic write.
      return { ...after.snapshot, capturedRules: archive.capturedRules };
    };
    return result(await registerCalderwoodStaySchedules(request.bookingId, { store, load, now }, options));
  } catch { return empty('unavailable'); }
}
