'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Home-page upload control for the central "Bookingcom Deposits" Chase
 * account (...5623) activity CSV.
 *
 * Booking.com pays every property into this one account, then transfers to
 * the property's own checking -- so the property's bank CSV never shows a
 * Booking.com deposit. One upload a month here gives /api/ingest the
 * transfers it needs to corroborate Booking.com stays fleet-wide. Rows
 * accumulate; re-uploads and overlapping exports dedupe automatically.
 */

function computeDefaultMonth(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

type Result = {
  success: boolean;
  month: string;
  rows_parsed: number;
  booking_credits: number;
  property_transfers: number;
  unmapped_transfers: number;
  inserted: number;
  skipped_duplicates: number;
};

export function BookingDepositsUploadCard({ defaultMonth }: { defaultMonth?: string } = {}) {
  const router = useRouter();
  const [month, setMonth] = useState(defaultMonth || computeDefaultMonth());
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!file) { setError('Choose the Chase ...5623 activity CSV first.'); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      const fd = new FormData();
      fd.append('month', month);
      fd.append('file', file);
      const res = await fetch('/api/upload-booking-deposits', { method: 'POST', body: fd });
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
      <div className="eyebrow" style={{ marginBottom: 14 }}>Booking.com deposits</div>
      <div style={{ border: '1px solid var(--ink)', background: 'var(--paper-2)', padding: '18px 20px' }}>
        <div className="flex items-baseline justify-between flex-wrap" style={{ gap: 16, marginBottom: 12 }}>
          <h3 className="font-serif" style={{ fontSize: 19, fontWeight: 500, margin: 0, color: 'var(--ink)' }}>
            Upload the Chase <em style={{ color: 'var(--ink-3)' }}>Bookingcom Deposits (...5623)</em> activity
          </h3>
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>One upload a month, verifies Booking.com stays fleet-wide</span>
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
              <strong style={{ color: 'var(--ink)' }}>On file.</strong>
              {' '}{result.booking_credits} Booking.com payout{result.booking_credits === 1 ? '' : 's'}
              {' · '}{result.property_transfers} property transfer{result.property_transfers === 1 ? '' : 's'}
              {' · '}{result.inserted} new row{result.inserted === 1 ? '' : 's'}
              {result.skipped_duplicates > 0 && ` · ${result.skipped_duplicates} already on file`}
            </div>
            {result.unmapped_transfers > 0 && (
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--signal)' }}>
                {result.unmapped_transfers} transfer{result.unmapped_transfers === 1 ? '' : 's'} to an account no property claims -- check PROPERTIES bank_last4.
              </div>
            )}
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-3)' }}>
              Booking.com stays verify against these transfers on each property&rsquo;s next ingest.
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
