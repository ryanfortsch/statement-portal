'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Fetch-backed action buttons for the /channels dashboard. Unlike the
 * server-action forms elsewhere, these hit API routes directly so we can
 * show a busy state, surface the JSON error body inline, and refresh the
 * page data in place instead of a full form POST + redirect.
 */
function FetchActionButton({
  url,
  label,
  busyLabel,
  style,
  title,
  resultNote,
}: {
  url: string;
  label: string;
  busyLabel: string;
  style?: React.CSSProperties;
  title?: string;
  resultNote?: (json: Record<string, unknown>) => string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json: Record<string, unknown> | null = await res.json().catch(() => null);
      if (!res.ok) {
        const message = json && typeof json.error === 'string' ? json.error : `Request failed (${res.status})`;
        throw new Error(message);
      }
      if (resultNote && json) setNote(resultNote(json));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const s = style ?? {};
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        aria-busy={busy || undefined}
        title={title}
        style={{
          ...s,
          cursor: busy ? 'wait' : s.cursor ?? 'pointer',
          opacity: busy ? 0.85 : s.opacity ?? 1,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
        }}
      >
        {busy && (
          <span
            aria-hidden
            className="animate-spin"
            style={{ display: 'inline-block', width: 13, height: 13, borderRadius: '50%', border: '2px solid rgba(30,46,52,0.25)', borderTopColor: 'var(--ink)' }}
          />
        )}
        {busy ? busyLabel : label}
      </button>
      {error && <span style={{ fontSize: 11, color: 'var(--negative)' }}>{error}</span>}
      {!error && note && <span style={{ fontSize: 11, color: 'var(--positive)' }}>{note}</span>}
    </span>
  );
}

export function SyncNowButton({ style }: { style?: React.CSSProperties }) {
  return (
    <FetchActionButton
      url="/api/channels/sync"
      label="Run sync now"
      busyLabel="Syncing…"
      style={style}
    />
  );
}

export function BackfillButton({ style }: { style?: React.CSSProperties }) {
  return (
    <FetchActionButton
      url="/api/channels/backfill-from-guesty"
      label="Backfill from Guesty"
      busyLabel="Backfilling…"
      style={style}
      title="One-time copy of every guesty_reservations row into the new bookings table. Idempotent."
      resultNote={(json) => (typeof json.inserted === 'number' ? `Backfilled ${json.inserted} bookings` : null)}
    />
  );
}
