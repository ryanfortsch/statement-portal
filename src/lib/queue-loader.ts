/**
 * A messaging queue's feed read, bounded and ordered. Pure: no React, so the
 * rules are unit-tested (src/lib/__tests__/queue-loader.test.ts) and
 * useApprovalQueue only wires them to state.
 *
 * Three things went wrong silently before this existed:
 *  - a read had no deadline, so a hung feed left the queue frozen with
 *    nothing on screen to say so;
 *  - two reads could overlap, and the older one landing second put cards the
 *    operator had just cleared back on the screen;
 *  - every failure was swallowed, so a dead feed looked exactly like a quiet
 *    inbox.
 *
 * So: a read gives up after QUEUE_READ_TIMEOUT_MS. A poll that finds a read
 * in flight joins it. A refresh someone asked for (a click, a card action, a
 * reconnect) cancels the read in flight and starts its own, so only the
 * newest request can replace the cards. A failure never replaces them: the
 * last good cards stay and the status says the refresh failed.
 */

export type QueueLoadStatus = 'ready' | 'refreshing' | 'failed' | 'offline';

/** How long one feed read may take before it counts as failed. The feed
 *  answers in ~60ms; twenty seconds is a dead feed, not a slow one. */
export const QUEUE_READ_TIMEOUT_MS = 20_000;

/** 'poll' is the background cadence: it joins a read already in flight and
 *  reports nothing until it settles. 'now' is a refresh someone asked for: it
 *  supersedes any read in flight and reports 'refreshing' while it runs. */
export type QueueLoadMode = 'poll' | 'now';

export type QueueLoader = {
  load: (mode?: QueueLoadMode) => Promise<void>;
  /** Abandon the read in flight and report nothing more about it (the
   *  browser went offline, or the queue unmounted). */
  cancel: () => void;
};

export function createQueueLoader<T>({
  read,
  accept,
  status,
  timeoutMs = QUEUE_READ_TIMEOUT_MS,
}: {
  read: (signal: AbortSignal) => Promise<T>;
  /** Called with the newest successful read, and only that one. */
  accept: (data: T) => void;
  status: (status: QueueLoadStatus) => void;
  timeoutMs?: number;
}): QueueLoader {
  let current: { controller: AbortController; done: Promise<void> } | null = null;

  const cancel = () => {
    const previous = current;
    current = null;
    previous?.controller.abort();
  };

  const load = (mode: QueueLoadMode = 'poll'): Promise<void> => {
    if (current && mode === 'poll') return current.done;
    cancel();
    const controller = new AbortController();
    const request = { controller, done: Promise.resolve() };
    current = request;
    if (mode === 'now') status('refreshing');
    request.done = (async () => {
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const data = await untilAborted(read(controller.signal), controller.signal);
        if (current !== request) return;
        accept(data);
        status('ready');
      } catch {
        // Superseded or cancelled reads say nothing; only the newest request
        // may change what the operator sees.
        if (current === request) status('failed');
      } finally {
        clearTimeout(timer);
        if (current === request) current = null;
      }
    })();
    return request.done;
  };

  return { load, cancel };
}

/** Settle when `work` does or when `signal` aborts, whichever comes first, so
 *  a read that ignores its signal is still bounded. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Queue read aborted'));
      return;
    }
    const onAbort = () => reject(new Error('Queue read aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** Two feeds behind one Refresh (the Team inbox): offline wins, then a
 *  refresh still running, then a failure. */
export function combineQueueStatus(...statuses: QueueLoadStatus[]): QueueLoadStatus {
  for (const s of ['offline', 'refreshing', 'failed'] as const) {
    if (statuses.includes(s)) return s;
  }
  return 'ready';
}

/** One read of /api/messaging/queue. Anything that is not a queue throws,
 *  so a broken or unconfigured feed can never become an empty inbox. */
export async function readQueue<T extends { id: string }, C>(
  url: string,
  signal: AbortSignal,
): Promise<{ approvals: T[]; context?: C }> {
  const res = await fetch(url, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`Queue feed answered ${res.status}`);
  const data: unknown = await res.json();
  if (!isQueuePayload(data)) throw new Error('Queue feed did not send a queue');
  return data as { approvals: T[]; context?: C };
}

function isQueuePayload(data: unknown): data is { approvals: { id: string }[] } {
  if (!data || typeof data !== 'object') return false;
  const approvals = (data as { approvals?: unknown }).approvals;
  return (
    Array.isArray(approvals) &&
    approvals.every((a) => !!a && typeof a === 'object' && typeof (a as { id?: unknown }).id === 'string')
  );
}
