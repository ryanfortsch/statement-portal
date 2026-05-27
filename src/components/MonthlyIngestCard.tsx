'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Monthly Guesty reservations ingest -- one upload, every property.
 *
 * Sits on the Helm home page. The operator picks a month, drops the Guesty
 * Platform CSV (the "reservations spreadsheet" -- one file, all listings),
 * and the server fans out: every property gets its `property_statements`
 * row + per-stay `reservations` populated in one shot, without re-uploading
 * a PDF per property. Cleaning / repairs already on file from the
 * per-property bank flow are preserved.
 */

type PropertyResult = {
  property_id: string;
  property_name: string;
  action: 'created' | 'updated';
  num_stays: number;
  rental_revenue: number;
  management_fee: number;
  owner_payout: number;
  cleaning_preserved: number;
  repairs_preserved: number;
};
type Result = {
  success: boolean;
  month: string;
  rows_in_file: number;
  reservations_in_month: number;
  reservations_cached: number;
  unmatched_listings: number;
  properties_processed: number;
  by_property: PropertyResult[];
};

function fmt(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function defaultMonth(): string {
  // Most operators run last month's statements early in the new month, so
  // default the picker to the previous calendar month.
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

export function MonthlyIngestCard() {
  const router = useRouter();
  const [month, setMonth] = useState(defaultMonth());
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
      const res = await fetch('/api/ingest-guesty-monthly', { method: 'POST', body: fd });
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
      <div className="eyebrow" style={{ marginBottom: 14 }}>Monthly ingest</div>
      <div style={{ border: '1px solid var(--ink)', background: 'var(--paper-2)', padding: '18px 20px' }}>
        <div className="flex items-baseline justify-between flex-wrap" style={{ gap: 16, marginBottom: 12 }}>
          <h3 className="font-serif" style={{ fontSize: 19, fontWeight: 500, margin: 0, color: 'var(--ink)' }}>
            Upload Guesty reservations <em style={{ color: 'var(--ink-3)' }}>for the month</em>
          </h3>
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>One file, populates every property</span>
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
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Reservations CSV</span>
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
            {busy ? 'Processing…' : 'Process & populate all'}
          </button>
        </div>

        {error && (
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--negative, #b13b2a)' }}>{error}</div>
        )}

        {result && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 8 }}>
              {result.properties_processed} propert{result.properties_processed === 1 ? 'y' : 'ies'} populated for {result.month} · {result.reservations_in_month} stays in month · {result.reservations_cached} reservations cached · {result.unmatched_listings > 0 ? `${result.unmatched_listings} unmatched listings` : 'all listings matched'}
            </div>
            <table className="w-full tabular-nums" style={{ borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--rule)' }}>Property</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid var(--rule)' }}>Stays</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid var(--rule)' }}>Revenue</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid var(--rule)' }}>Mgmt fee</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid var(--rule)' }}>Owner payout</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--rule)' }}></th>
                </tr>
              </thead>
              <tbody>
                {result.by_property.map(p => (
                  <tr key={p.property_id} style={{ borderBottom: '1px dotted var(--rule-soft)' }}>
                    <td style={{ padding: '6px 8px', fontFamily: 'var(--font-fraunces)', color: 'var(--ink)' }}>{p.property_name}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--ink-2)' }}>{p.num_stays}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--ink)' }}>{fmt(p.rental_revenue)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--ink-3)' }}>{fmt(p.management_fee)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--ink)' }}>{fmt(p.owner_payout)}</td>
                    <td style={{ padding: '6px 8px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-4)' }}>{p.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-3)', maxWidth: 720, lineHeight: 1.5 }}>
              Cleaning &amp; repairs already on file from the bank-CSV flow are preserved (not overwritten). Owner payout = revenue − management fee − cleaning − repairs.
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
