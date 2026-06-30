'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Manual trigger for /api/sync-quo-contacts. Runs the Quo address book vs.
 *  Helm CRM reconciliation and refreshes the suggestion inbox. */
export function SyncQuoContactsButton() {
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
      const res = await fetch('/api/sync-quo-contacts', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.error || `Failed (${res.status})`);
        return;
      }
      const n = Number(data.suggestionsGenerated ?? 0);
      setResult(n === 0 ? 'No new suggestions.' : `${n} suggestion${n === 1 ? '' : 's'} generated.`);
      router.refresh();
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
        <div style={{ fontSize: 11, color: err ? 'var(--negative)' : 'var(--ink-4)', maxWidth: 280, textAlign: 'right' }}>
          {err ?? result}
        </div>
      )}
    </div>
  );
}
