'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Manual trigger for /api/sync-quo. Webhooks are the live path; this is
 * a backfill for cold start or when a webhook delivery was missed.
 * Pulls the last 14 days of messages + calls per known contact phone +
 * cleaner phone, dispatching through the same persistence pipeline as
 * the webhook handler.
 */
export function SyncQuoButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function sync() {
    if (pending) return;
    setPending(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch('/api/sync-quo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ days: 14 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.error || `Failed (${res.status})`);
        return;
      }
      const s = data.summary ?? {};
      const inserted = Number(s.messages_inserted ?? 0) + Number(s.calls_inserted ?? 0);
      const cleanings = Number(s.cleaning_completions_inserted ?? 0);
      const fragments: string[] = [];
      if (inserted > 0) fragments.push(`${inserted} new ${inserted === 1 ? 'touch' : 'touches'}`);
      if (cleanings > 0) fragments.push(`${cleanings} cleaning ${cleanings === 1 ? 'signal' : 'signals'}`);
      setResult(
        fragments.length > 0
          ? `Captured ${fragments.join(', ')}.`
          : `No new activity from Quo (last 14 days).`,
      );
      if (inserted > 0 || cleanings > 0) router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
      <button
        type="button"
        onClick={sync}
        disabled={pending}
        title="Pull recent Quo (OpenPhone) messages + calls and log them as touches"
        style={{
          background: 'transparent',
          border: '1px solid var(--rule)',
          color: 'var(--ink-3)',
          padding: '8px 14px',
          fontSize: 11,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          fontWeight: 500,
          cursor: pending ? 'wait' : 'pointer',
          opacity: pending ? 0.6 : 1,
        }}
      >
        {pending ? 'Syncing…' : 'Sync Quo'}
      </button>
      {(result || err) && (
        <div
          style={{
            fontSize: 11,
            color: err ? 'var(--negative)' : 'var(--ink-4)',
            maxWidth: 320,
            textAlign: 'right',
          }}
        >
          {err ?? result}
        </div>
      )}
    </div>
  );
}
