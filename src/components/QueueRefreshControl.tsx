'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import type { QueueLoadStatus } from '@/lib/queue-loader';

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

/** Refresh, and nothing else while the feed is healthy: the queue refreshes
 *  itself every few seconds, so an "Updated Xs ago" stamp beside it was a
 *  second clock to read (cut 2026-10-19). It speaks only when something is
 *  wrong: "Refresh failed · Retry" when the last read did not come back (the
 *  cards on screen are the last good ones), "Offline" when the browser has no
 *  connection (it reads again on reconnect). The button shows its pending
 *  state while a refresh someone asked for runs. */
export function QueueRefreshControl({
  onRefresh,
  status = 'ready',
}: {
  onRefresh: () => void;
  status?: QueueLoadStatus;
}) {
  const failed = status === 'failed';
  const problem = status === 'offline' ? 'Offline' : failed ? 'Refresh failed' : '';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      {/* Mounted while healthy too, empty, so a screen reader hears the
          change when the feed fails. */}
      <span
        role="status"
        style={{
          fontSize: 10,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          fontWeight: 600,
          color: 'var(--signal)',
          marginRight: failed ? 10 : 0,
        }}
      >
        {problem}
        {failed && <span aria-hidden="true">{' ·'}</span>}
      </span>
      {status !== 'offline' && (
        <Button
          variant="secondary"
          size="sm"
          // Called bare: the click event is not an argument to pass on. A
          // callback that takes one (ApprovalQueue's onResolved) would read
          // it as a notice to print.
          onClick={() => onRefresh()}
          pending={status === 'refreshing'}
          pendingLabel="Refreshing"
          // The read has its own 20s deadline (queue-loader.ts); the
          // watchdog's reload would only throw away a half-typed reply.
          watchdog={false}
        >
          {failed ? 'Retry' : 'Refresh'}
        </Button>
      )}
    </span>
  );
}
