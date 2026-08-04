'use client';

import { useEffect } from 'react';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { reloadedForNewDeployment } from '@/lib/version-skew';

/**
 * Quiet live-ness for a force-dynamic server page: re-fetches the RSC payload
 * on an interval (default 20s) so the view tracks reality without websockets.
 * Skips ticks while the tab is hidden and catches up the moment it's visible
 * again. Each tick first checks /api/version for a new deployment and
 * hard-reloads (once) instead of refreshing when one landed, so a stale
 * bundle never asks the new build for an RSC payload it can't render.
 * Renders nothing. Mount only while there's something live to watch
 * (an in-flight packet), so idle pages don't poll.
 */
export function AutoRefresh({ intervalMs = 20000 }: { intervalMs?: number }) {
  const softRefresh = useSoftRefresh();
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (document.hidden) return;
      if (await reloadedForNewDeployment()) return;
      // Re-check both gates: the version probe awaited, and meanwhile the
      // tab may have hidden or this component unmounted.
      if (!cancelled && !document.hidden) softRefresh();
    };
    const t = setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [softRefresh, intervalMs]);
  return null;
}
