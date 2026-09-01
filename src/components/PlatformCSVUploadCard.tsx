'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Home-page upload control for the Guesty Platform CSV (the monthly
 * reservations spreadsheet).
 *
 * Single purpose: drop the file once, the same writes that happen today
 * inside /api/ingest's per-property upload fire from here (cache the CSV
 * to Storage so every property's upload page sees "Platform CSV · ON FILE",
 * and freshen the guesty_reservations cache). Nothing about statement
 * generation changes -- /api/ingest is still the only path to
 * property_statements.
 *
 * Renders as a one-line status row when the month's file is already on
 * file, and expands automatically when it isn't -- the missing state is
 * the one that must be loud.
 */

function computeDefaultMonth(): string {
  // Most operators run last month's statements early in the new month, so
  // default the picker to the previous calendar month when the parent
  // doesn't pass an explicit month.
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

function shortAgo(iso: string): string {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

type Result = {
  success: boolean;
  month: string;
  cached: { filename: string; uploaded_at: string; size: number | null } | null;
  reservations: { parsed: number; unmatched_listings: number; reservations_upserted: number; api_rows_backfilled: number; reviews_upserted: number } | null;
  reservations_error: string | null;
};

export type PlatformCsvStatus = { on_file: boolean; filename: string | null; uploaded_at: string | null };

export function PlatformCSVUploadCard({ defaultMonth, status, onUploaded }: {
  defaultMonth?: string;
  status?: PlatformCsvStatus | null;
  onUploaded?: () => void;
} = {}) {
  const router = useRouter();
  const [month, setMonth] = useState(defaultMonth || computeDefaultMonth());
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // Follow the dashboard's period picker (adjust-state-during-render, per
  // React's "you might not need an effect" guidance).
  const [seenDefault, setSeenDefault] = useState(defaultMonth);
  if (defaultMonth && defaultMonth !== seenDefault) {
    setSeenDefault(defaultMonth);
    setMonth(defaultMonth);
  }

  async function submit() {
    if (!file) { setError('Choose the Guesty reservations CSV first.'); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      const fd = new FormData();
      fd.append('month', month);
      fd.append('file', file);
      const res = await fetch('/api/upload-platform-csv', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Upload failed');
      } else {
        setResult(data as Result);
        onUploaded?.();
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  // Known-missing months open themselves; on-file months stay one line.
  const knownMissing = status != null && !status.on_file && !result;
  const expanded = open || knownMissing || !!result || !!error;

  const statusLine = result?.cached
    ? { text: `On file · ${result.cached.filename}`, tone: 'ok' as const }
    : status == null
      ? { text: 'checking…', tone: 'muted' as const }
      : status.on_file
        ? { text: `On file${status.filename ? ` · ${status.filename}` : ''}${status.uploaded_at ? ` · ${shortAgo(status.uploaded_at)}` : ''}`, tone: 'ok' as const }
        : { text: 'Not uploaded for this month', tone: 'alert' as const };

  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 14 }}>
      <div style={{ border: `1px solid ${statusLine.tone === 'alert' ? 'var(--signal)' : 'var(--rule)'}`, background: 'var(--paper-2)' }}>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          style={{
            width: '100%', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16,
            padding: '10px 16px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
          }}
        >
          <span className="flex items-baseline flex-wrap" style={{ gap: 12 }}>
            <span className="eyebrow">Reservations CSV</span>
            <span style={{
              fontSize: 11,
              fontWeight: statusLine.tone === 'alert' ? 600 : 400,
              color: statusLine.tone === 'alert' ? 'var(--signal)' : statusLine.tone === 'ok' ? 'var(--positive)' : 'var(--ink-4)',
            }}>
              {statusLine.text}
            </span>
          </span>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)', flexShrink: 0 }}>
            {expanded ? 'Hide' : (status?.on_file ? 'Replace' : 'Upload')}
          </span>
        </button>

        {expanded && (
          <div style={{ padding: '4px 16px 16px' }}>
            <div className="flex items-baseline justify-between flex-wrap" style={{ gap: 16, marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                Upload the Guesty reservations spreadsheet once; it&rsquo;s on file for every property this month.
              </span>
            </div>

            <div className="flex flex-wrap items-end" style={{ gap: 14 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Month</span>
                <input
                  type="month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  disabled={busy}
                  style={{ border: '1px solid var(--rule)', background: 'var(--paper)', padding: '6px 8px', fontSize: 13, fontFamily: 'var(--font-fraunces)', color: 'var(--ink)' }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 240px' }}>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>File</span>
                <input
                  type="file"
                  accept=".csv,.CSV"
                  disabled={busy}
                  onChange={(e) => { setFile(e.target.files?.[0] || null); setError(null); setResult(null); }}
                  style={{ fontSize: 12, color: 'var(--ink-2)' }}
                />
              </label>

              <button
                type="button"
                onClick={submit}
                disabled={busy || !file}
                style={{
                  border: '1px solid var(--ink)',
                  background: busy ? 'var(--paper-2)' : 'var(--ink)',
                  color: busy ? 'var(--ink-3)' : 'var(--paper)',
                  fontSize: 10, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase',
                  padding: '9px 18px', cursor: busy || !file ? 'not-allowed' : 'pointer', opacity: !file ? 0.5 : 1,
                }}
              >
                {busy ? 'Uploading…' : 'Upload & cache'}
              </button>
            </div>

            {error && (
              <div style={{ marginTop: 12, fontSize: 12, color: 'var(--negative, #b13b2a)' }}>{error}</div>
            )}

            {result && (
              <div style={{ marginTop: 14, fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.55 }}>
                <div>
                  <strong style={{ color: 'var(--ink)' }}>On file for {result.month}.</strong>
                  {' '}Every property&rsquo;s upload page for this month will pick it up.
                </div>
                {result.reservations && (
                  <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-3)' }}>
                    {result.reservations.reservations_upserted} reservations refreshed in the cache
                    {result.reservations.api_rows_backfilled > 0 && ` · ${result.reservations.api_rows_backfilled} api rows backfilled (taxes / fees)`}
                    {' · '}{result.reservations.parsed} parsed · {result.reservations.unmatched_listings} unmatched listings
                  </div>
                )}
                {result.reservations_error && (
                  <div style={{ marginTop: 4, fontSize: 11, color: 'var(--signal)' }}>
                    Reservations cache update note: {result.reservations_error}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
