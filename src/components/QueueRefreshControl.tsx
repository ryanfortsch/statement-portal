'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { QueueLoadStatus } from '@/lib/queue-loader';

/** Refresh secondary page sections without unmounting the current UI.
 * Queue freshness comes from its independent JSON feed, never this dispatch. */
export function useQueueRefresh(baseMs = 15_000): {
  softRefresh: () => void;
} {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const softRefresh = useCallback(() => {
    startTransition(() => router.refresh());
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

  return { softRefresh };
}

export function QueueRefreshControl({
  onRefresh,
  refreshTick,
  status,
}: {
  onRefresh: () => void;
  refreshTick: number;
  status: QueueLoadStatus;
}) {
  // Wall-clock age continues across sleeping/background tabs. Only successful
  // feed responses change refreshTick; failures retain the last good timestamp.
  const [age, setAge] = useState({ tick: refreshTick, seconds: 0 });
  const seconds = age.tick === refreshTick ? age.seconds : 0;
  useEffect(() => {
    const receivedAt = Date.now();
    const t = setInterval(() => setAge({ tick: refreshTick, seconds: Math.floor((Date.now() - receivedAt) / 1000) }), 1_000);
    return () => clearInterval(t);
  }, [refreshTick]);
  const label = seconds < 5 ? 'just now' : seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)} min ago`;
  const problem = status === 'failed' || status === 'offline';
  const stateLabel = status === 'offline' ? 'Offline' : status === 'failed' ? 'Refresh failed' : status === 'refreshing' ? 'Refreshing…' : '';
  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={status === 'refreshing' || status === 'offline'}
      title={problem ? 'Showing the last loaded queue. Existing cards and edits are kept.' : 'Refresh this queue. It also checks automatically while this tab is visible.'}
      style={{
        fontSize: 10,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        fontWeight: 500,
        color: problem ? 'var(--signal)' : 'var(--ink-3)',
        background: 'transparent',
        border: '1px solid var(--rule)',
        padding: '6px 10px',
        cursor: status === 'refreshing' || status === 'offline' ? 'default' : 'pointer',
      }}
    >
      {stateLabel && <span role="status">{stateLabel} · </span>}
      Updated {label}{status === 'refreshing' || status === 'offline' ? '' : problem ? ' · Retry' : ' · Refresh'}
    </button>
  );
}
