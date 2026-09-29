'use client';

import { useRef, useState } from 'react';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { summarizeManualSync } from '@/lib/manual-sync-result';

/**
 * Manual trigger for /api/cron/sync-gmail-replies. The cron also runs
 * hourly; this exists so an operator who just sent a draft and wants
 * to capture the reply immediately can poll on demand.
 *
 * Sends an x-helm-manual-sync header so the route accepts the call
 * without the CRON_SECRET (the user's signed-in cookie is implicit
 * trust here).
 */
export function SyncGmailButton() {
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
      const res = await fetch('/api/cron/sync-gmail-replies?hours=24', {
        method: 'POST',
        headers: { 'x-helm-manual-sync': '1' },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErr(typeof data?.error === 'string' ? data.error : `Failed (${res.status})`);
        return;
      }
      const summary = summarizeManualSync('gmail', data);
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
        title="Poll Gmail for replies from known contacts and log them as inbound touches"
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
        {pending ? 'Syncing…' : 'Sync Replies'}
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
