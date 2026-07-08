'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Small count pill on a Messaging sub-tab (Guests / Owners) so the operator
 * can see WHICH queue has drafts waiting, not just that something does. The
 * masthead badge shows the combined total; this splits it onto the right tab
 * (e.g. an owner message waiting flags the Owners tab).
 *
 * Reads the same /api/messaging/pending-count endpoint the masthead badge uses
 * (it already returns guests + owners separately) and renders nothing when its
 * category is at zero. Reconciles on route change / tab focus for the same
 * reason the masthead badge does: this lives in a persistent strip and a plain
 * interval can otherwise sit stale.
 */
export function MessagingTabCount({ category }: { category: 'guests' | 'owners' | 'cleaners' | 'contractors' }) {
  const [count, setCount] = useState<number | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/messaging/pending-count', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { guests?: number; owners?: number; cleaners?: number; contractors?: number };
        const n =
          category === 'guests' ? data.guests :
          category === 'owners' ? data.owners :
          category === 'cleaners' ? data.cleaners :
          data.contractors;
        if (!cancelled) setCount(typeof n === 'number' ? n : 0);
      } catch {
        // Silent: a network hiccup shouldn't surface as a tab error.
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
