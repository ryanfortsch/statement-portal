'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { jitteredInterval } from '@/lib/pending-count-client';

/**
 * Queue-pressure pill on a nav sub-tab (WorkTabs' Field, FinancialsTabs'
 * Statements), cloned from MessagingTabCount: same markup and size, same
 * poll/reconcile rhythm, renders nothing at zero.
 *
 * Reads /api/nav-counts, which returns every nav count in one payload; the
 * module-level cache below collapses all mounted pills (and any future ones)
 * into a single request per tab per TTL window, same as the messaging pills'
 * shared fetcher.
 */

type NavCounts = {
  fieldPackets?: number;
  statementsReview?: number;
};

const TTL_MS = 10_000;

let cached: NavCounts | null = null;
let cachedAt = 0;
let inFlight: Promise<NavCounts | null> | null = null;

function fetchNavCounts(): Promise<NavCounts | null> {
  if (cached && Date.now() - cachedAt < TTL_MS) return Promise.resolve(cached);
  if (inFlight) return inFlight;
  inFlight = fetch('/api/nav-counts', { cache: 'no-store' })
    .then(async (res) => {
      if (!res.ok) return null;
      const data = (await res.json()) as NavCounts;
      cached = data;
      cachedAt = Date.now();
      return data;
    })
    .catch(() => null)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function NavTabCount({ kind }: { kind: 'fieldPackets' | 'statementsReview' }) {
  const [count, setCount] = useState<number | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const data = await fetchNavCounts();
      if (!data) return;
      const n = kind === 'fieldPackets' ? data.fieldPackets : data.statementsReview;
      if (!cancelled) setCount(typeof n === 'number' ? n : 0);
    };
    load();
    // Hidden tabs skip their ticks (visibilitychange catches them up when
    // fronted); jitter keeps several open tabs from polling in lockstep.
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, jitteredInterval(30_000));
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
  }, [pathname, kind]);

  if (!count || count <= 0) return null;

  // Section tints: the Field pill carries the section ink, the Statements
  // pill the signal accent, so each strip reads in its own register while
  // matching the messaging pills' shape.
  const background = kind === 'fieldPackets' ? 'var(--ink)' : 'var(--signal)';

  return (
    <span
      aria-label={`${count} item${count === 1 ? '' : 's'} awaiting review`}
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
