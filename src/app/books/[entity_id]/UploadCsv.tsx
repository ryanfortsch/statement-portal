'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Client-side Chase CSV upload widget for the per-entity Books page.
 * The operator picks one of the entity's bank/card accounts, drops the
 * CSV, hits Upload. The server parses, dedupes via hash, and persists
 * new rows to ledger_transactions; this widget shows the inserted /
 * skipped counts and refreshes the page so the transaction list reflects
 * the new rows.
 *
 * Re-uploads are safe by design: the dedupe hash on the server collapses
 * the same (entity, account, date, amount, description) tuple, so an
 * overlapping month CSV silently skips rows already on file.
 */

type AccountOption = {
  id: string;
  kind: 'bank' | 'credit_card';
  institution: string | null;
  last4: string | null;
  label: string | null;
  property_id: string | null;
};

type UploadResult = {
  success: true;
  parsed: number;
  inserted: number;
  skipped: number;
  date_range: { min: string; max: string } | null;
} | {
  error: string;
};

export function UploadCsv({ accounts }: { accounts: AccountOption[] }) {
  const router = useRouter();
  const [accountId, setAccountId] = useState<string>(accounts[0]?.id || '');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedAccount = accounts.find((a) => a.id === accountId);

  async function handleSubmit() {
    if (!accountId) { setError('Pick an account'); return; }
    if (!file) { setError('Pick a CSV'); return; }
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('account_id', accountId);
      fd.append('file', file);
      const res = await fetch('/api/books/ingest', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Upload failed');
        return;
      }
      setResult(data);
      // Refresh the server-rendered transaction list to reflect new rows.
      router.refresh();
      // Clear the file picker but keep the account selected so the
      // operator can drop the next month/account in immediately.
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)', padding: '20px 0', margin: '20px 0' }}>
      <div className="eyebrow" style={{ marginBottom: 14 }}>Upload Chase CSV</div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 3fr auto', gap: 16, alignItems: 'end' }}>
        {/* Account picker */}
        <div>
          <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--ink-4)', display: 'block', marginBottom: 6 }}>
            Account
          </label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="font-serif"
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              borderBottom: '1px solid var(--ink)',
              fontSize: 14,
              padding: '6px 0',
              outline: 'none',
              cursor: 'pointer',
              color: 'var(--ink)',
            }}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.kind === 'credit_card' ? '💳' : '🏦'} {a.institution} ⋯{a.last4} · {a.label || '(unlabeled)'}
              </option>
            ))}
          </select>
        </div>

        {/* File picker */}
        <div>
          <label style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--ink-4)', display: 'block', marginBottom: 6 }}>
            CSV
          </label>
          <label style={{
            display: 'flex', alignItems: 'center', gap: 10,
            border: '1px solid var(--rule)', background: file ? 'var(--paper-2)' : 'transparent',
            padding: '7px 12px', cursor: 'pointer', fontSize: 12, color: 'var(--ink-2)',
          }}>
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {file ? file.name : 'Drop or click to pick a CSV'}
            </span>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={submitting || !accountId || !file}
          style={{
            background: submitting ? 'var(--paper-2)' : 'var(--ink)',
            color: submitting ? 'var(--ink-3)' : 'var(--paper)',
            border: '1px solid var(--ink)',
            fontSize: 11, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase',
            padding: '9px 18px',
            cursor: submitting ? 'wait' : 'pointer',
            opacity: !file || !accountId ? 0.5 : 1,
          }}
        >
          {submitting ? 'Uploading…' : 'Upload'}
        </button>
      </div>

      {selectedAccount && (
        <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 8 }}>
          Format expected: <strong>{selectedAccount.kind === 'bank' ? 'Chase Bank CSV' : 'Chase Credit Card CSV'}</strong>
          {' '}· export from Chase → account → Activity → Download
        </div>
      )}

      {error && (
        <div style={{
          marginTop: 14, padding: '10px 12px',
          borderLeft: '2px solid var(--negative)',
          background: 'var(--paper-2)',
          fontSize: 12, color: 'var(--ink-2)',
        }}>
          {error}
        </div>
      )}

      {result && 'success' in result && (
        <div style={{
          marginTop: 14, padding: '10px 12px',
          borderLeft: `2px solid ${result.skipped === result.parsed ? 'var(--ink-4)' : 'var(--positive)'}`,
          background: 'var(--paper-2)',
          fontSize: 12, color: 'var(--ink-2)',
        }}>
          Parsed <strong>{result.parsed}</strong> · inserted <strong>{result.inserted}</strong>
          {result.skipped > 0 && <> · <span style={{ color: 'var(--ink-4)' }}>skipped {result.skipped} duplicate{result.skipped === 1 ? '' : 's'}</span></>}
          {result.date_range && (
            <span style={{ color: 'var(--ink-4)' }}> &middot; {result.date_range.min} → {result.date_range.max}</span>
          )}
        </div>
      )}
    </div>
  );
}
