'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * One shared refresh brain for the four messaging queues (guests, owners,
 * cleaners, contractors), which each carried an identical copy of the same
 * confusing header: a "refreshes every 15s" eyebrow beside a chip whose
 * timer only reset on remount, so it could read "Refresh · 1 min ago" next
 * to a 15-second promise (Dotti, 2026-08-20). Now there is ONE control,
 * "Updated Xs ago · Refresh", and its timer resets on every actual refresh:
 * interval-fired, visibility catch-up, a card action, or a click.
 *
 * The interval skips ticks while the tab is hidden (each tick is a full
 * server render; hidden tabs polling in wall-clock lockstep is the burst
 * that gets requests shed on Hobby and trips the error boundary, #1236)
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

export function QueueRefreshControl({
  onRefresh,
  refreshTick,
}: {
  onRefresh: () => void;
  refreshTick: number;
}) {
  // Seconds since the LAST refresh, not since mount: the tick prop bumps on
  // every refresh, and this effect restarts the counter from zero.
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    setSeconds(0);
    const t = setInterval(() => setSeconds((s) => s + 1), 1_000);
    return () => clearInterval(t);
  }, [refreshTick]);
  const label =
    seconds < 5 ? 'just now' : seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)} min ago`;
  return (
    <button
      type="button"
      onClick={onRefresh}
      title="The queue also refreshes itself every few seconds while this tab is visible."
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
      Updated {label} · Refresh
    </button>
  );
}
