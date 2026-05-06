'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
      const res = await fetch('/api/cron/sync-gmail-replies?hours=24', {
        method: 'POST',
        headers: { 'x-helm-manual-sync': '1' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.error || `Failed (${res.status})`);
        return;
      }
      const inserted = Number(data.inserted ?? 0);
      const matched = Number(data.matched ?? 0);
      const scanned = Number(data.scanned ?? 0);
      setResult(
        inserted > 0
          ? `Captured ${inserted} new ${inserted === 1 ? 'reply' : 'replies'} (${scanned} scanned, ${matched} matched).`
          : `No new replies (${scanned} scanned, ${matched} matched but already on file).`
      );
      if (inserted > 0) router.refresh();
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
