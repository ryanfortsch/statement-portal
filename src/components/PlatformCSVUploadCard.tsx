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

type Result = {
  success: boolean;
  month: string;
  cached: { filename: string; uploaded_at: string; size: number | null } | null;
  reservations: { parsed: number; unmatched_listings: number; reservations_upserted: number; reviews_upserted: number } | null;
  reservations_error: string | null;
};

export function PlatformCSVUploadCard({ defaultMonth }: { defaultMonth?: string } = {}) {
  const router = useRouter();
  const [month, setMonth] = useState(defaultMonth || computeDefaultMonth());
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 40 }}>
      <div className="eyebrow" style={{ marginBottom: 14 }}>Reservations CSV</div>
      <div style={{ border: '1px solid var(--ink)', background: 'var(--paper-2)', padding: '18px 20px' }}>
        <div className="flex items-baseline justify-between flex-wrap" style={{ gap: 16, marginBottom: 12 }}>
          <h3 className="font-serif" style={{ fontSize: 19, fontWeight: 500, margin: 0, color: 'var(--ink)' }}>
            Upload the Guesty <em style={{ color: 'var(--ink-3)' }}>reservations spreadsheet</em>
          </h3>
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>One upload, on file for every property this month</span>
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
                {result.reservations.reservations_upserted} reservations refreshed in the cache · {result.reservations.parsed} parsed · {result.reservations.unmatched_listings} unmatched listings
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
    </section>
  );
}
