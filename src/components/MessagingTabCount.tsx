'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { fetchPendingCounts, jitteredInterval, subscribePendingCounts } from '@/lib/pending-count-client';

/**
 * Audience-specific pending count. The masthead signals guest drafts only;
 * these pills identify pending work in each audience, including the visible
 * schedule digest for Cleaners. Scheduled sends do not need approval.
 * Polling and confirmed queue changes reconcile through the shared fetcher.
 */
export function MessagingTabCount({ category }: { category: 'guests' | 'owners' | 'cleaners' | 'contractors' }) {
  const [count, setCount] = useState<number | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      // Deduped across the badge + all four tab pills (and TTL'd), so a tab
      // makes one request per window instead of five.
      const data = await fetchPendingCounts();
      if (!data) return;
      const n =
        category === 'guests' ? data.guests :
        category === 'owners' ? data.owners :
        category === 'cleaners' ? data.cleaners :
        data.contractors;
      if (!cancelled && typeof n === 'number') setCount(n);
    };
    load();
    // Hidden tabs skip their ticks (the visibilitychange listener below
    // catches them up the moment they're fronted); the jittered period keeps
    // several open tabs from polling in lockstep.
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
  }, [pathname, category]);

  if (!count || count <= 0) return null;

  // Per-category badge color so the operator can read the tab strip at a
  // glance — guests/owners/cleaners are different conversational threads
  // and deserve visually distinct chips. All colors are dark enough that
  // var(--paper) text reads cleanly on top.
  const background =
    category === 'guests' ? 'var(--ink)' :              // navy — brand default
    category === 'owners' ? 'var(--signal)' :           // gold — established
    category === 'cleaners' ? '#1f5e6b' :               // teal — cleaners
    '#7a5c3a';                                          // warm brown — contractors

  return (
    <span
      title={`${count} ${category === 'cleaners' ? 'items' : 'drafts'} awaiting review`}
      aria-label={`${count} ${category === 'cleaners' ? 'items' : 'drafts'} awaiting review`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 6,
        minWidth: 16,
        height: 16,
        padding: '0 5px',
        borderRadius: 8,
        background,
        color: 'var(--paper)',
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: 0,
        lineHeight: 1,
        verticalAlign: 'middle',
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
