/** Backup polling on the existing isolated worker. Never publishes or sends messages. */
import { setTimeout as sleep } from 'node:timers/promises';
import { createCanonicalRevisionClient } from './canonical-revision-client.ts';
import { createCanonicalRevisionStore } from './canonical-revision-store.ts';
import { ingestCanonicalRevisions } from './canonical-revisions.ts';

type Environment = Record<string, string | undefined>;
type Page = Awaited<ReturnType<typeof ingestCanonicalRevisions>>;
type CycleLog = { event: 'canonical-revision-cycle'; at: string; outcome: 'success' | 'failure'; failures: number;
  received?: number; applied?: number; stale?: number; acknowledged?: number };
export function canonicalPollingEnabled(env: Environment) {
  return env.CHANNEX_CANONICAL_POLLING_ENABLED === 'true' && env.CHANNEX_WORKER_MODE === 'isolated-staging'
    && !env.VERCEL_ENV && env.CHANNEX_STAGING_DB_PROJECT_REF === 'jgkblfozftcvymvwhhii'
    && env.CHANNEX_STAGING_DB_URL === 'https://jgkblfozftcvymvwhhii.supabase.co';
}
export function createCanonicalRevisionPageRunner(env: Environment, fetcher: typeof fetch = fetch) {
  if (!canonicalPollingEnabled(env) || !env.CHANNEX_STAGING_API_KEY?.trim() || !env.CHANNEX_STAGING_DB_SERVICE_KEY?.trim()) {
    throw Error('Explicit isolated canonical polling configuration required');
  }
  return async (signal: AbortSignal) => {
    // Preserve per-request deadlines and also bound the whole page, including database requests.
    const boundedFetch: typeof fetch = (input, init) => {
      signal.throwIfAborted();
      return fetcher(input, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(20000),
        ...(init?.signal ? [init.signal] : [])]) });
    };
    return ingestCanonicalRevisions(createCanonicalRevisionClient(env.CHANNEX_STAGING_API_KEY!, boundedFetch),
      createCanonicalRevisionStore(env.CHANNEX_STAGING_DB_URL!, env.CHANNEX_STAGING_DB_SERVICE_KEY!, boundedFetch));
  };
}
export async function runCanonicalRevisionScheduler(input: {
  drainPage: (signal: AbortSignal) => Promise<Page>;
  signal: AbortSignal; once?: boolean; now?: () => number;
  log: (entry: CycleLog) => void;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}) {
  let failures = 0, cycles = 0;
  const wait = input.wait ?? ((milliseconds, signal) => sleep(milliseconds, undefined, { signal }));
  while (!input.signal.aborted) {
    let received = 0, entry: CycleLog;
    try {
      // Sequential pages, each with a deadline. Always page 1: ACK removes feed entries.
      const page = await input.drainPage(AbortSignal.any([input.signal, AbortSignal.timeout(120000)]));
      received = page.received; failures = 0;
      entry = { event: 'canonical-revision-cycle', at: new Date((input.now ?? Date.now)()).toISOString(),
        outcome: 'success', failures, received, applied: page.applied, stale: page.stale, acknowledged: page.acknowledged };
    } catch {
      if (input.signal.aborted) break;
      failures++;
      entry = { event: 'canonical-revision-cycle', at: new Date((input.now ?? Date.now)()).toISOString(), outcome: 'failure', failures };
    }
    cycles++;
    try { input.log(entry); } catch { /* Telemetry cannot undo a durable import or cause an immediate retry. */ }
    if (input.once || input.signal.aborted) break;
    // Catch up immediately after startup; drain backlog before returning to a 15-minute safety poll.
    const delay = failures ? Math.min(60000 * 2 ** Math.min(failures - 1, 4), 900000) : received ? 5000 : 900000;
    try { await wait(delay, input.signal); }
    catch { if (!input.signal.aborted) throw Error('Canonical revision scheduler wait failed'); }
  }
  return { cycles, failed: failures > 0, canSend: false as const };
}
