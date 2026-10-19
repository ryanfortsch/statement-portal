'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * One shared refresh brain for the four messaging queues (guests, owners,
 * cleaners, contractors), which each carried an identical copy of the same
 * confusing header: a "refreshes every 15s" eyebrow beside a chip whose
 * timer only reset on remount (Dotti, 2026-08-20). Now there is ONE quiet
 * Refresh button; the hook below refreshes on its own interval, on
 * visibility catch-up and after a card action.
 *
 * The interval skips ticks while the tab is hidden (each tick is a full
 * server render; hidden tabs polling in wall-clock lockstep is the burst
 * that gets requests shed under load and trips the error boundary, #1236)
 * and runs on a jittered period so several open tabs drift apart. The
 * refresh runs inside a transition so Suspense keeps the current UI (and
 * any half-typed form) mounted while the new payload streams.
 */
export function useQueueRefresh(baseMs = 15_000): {
  softRefresh: () => void;
  refreshTick: number;
} {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [refreshTick, setRefreshTick] = useState(0);
  const softRefresh = useCallback(() => {
    startTransition(() => router.refresh());
    setRefreshTick((t) => t + 1);
  }, [router]);

  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) softRefresh();
    }, Math.round(baseMs * (0.8 + Math.random() * 0.4)));
    const onVisible = () => {
      if (document.visibilityState === 'visible') softRefresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [softRefresh, baseMs]);

  return { softRefresh, refreshTick };
}

/** Refresh, and nothing else: the queue refreshes itself every few seconds,
 *  so an "Updated Xs ago" stamp beside it was a second clock to read
 *  (cut 2026-10-19). */
export function QueueRefreshControl({ onRefresh }: { onRefresh: () => void }) {
  return (
    <button
      type="button"
      onClick={onRefresh}
      className="rt-queue-refresh"
      style={{
        fontSize: 10,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        fontWeight: 500,
        color: 'var(--ink-3)',
        background: 'transparent',
        border: '1px solid var(--rule)',
        padding: '6px 10px',
        cursor: 'pointer',
      }}
    >
      Refresh
    </button>
  );
}
