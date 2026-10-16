/** Bounded receipt-only sweeps for the existing staging worker. Never invokes a sender. */
import { setTimeout as sleep } from 'node:timers/promises';
import { drainCleanerReceiptInbox } from './cleaner-receipt-inbox.ts';
import { createCleanerReceiptRuntime } from './cleaner-receipt-runtime.ts';
type Page = Awaited<ReturnType<typeof drainCleanerReceiptInbox>>;
type CycleLog = { event: 'cleaner-receipt-cycle'; at: string; outcome: 'success' | 'failure'; failures: number;
  scanned?: number; applied?: number; duplicate?: number; unmatched?: number; stale?: number; nextCursor?: number };
export function createCleanerReceiptPageRunner(env: Record<string, string | undefined>, fetcher: typeof fetch = fetch) {
  // Validate before starting other worker loops; each cycle gets its own deadline.
  createCleanerReceiptRuntime(env, 'worker', undefined, fetcher);
  return async (afterSequence: number, signal: AbortSignal) => drainCleanerReceiptInbox({
    ...createCleanerReceiptRuntime(env, 'worker', signal, fetcher), afterSequence, limit: 25,
  });
}
export async function runCleanerReceiptScheduler(input: {
  drainPage: (afterSequence: number, signal: AbortSignal) => Promise<Page>;
  signal: AbortSignal; once?: boolean; now?: () => number;
  log: (entry: CycleLog) => void;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}) {
  let cursor = 0, failures = 0, cycles = 0;
  const wait = input.wait ?? ((milliseconds, signal) => sleep(milliseconds, undefined, { signal }));
  while (!input.signal.aborted) {
    const deadline = AbortSignal.any([input.signal, AbortSignal.timeout(20000)]);
    let entry: CycleLog;
    try {
      const page = await input.drainPage(cursor, deadline);
      cursor = page.nextCursor; failures = 0;
      entry = { event: 'cleaner-receipt-cycle', at: new Date((input.now ?? Date.now)()).toISOString(),
        outcome: 'success', failures, scanned: page.scanned, applied: page.applied, duplicate: page.duplicate,
        unmatched: page.unmatched, stale: page.stale, nextCursor: cursor };
    } catch {
      if (input.signal.aborted) break;
      cursor = 0; failures++;
      entry = { event: 'cleaner-receipt-cycle', at: new Date((input.now ?? Date.now)()).toISOString(), outcome: 'failure', failures };
    }
    cycles++;
    try { input.log(entry); } catch { /* Telemetry cannot change receipt state or trigger another application. */ }
    if (input.once || input.signal.aborted) break;
    const delay = failures ? Math.min(60000 * 2 ** Math.min(failures - 1, 4), 900000) : cursor ? 5000 : 60000;
    try { await wait(delay, input.signal); }
    catch { if (!input.signal.aborted) throw Error('Receipt scheduler wait failed'); }
  }
  return { cycles, failed: failures > 0, canSend: false as const };
}
