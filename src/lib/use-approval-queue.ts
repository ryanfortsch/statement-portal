'use client';

import { invalidatePendingCounts } from '@/lib/pending-count-client';
import {
  createQueueLoader,
  readQueue,
  type QueueLoader,
  type QueueLoadMode,
  type QueueLoadStatus,
} from '@/lib/queue-loader';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

/** Which queue this hook is feeding. Mirrors the four messaging surfaces. */
export type QueueAudience = 'guests' | 'owners' | 'cleaners' | 'contractors';

/** Normal cadence: the same 15s the pages used to refresh on. */
const POLL_MS = 15_000;
/** While a coached card is being rewritten upstream, watch for its
 * replacement closely. The regen itself takes ~6s (context gather + the
 * model); a 15s poll turned that into a 15-30s stare at "Regenerating". */
const WATCH_POLL_MS = 2_000;
/** Stop waiting on a rewrite that never arrives. A regen that throws upstream
 * leaves the original card pending, and without this the button reads
 * "Regenerating" until the page is reloaded. Four minutes clears the real tail
 * (p90 is 23s; the slowest 2% of completions run past three minutes), so
 * hitting this means the rewrite failed rather than that it is slow. The card
 * still picks up a late arrival on the normal cadence. */
const WATCH_GIVE_UP_MS = 240_000;

type QueueState<T, C> = {
  /** The cards to render. Seeded from the server render, owned by this hook
   * after its first successful poll. */
  approvals: T[];
  /** Audience sidecar the feed carries beside the cards: the contractor queue
   * ships each card's Field context (the run that narrows its property
   * dropdown), which is keyed by approval id and so has to travel with a
   * rewritten card rather than wait for the next page render. */
  context: C | undefined;
  /** How the feed is doing, for the queue's Refresh control: 'refreshing'
   *  while a refresh someone asked for runs, 'failed' when the last read did
   *  not come back (the cards on screen are the last good ones), 'offline'
   *  while the browser has no connection. Background polls stay quiet. */
  refreshStatus: QueueLoadStatus;
  /** Fetch now (a card action just changed the queue, or someone clicked
   *  Refresh). Supersedes a read in flight. */
  refresh: () => void;
  /** Watch for `id` to be replaced by its coached rewrite. */
  watchRegen: (id: string) => void;
  /** The watched card whose rewrite never came back. */
  stalledId: string | null;
};

/**
 * A messaging queue's own data loop, polling /api/messaging/queue instead of
 * re-rendering the whole route it sits on.
 *
 * The four queue pages each render several sections, and a card used to clear
 * only when a full router.refresh brought the list back down. That tied the
 * cards to the slowest thing on the page (on /messaging, a conversations
 * rebuild that runs ~35s cold), so a coached card could read "Regenerating"
 * minutes after the service had finished. Coaching is the sharp edge because
 * the service answers 202 and rewrites in the background: nothing is different
 * until the replacement card exists under a new id.
 *
 * Hidden tabs skip ticks and the period is jittered, same as the page-level
 * refresh it replaces (#1236): several open tabs must not poll in lockstep.
 *
 * Each read goes through createQueueLoader (src/lib/queue-loader.ts): it
 * gives up after 20 seconds, only the newest request may replace the cards,
 * and a failure keeps the last good cards and says so in refreshStatus.
 */
export function useApprovalQueue<T extends { id: string; status?: string }, C = undefined>(
  initial: T[],
  audience: QueueAudience,
  initialContext?: C,
): QueueState<T, C> {
  const [approvals, setApprovals] = useState<T[]>(initial);
  const countRevision = JSON.stringify(approvals.map(a => [a.id, a.status]).sort());
  useEffect(() => { invalidatePendingCounts(); }, [audience, countRevision]);
  const [context, setContext] = useState<C | undefined>(initialContext);
  const [stalledId, setStalledId] = useState<string | null>(null);
  // Bumping this restarts the polling loop, which is how a fresh watch gets
  // its first close-cadence tick without waiting out the pending timer.
  const [watchSeq, setWatchSeq] = useState(0);
  const watchRef = useRef<{ id: string; until: number } | null>(null);
  // Once our own feed has answered, it is the source of truth: a later page
  // render can carry an older list (it started before our last poll), and
  // adopting it would flash a resolved card back into the queue.
  const ownsDataRef = useRef(false);
  const [loadStatus, setLoadStatus] = useState<QueueLoadStatus>('ready');
  const online = useOnline();
  const loaderRef = useRef<QueueLoader | null>(null);

  useEffect(() => {
    if (ownsDataRef.current) return;
    setApprovals(initial);
    setContext(initialContext);
  }, [initial, initialContext]);

  useEffect(() => {
    const loader = createQueueLoader<{ approvals: T[]; context?: C }>({
      read: (signal) => readQueue<T, C>(`/api/messaging/queue?audience=${audience}`, signal),
      status: setLoadStatus,
      accept: (data) => {
        ownsDataRef.current = true;
        setApprovals(data.approvals);
        if (data.context !== undefined) setContext(data.context);
        const watch = watchRef.current;
        // The coached card is gone: its rewrite is live under a new id, and
        // the card unmounts on this same state update.
        if (watch && !data.approvals.some((a) => a.id === watch.id)) {
          watchRef.current = null;
        }
      },
    });
    loaderRef.current = loader;
    // A read in flight when the connection drops can only fail; drop it
    // quietly (the control says Offline) and read again on reconnect.
    const onOffline = () => loader.cancel();
    const onOnline = () => void loader.load('now');
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      loader.cancel();
      if (loaderRef.current === loader) loaderRef.current = null;
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [audience]);

  const load = useCallback((mode: QueueLoadMode = 'poll'): Promise<void> => {
    // Offline: nothing to read. The control already says Offline, and the
    // reconnect reads at once.
    if (!navigator.onLine) return Promise.resolve();
    return loaderRef.current?.load(mode) ?? Promise.resolve();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const nextDelay = () =>
      watchRef.current
        ? WATCH_POLL_MS
        : Math.round(POLL_MS * (0.8 + Math.random() * 0.4));

    const run = async () => {
      const watch = watchRef.current;
      if (watch && Date.now() > watch.until) {
        watchRef.current = null;
        setStalledId(watch.id);
      }
      if (!document.hidden) await load();
      if (cancelled) return;
      timer = window.setTimeout(run, nextDelay());
    };

    timer = window.setTimeout(run, nextDelay());
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load, watchSeq]);

  const refresh = useCallback(() => {
    void load('now');
  }, [load]);

  const watchRegen = useCallback((id: string) => {
    watchRef.current = { id, until: Date.now() + WATCH_GIVE_UP_MS };
    setStalledId((cur) => (cur === id ? null : cur));
    setWatchSeq((n) => n + 1);
  }, []);

  return {
    approvals,
    context,
    refreshStatus: online ? loadStatus : 'offline',
    refresh,
    watchRegen,
    stalledId,
  };
}

/** navigator.onLine as state. The server snapshot is online, so the first
 *  render matches the server's and an offline tab corrects on hydration. */
function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, readOnline, readOnlineOnServer);
}

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

const readOnline = () => navigator.onLine;
const readOnlineOnServer = () => true;
