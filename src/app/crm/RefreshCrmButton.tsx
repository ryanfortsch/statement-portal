'use client';

import { useRef, useState } from 'react';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { combineManualSyncs, summarizeManualSync, type ManualSyncKind, type ManualSyncResult } from '@/lib/manual-sync-result';

/**
 * The CRM's one Refresh: Gmail replies from known contacts, the last 14 days
 * of Quo texts and calls, and the Quo address book, all at once, reported in
 * one line. It replaces three buttons (Sync Replies, Sync Quo, Sync
 * Contacts) that were belt-and-braces for the webhook and the crons, which
 * keep the steady state; this is for "I just sent that, pull the reply now".
 *
 * Each source answers for itself: a failure, an incomplete run or a
 * response that cannot be read is said, never turned into a clean zero.
 * New address-book suggestions land on the Inbox's New numbers card.
 */
const SOURCES: Array<{ kind: ManualSyncKind; label: string; url: string; init: RequestInit }> = [
  // The route accepts the signed-in session with this header instead of the cron secret.
  { kind: 'gmail', label: 'Gmail', url: '/api/cron/sync-gmail-replies?hours=24', init: { method: 'POST', headers: { 'x-helm-manual-sync': '1' } } },
  { kind: 'quo', label: 'Quo', url: '/api/sync-quo', init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ days: 14 }) } },
  { kind: 'contacts', label: 'Quo address book', url: '/api/sync-quo-contacts', init: { method: 'POST' } },
];

const UNCONFIRMED = 'Could not confirm the sync result. Check the latest activity before retrying.';

async function runOne(source: (typeof SOURCES)[number]): Promise<ManualSyncResult> {
  try {
    const res = await fetch(source.url, source.init);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const why = typeof data?.error === 'string' ? data.error : `failed (${res.status})`;
      return { message: `${source.label}: ${why}`, warning: true, refresh: false };
    }
    return summarizeManualSync(source.kind, data);
  } catch {
    return { message: `${source.label}: ${UNCONFIRMED}`, warning: true, refresh: false };
  }
}

export function RefreshCrmButton() {
  const softRefresh = useSoftRefresh();
  const lock = useRef(false);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<ManualSyncResult | null>(null);
  useUnsavedWorkGuard(pending);

  async function refresh() {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setOutcome(null);
    try {
      const combined = combineManualSyncs(await Promise.all(SOURCES.map(runOne)));
      setOutcome(combined);
      if (combined.refresh) softRefresh();
    } finally {
      lock.current = false;
      setPending(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
      <button
        type="button"
        onClick={refresh}
        disabled={pending}
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
        {pending ? 'Refreshing…' : 'Refresh'}
      </button>
      {outcome && (
        <div
          role={outcome.warning ? 'alert' : 'status'}
          style={{ fontSize: 11, color: outcome.warning ? 'var(--negative)' : 'var(--ink-4)', maxWidth: 420, textAlign: 'right' }}
        >
          {outcome.message}
        </div>
      )}
    </div>
  );
}
