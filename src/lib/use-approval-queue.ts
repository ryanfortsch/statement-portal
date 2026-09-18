'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

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
  /** Bumps on every successful load, so "Updated Xs ago" counts from data
   * that actually arrived rather than from a refresh we merely dispatched. */
  updatedTick: number;
  /** Fetch now (a card action just changed the queue). */
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
 */
export function useApprovalQueue<T extends { id: string }, C = undefined>(
  initial: T[],
  audience: QueueAudience,
  initialContext?: C,
): QueueState<T, C> {
  const [approvals, setApprovals] = useState<T[]>(initial);
  const [context, setContext] = useState<C | undefined>(initialContext);
  const [updatedTick, setUpdatedTick] = useState(0);
  const [stalledId, setStalledId] = useState<string | null>(null);
  // Bumping this restarts the polling loop, which is how a fresh watch gets
  // its first close-cadence tick without waiting out the pending timer.
  const [watchSeq, setWatchSeq] = useState(0);
  const watchRef = useRef<{ id: string; until: number } | null>(null);
  // Once our own feed has answered, it is the source of truth: a later page
  // render can carry an older list (it started before our last poll), and
  // adopting it would flash a resolved card back into the queue.
  const ownsDataRef = useRef(false);

  useEffect(() => {
    if (ownsDataRef.current) return;
    setApprovals(initial);
    setContext(initialContext);
  }, [initial, initialContext]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/messaging/queue?audience=${audience}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { approvals?: T[]; context?: C };
      if (!Array.isArray(data.approvals)) return;
      ownsDataRef.current = true;
      setApprovals(data.approvals);
      if (data.context !== undefined) setContext(data.context);
      setUpdatedTick((t) => t + 1);
      const watch = watchRef.current;
      // The coached card is gone: its rewrite is live under a new id, and the
      // card unmounts on this same state update.
      if (watch && !data.approvals.some((a) => a.id === watch.id)) {
        watchRef.current = null;
      }
    } catch {
      // Keep the last good queue on the screen. The header chip keeps
      // counting, so a feed that has gone quiet reads as stale rather than
      // blanking the operator's work.
    }
  }, [audience]);

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
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load, watchSeq]);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  const watchRegen = useCallback((id: string) => {
    watchRef.current = { id, until: Date.now() + WATCH_GIVE_UP_MS };
    setStalledId((cur) => (cur === id ? null : cur));
    setWatchSeq((n) => n + 1);
  }, []);

  return { approvals, context, updatedTick, refresh, watchRegen, stalledId };
}
