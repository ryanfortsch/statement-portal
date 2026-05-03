'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * Inline button that triggers /api/sync-comms-quo and refreshes the page
 * to surface any newly upserted comms. Lives on the property detail page
 * next to the Recent Comms header.
 */
export function SyncCommsButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/sync-comms-quo?days=60', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? `${res.status}`);
        return;
      }
      setResult(`${json.messages_upserted} new · ${json.conversations_matched} threads`);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'sync failed');
    }
  }

  return (
    <div className="flex items-center gap-3">
      {error && <span style={{ fontSize: 11, color: 'var(--negative, #c85a3a)' }}>{error}</span>}
      {result && !error && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{result}</span>}
      <button
        type="button"
        onClick={run}
        disabled={pending}
        style={{
          fontSize: 10,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-4)',
          background: 'none',
          border: '1px solid var(--rule)',
          cursor: pending ? 'wait' : 'pointer',
          padding: '4px 10px',
          opacity: pending ? 0.6 : 1,
          whiteSpace: 'nowrap',
        }}
      >
        {pending ? 'Syncing…' : 'Sync Quo'}
      </button>
    </div>
  );
}
