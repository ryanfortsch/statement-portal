'use client';

import { useState } from 'react';
import type { Vendor1099Row } from '@/lib/vendor-1099';

/**
 * Renders the 1099 candidates table with an inline "W9 on file" checkbox
 * per vendor. Client component because the checkbox writes through to
 * /api/vendor-w9 and reflects optimistic state locally.
 *
 * Sources: 'cleaning' | 'repairs' | 'overhead' -- shown as small chips so
 * Dotti can see at a glance which buckets a vendor is showing up in.
 */
export function Vendor1099Table({ rows: initial }: { rows: Vendor1099Row[] }) {
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function toggle(r: Vendor1099Row, next: boolean) {
    const prev = r.w9OnFile;
    setBusy(r.vendorKey);
    setErr(null);
    // Optimistic flip.
    setRows(rs => rs.map(x => x.vendorKey === r.vendorKey ? { ...x, w9OnFile: next } : x));
    try {
      const res = await fetch('/api/vendor-w9', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendor_key: r.vendorKey, display_name: r.displayName, on_file: next }),
      });
      const data = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) {
        setErr(data.error || 'Save failed.');
        setRows(rs => rs.map(x => x.vendorKey === r.vendorKey ? { ...x, w9OnFile: prev } : x));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed.');
      setRows(rs => rs.map(x => x.vendorKey === r.vendorKey ? { ...x, w9OnFile: prev } : x));
    } finally {
      setBusy(null);
    }
  }

  const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (rows.length === 0) {
    return (
      <div style={{ padding: 16, background: 'var(--paper-2)', fontSize: 12, color: 'var(--ink-4)' }}>
        No vendor payments recorded yet this year.
      </div>
    );
  }

  return (
    <>
      {err && (
        <div style={{ padding: '8px 12px', marginBottom: 10, borderLeft: '2px solid var(--negative)', background: 'var(--paper-2)', fontSize: 11, color: 'var(--ink-2)' }}>
          {err}
        </div>
      )}
      <table className="w-full tabular-nums" style={{ borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
            <th style={{ textAlign: 'left', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Vendor</th>
            <th style={{ textAlign: 'right', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>YTD spend</th>
            <th style={{ textAlign: 'right', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Txns</th>
            <th style={{ textAlign: 'left', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Sources</th>
            <th style={{ textAlign: 'center', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>1099?</th>
            <th style={{ textAlign: 'center', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>W9 on file</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const needsW9 = r.eligible1099 && !r.w9OnFile;
            return (
              <tr key={r.vendorKey} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                <td style={{ padding: '8px 6px', color: 'var(--ink)', fontFamily: 'var(--font-fraunces)', fontWeight: 500 }}>
                  {r.displayName}
                </td>
                <td style={{ padding: '8px 6px', textAlign: 'right', color: r.eligible1099 ? 'var(--ink)' : 'var(--ink-3)', fontWeight: r.eligible1099 ? 500 : 400 }}>
                  {fmt(r.ytdTotal)}
                </td>
                <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--ink-4)' }}>{r.txnCount}</td>
                <td style={{ padding: '8px 6px' }}>
                  <span style={{ display: 'inline-flex', gap: 6 }}>
                    {r.sources.map(s => (
                      <span key={s} style={{
                        fontSize: 9, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase',
                        padding: '2px 6px', border: '1px solid var(--rule)', color: 'var(--ink-3)',
                      }}>
                        {s}
                      </span>
                    ))}
                  </span>
                </td>
                <td style={{ padding: '8px 6px', textAlign: 'center' }}>
                  {r.eligible1099 ? (
                    <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: needsW9 ? 'var(--signal)' : 'var(--positive)' }}>
                      {needsW9 ? 'Candidate' : 'Candidate'}
                    </span>
                  ) : (
                    <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>under $600</span>
                  )}
                </td>
                <td style={{ padding: '8px 6px', textAlign: 'center' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: busy === r.vendorKey ? 'wait' : 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={r.w9OnFile}
                      disabled={busy === r.vendorKey}
                      onChange={(e) => toggle(r, e.target.checked)}
                    />
                    <span style={{ fontSize: 11, color: r.w9OnFile ? 'var(--positive)' : (needsW9 ? 'var(--signal)' : 'var(--ink-4)') }}>
                      {r.w9OnFile ? 'on file' : (needsW9 ? 'needed' : '—')}
                    </span>
                  </label>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
