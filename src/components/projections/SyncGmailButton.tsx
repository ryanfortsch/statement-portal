'use client';

import { useState } from 'react';
import { useSoftRefresh } from '@/lib/use-soft-refresh';

/**
 * Hits POST /api/sync-prospect-mail to scan Allie's sent folder for each
 * prospect with an email and update their gmail_touches column. Refreshes the
 * server component on completion so the badges re-render with the new state.
 */
export function SyncGmailButton({ projectionId }: { projectionId?: string }) {
  const softRefresh = useSoftRefresh();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await fetch('/api/sync-prospect-mail', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(projectionId ? { id: projectionId } : {}),
          });
          if (!res.ok) {
            let msg = `${res.status}`;
            try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
            throw new Error(msg);
          }
          softRefresh();
        } catch (err) {
          alert(`Sync failed: ${err instanceof Error ? err.message : err}`);
        } finally {
          setBusy(false);
        }
      }}
      style={{
        background: 'transparent',
        color: 'var(--ink)',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '.18em',
        textTransform: 'uppercase',
        padding: '13px 22px',
        border: '1px solid var(--ink)',
        cursor: busy ? 'wait' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      {busy ? (
        <>
          <span
            aria-hidden
            style={{
              width: 12, height: 12, borderRadius: '50%',
              border: '1.5px solid currentColor', borderTopColor: 'transparent',
              animation: 'spin 0.8s linear infinite',
              display: 'inline-block',
            }}
          />
          <span>Syncing…</span>
        </>
      ) : (
        <span>Sync Gmail</span>
      )}
    </button>
  );
}
