'use client';

import { useRef, useState } from 'react';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { summarizeManualSync } from '@/lib/manual-sync-result';

/** Manual trigger for /api/sync-quo-contacts. Runs the Quo address book vs.
 *  Helm CRM reconciliation and refreshes the suggestion inbox. */
export function SyncQuoContactsButton() {
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
      const res = await fetch('/api/sync-quo-contacts', { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErr(typeof data?.error === 'string' ? data.error : `Failed (${res.status})`);
        return;
      }
      const summary = summarizeManualSync('contacts', data);
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
        title="Compare your Quo address book with Helm contacts and surface suggestions"
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
        {pending ? 'Scanning…' : 'Sync Contacts'}
      </button>
      {(result || err) && (
        <div role={err ? 'alert' : 'status'} style={{ fontSize: 11, color: err ? 'var(--negative)' : 'var(--ink-4)', maxWidth: 280, textAlign: 'right' }}>
          {err ?? result}
        </div>
      )}
    </div>
  );
}
