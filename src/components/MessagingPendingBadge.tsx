'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { fetchPendingCounts, jitteredInterval, subscribePendingCounts } from '@/lib/pending-count-client';

/**
 * Small pill rendered next to the Messaging tab in the masthead nav when
 * there are unanswered GUEST drafts. Polls /api/messaging/pending-count so
 * Dotti sees, from any module, when a guest needs attention.
 *
 * Deliberately GUESTS ONLY: owners and cleaners/contractors each have their
 * own per-tab badge inside the Messaging section, but this top-nav badge
 * (next to Work) is the fleet-wide "a guest is waiting" signal, so it reads
 * data.guests, not the combined count.
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
export function MessagingPendingBadge({ href }: { href?: string }) {
  const [count, setCount] = useState<number | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      // Deduped + TTL'd with the sub-tab pills via pending-count-client.
      const data = await fetchPendingCounts();
      if (!data) return;
      if (!cancelled && typeof data.guests === 'number') setCount(data.guests);
    };
    load();
    // Hidden tabs skip ticks; jitter desynchronizes multiple open tabs.
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, jitteredInterval(30_000));
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', load);
    const unsubscribe = subscribePendingCounts(load);
    return () => {
      cancelled = true;
      unsubscribe();
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', load);
    };
  }, [pathname]);

  if (!count || count <= 0) return null;

  const pill = (
    <span
      title={`${count} guest draft${count === 1 ? '' : 's'} awaiting review`}
      aria-label={`${count} guest draft${count === 1 ? '' : 's'} awaiting review`}
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
  return href ? <Link href={href} style={{ textDecoration: 'none' }} aria-label={`${count} guest drafts awaiting review`}>{pill}</Link> : pill;
}
