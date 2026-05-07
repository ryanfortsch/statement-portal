'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type Report = {
  competitorId: string;
  ok: boolean;
  error?: string;
  scraped: number;
  added: number;
  dropped: number;
  returned: number;
  unchanged: number;
  seeded: boolean;
};

/**
 * Manual trigger for /api/cron/sync-competitors. Useful for both: testing
 * the scraper after a code change, and forcing a fresh diff if Dotti
 * notices a new listing on a competitor's site mid-week.
 */
export function SyncNowButton() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<Report[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function onClick() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/cron/sync-competitors', {
          method: 'POST',
          headers: { 'x-helm-manual-sync': '1' },
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          throw new Error(json.error ?? `HTTP ${res.status}`);
        }
        setResult(json.reports as Report[]);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        style={{
          fontSize: 11,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          fontWeight: 600,
          padding: '8px 14px',
          background: isPending ? 'var(--paper-2)' : 'var(--ink)',
          color: isPending ? 'var(--ink-3)' : 'var(--paper)',
          border: '1px solid var(--ink)',
          cursor: isPending ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {isPending ? 'Syncing…' : 'Sync inventory now'}
      </button>

      {result && (
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          {result
            .map((r) => {
              if (r.seeded) return `${r.competitorId}: seeded ${r.unchanged}`;
              if (!r.ok) return `${r.competitorId}: ${r.error}`;
              const summary = [
                r.added && `+${r.added}`,
                r.dropped && `−${r.dropped}`,
                r.returned && `↩${r.returned}`,
              ]
                .filter(Boolean)
                .join(' · ');
              return `${r.competitorId}: ${summary || 'no changes'}`;
            })
            .join(' · ')}
        </span>
      )}

      {error && (
        <span style={{ fontSize: 12, color: 'var(--negative)' }}>
          {error}
        </span>
      )}
    </div>
  );
}
