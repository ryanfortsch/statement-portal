import 'server-only';
import { createChannexJobStore, type MessageRpc } from './store.ts';
import { ChannexMessageWorker, type WorkerResult } from './worker.ts';
import { ChannexMessageTransport } from './transport.ts';

/** Receipt-only recovery deliberately does not require an active booking/binding.
 * A hold or cancellation after acceptance must not prevent recording that receipt.
 * The stored immutable target/hash is verified; this path cannot POST or resend.
 */
export async function reconcileCalderwoodMessage(sendId: string, deps: {
  rpc: MessageRpc; key: () => Promise<string>; fetcher?: typeof fetch; clock?: () => number;
}, options: { enabled?: boolean } = {}): Promise<WorkerResult & { providerReads: number; providerPosts: 0 }> {
  let providerReads = 0;
  const result = (r: WorkerResult) => ({ ...r, providerReads, providerPosts: 0 as const });
  if (options.enabled !== true) return result({ state: 'disabled' });
  try {
    const clock = deps.clock ?? Date.now, started = clock(); let last = started;
    const now = () => {
      const at = clock();
      if (!Number.isSafeInteger(at) || !Number.isSafeInteger(started) || at < last || at - started >= 30_000) throw Error();
      last = at; return at;
    };
    const store = createChannexJobStore(deps.rpc), job = await store.read(sendId); now();
    if (!job) return result({ state: 'blocked' });
    if (job.state === 'recorded') return result({ state: 'recorded' });
    if (job.state !== 'accepted') return result({ state: 'needs_reconciliation' });
    const key = await deps.key(); now();
    const transport = new ChannexMessageTransport({ scope: job, apiKey: key, sendEnabled: false,
      fetcher: async (url, init) => {
        if (init.method !== 'GET' || init.body !== undefined || ++providerReads > 6) throw Error();
        const remaining = 30_000 - (now() - started);
        return (deps.fetcher ?? fetch)(url, { ...init,
          signal: AbortSignal.any([AbortSignal.timeout(Math.min(8000, remaining)), ...(init.signal ? [init.signal] : [])]) });
      } });
    return result(await new ChannexMessageWorker({ store, transport, enabled: true }).reconcile(sendId));
  } catch { return result({ state: 'unconfirmed' }); }
}
