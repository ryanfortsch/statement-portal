'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Upload control for Rising Tide overhead. Accepts a Chase corporate-card
 * (*3878) or operating-account (*5130) CSV export, POSTs to
 * /api/ingest-overhead (which auto-detects the format, categorizes, drops
 * personal/transfers, and dedupes), then refreshes the page so the
 * overhead section repaints.
 *
 * The monthly "prompt" is the staleness note the parent passes in
 * (`dataThrough`): the operator re-exports the card + operating CSVs each
 * month and drops them here.
 */
export function OverheadUpload({ hint, stale }: { hint: string; stale: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const summaries: string[] = [];
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch('/api/ingest-overhead', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok || !data.success) {
          setError(`${file.name}: ${data.error || 'upload failed'}`);
          return;
        }
        summaries.push(
          `${data.account === 'card' ? 'Card' : 'Operating'}: ${data.inserted_new} new, ${data.already_present} already on file, ${data.dropped} dropped`,
        );
      }
      setResult(summaries.join(' · '));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between flex-wrap" style={{ gap: 12, marginBottom: 14 }}>
      <span style={{ fontSize: 11, color: stale ? 'var(--signal)' : 'var(--ink-3)' }}>
        {hint}
      </span>
      <label style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        border: '1px solid var(--ink)',
        background: busy ? 'var(--paper-2)' : 'transparent',
        color: 'var(--ink)',
        fontSize: 10, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase',
        padding: '7px 14px', cursor: busy ? 'wait' : 'pointer',
      }}>
        {busy ? 'Uploading…' : 'Upload card / operating CSV'}
        <input
          type="file"
          accept=".csv,.CSV"
          multiple
          className="hidden"
          disabled={busy}
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
        />
      </label>
      {result && <span style={{ fontSize: 11, color: 'var(--positive)', width: '100%', textAlign: 'right' }}>{result}</span>}
      {error && <span style={{ fontSize: 11, color: 'var(--negative)', width: '100%', textAlign: 'right' }}>{error}</span>}
    </div>
  );
}
