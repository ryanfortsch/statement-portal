'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Small pill rendered next to the Messaging tab in the masthead nav when
 * there are pending guest-message drafts. Polls /api/messaging/pending-count
 * so Dotti sees, from any module, when something needs her attention.
 *
 * Renders nothing when count is 0 or the fetch failed (kept silent rather
 * than showing an error chip in the nav — that'd be more noise than signal).
 *
 * Reconciles aggressively: this badge lives in the persistent masthead, so
 * a plain interval can freeze at a stale count — a background tab throttles
 * the timer, and client-side navigation never remounts the component. So we
 * also re-fetch on every route change (pathname dep) and whenever the tab
 * regains focus, which is what keeps it from sitting at a wrong number after
 * the queue has actually cleared.
 */
export function MessagingPendingBadge() {
  const [count, setCount] = useState<number | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/messaging/pending-count', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { count?: number };
        if (!cancelled) setCount(typeof data.count === 'number' ? data.count : 0);
      } catch {
        // Silent: a network hiccup shouldn't surface as a nav badge error.
      }
    };
    load();
    const t = setInterval(load, 30_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', load);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', load);
    };
  }, [pathname]);

  if (!count || count <= 0) return null;

  return (
    <span
      aria-label={`${count} draft${count === 1 ? '' : 's'} waiting`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 6,
        minWidth: 16,
        height: 16,
        padding: '0 5px',
        borderRadius: 8,
        background: 'var(--signal)',
        color: 'var(--paper)',
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: 0,
        lineHeight: 1,
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
