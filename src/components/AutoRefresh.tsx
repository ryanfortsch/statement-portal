'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Quiet live-ness for a force-dynamic server page: re-fetches the RSC payload
 * on an interval (default 20s) so the view tracks reality without websockets.
 * Skips ticks while the tab is hidden and catches up the moment it's visible
 * again. Renders nothing. Mount only while there's something live to watch
 * (an in-flight packet), so idle pages don't poll.
 */
export function AutoRefresh({ intervalMs = 20000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (!document.hidden) router.refresh();
    };
    const t = setInterval(tick, intervalMs);
    const onVisible = () => {
      if (!document.hidden) router.refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [router, intervalMs]);
  return null;
}
