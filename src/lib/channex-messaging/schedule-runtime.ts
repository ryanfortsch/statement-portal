import 'server-only';
import { registerCalderwoodStaySchedules, type ScheduleCycleResult } from './schedule-coordinator.ts';
import { createChannexScheduleStore } from './schedule-store.ts';
import type { MessageRpc } from './store.ts';

import { retainedStayRequestSchema as requestSchema, loadVerifiedRetainedStay } from './retained-stay.ts';

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
      return (await loadVerifiedRetainedStay(request, { rpc, now, fetcher, credentials: deps.credentials })).snapshot;
    };
    return result(await registerCalderwoodStaySchedules(request.bookingId, { store, load, now }, options));
  } catch { return empty('unavailable'); }
}
