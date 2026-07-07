'use client';

import { useEffect, useRef, useState } from 'react';
import { useSoftRefresh } from '@/lib/use-soft-refresh';

type Props = {
  shouldRefresh: boolean;
  initialLabel: string;
};

/**
 * Background sync trigger. When the page renders with stale data
 * (`shouldRefresh=true`), this component POSTs to /api/sync-guesty after
 * mount, then calls softRefresh() so the server component re-runs with
 * the fresh data. The page paints immediately while this work is in flight.
 *
 * Idempotent within a session via `sessionStorage`: if a refresh just ran in
 * this tab, we don't fire another one even if React 18 strict-mode mounts the
 * effect twice.
 */
export function AutoRefresh({ shouldRefresh, initialLabel }: Props) {
  const softRefresh = useSoftRefresh();
  const [status, setStatus] = useState<'idle' | 'syncing' | 'done' | 'error'>(
    shouldRefresh ? 'syncing' : 'idle',
  );
  const fired = useRef(false);

  useEffect(() => {
    if (!shouldRefresh || fired.current) return;
    const lastFired = Number(sessionStorage.getItem('revenue-sync-fired-at') || 0);
    if (Date.now() - lastFired < 60_000) {
      // Already kicked off a sync recently in this session; skip.
      setStatus('idle');
      return;
    }
    fired.current = true;
    sessionStorage.setItem('revenue-sync-fired-at', String(Date.now()));

    (async () => {
      try {
        const res = await fetch('/api/sync-guesty', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshMap: false }),
        });
        if (!res.ok) {
          setStatus('error');
          return;
        }
        setStatus('done');
        softRefresh();
      } catch {
        setStatus('error');
      }
    })();
  }, [shouldRefresh, softRefresh]);

  let label = initialLabel;
  if (status === 'syncing') label = 'Refreshing from Guesty...';
  else if (status === 'error') label = `${initialLabel} (refresh failed)`;
  else if (status === 'done') label = 'Just synced';

  return <span>{label}</span>;
}
