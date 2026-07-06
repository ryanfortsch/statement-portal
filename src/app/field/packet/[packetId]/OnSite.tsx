'use client';

import { useEffect, useState } from 'react';

function fmtMin(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return '<1 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/**
 * Time-at-property. When `live` (the inspector is still inside) it ticks every
 * 30s; otherwise it renders a fixed duration. `now` is resolved client-side only
 * so the ticking value never causes an SSR/hydration mismatch.
 */
export function OnSite({ startIso, endIso, live }: { startIso: string; endIso: string | null; live: boolean }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [live]);

  const start = new Date(startIso).getTime();
  if (live) {
    if (now == null) return <>on site now</>;
    return <>on site · {fmtMin(now - start)}</>;
  }
  const end = endIso ? new Date(endIso).getTime() : start;
  return <>{fmtMin(end - start)} on site</>;
}
