'use client';

import { useEffect } from 'react';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { hasUnsavedWork } from '@/lib/unsaved-work';

/**
 * Quiet live-ness for a force-dynamic server page: re-fetches the RSC payload
 * on an interval (default 20s) so the view tracks reality without websockets.
 * Skips ticks while the tab is hidden and catches up the moment it's visible
 * again. Also skips while the page holds unsaved typing: a tab past Skew
 * Protection's 12 hours that refreshes into a newer deployment is hard-reloaded
 * by Next's deploymentId check, and that reload must not take the typing with
 * it. Renders nothing. Mount only while there's something live to watch
 * (an in-flight packet), so idle pages don't poll.
 */
export function AutoRefresh({ intervalMs = 20000 }: { intervalMs?: number }) {
  const softRefresh = useSoftRefresh();
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled || document.hidden || hasUnsavedWork()) return;
      softRefresh();
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
