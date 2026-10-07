'use client';

import { useRef, useState } from 'react';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { summarizeManualSync } from '@/lib/manual-sync-result';

/**
 * Manual trigger for /api/sync-quo. Webhooks are the live path; this is
 * a backfill for cold start or when a webhook delivery was missed.
 * Pulls the last 14 days of messages + calls per known contact phone +
 * cleaner phone, dispatching through the same persistence pipeline as
 * the webhook handler.
 */
export function SyncQuoButton() {
  const softRefresh = useSoftRefresh();
  const lock = useRef(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useUnsavedWorkGuard(pending);

  async function sync() {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch('/api/sync-quo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ days: 14 }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErr(typeof data?.error === 'string' ? data.error : `Failed (${res.status})`);
        return;
      }
      const s = data.summary ?? {};
      const summary = summarizeManualSync('quo', data);
      if (summary.warning) setErr(summary.message);
      else setResult(summary.message);
      if (summary.refresh) softRefresh();
    } catch {
      setErr('Could not confirm the sync result. Check the latest activity before retrying.');
    } finally {
      lock.current = false;
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
          role={err ? 'alert' : 'status'}
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
