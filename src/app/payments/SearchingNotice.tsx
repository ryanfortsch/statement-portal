'use client';

import { useEffect, useState } from 'react';

/**
 * What the page shows while Stripe is read: which accounts, how long it has
 * been, and a moving bar, so a two-minute scan reads as work in progress
 * rather than a stuck page. Counts seconds from when it first painted.
 */
export function SearchingNotice({ accounts }: { accounts: number }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const t = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div role="status" aria-live="polite" style={{ margin: '28px 0 14px' }}>
      <div className="eyebrow" style={{ color: 'var(--ink-3)' }}>
        Searching {accounts} Stripe account{accounts === 1 ? '' : 's'}
        {seconds > 0 ? ` · ${seconds}s` : ''}
        {accounts > 1 ? ' · can take up to two minutes' : ''}
      </div>
      <div style={{ marginTop: 10, height: 3, background: 'var(--rule)', overflow: 'hidden', position: 'relative', maxWidth: 420 }}>
        <div className="rt-lookup-progress" style={{ position: 'absolute', top: 0, bottom: 0, width: '30%', background: 'var(--signal)' }} />
      </div>
      <style>{`
        @keyframes rt-lookup-slide { from { left: -30%; } to { left: 100%; } }
        .rt-lookup-progress { animation: rt-lookup-slide 1.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .rt-lookup-progress { animation: none; left: 0; width: 100%; opacity: .4; } }
      `}</style>
    </div>
  );
}
