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
 *
 * Renders as a one-line status row when the month already has 5623 rows on
 * file, and expands automatically when it doesn't.
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

export type BookingActivityStatus = { known: boolean; rows: number; latest: string | null };

export function BookingDepositsUploadCard({ defaultMonth, status, onUploaded }: {
  defaultMonth?: string;
  status?: BookingActivityStatus | null;
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
        onUploaded?.();
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  const knownMissing = status != null && status.known && status.rows === 0 && !result;
  const expanded = open || knownMissing || !!result || !!error;

  const statusLine = result
    ? { text: `On file · ${result.inserted} new row${result.inserted === 1 ? '' : 's'}`, tone: 'ok' as const }
    : status == null
      ? { text: 'checking…', tone: 'muted' as const }
      : !status.known
        ? { text: 'status unknown (read failed)', tone: 'alert' as const }
        : status.rows > 0
          ? { text: `On file · ${status.rows} row${status.rows === 1 ? '' : 's'} this month${status.latest ? ` · latest ${status.latest}` : ''}`, tone: 'ok' as const }
          : { text: 'No 5623 activity uploaded for this month', tone: 'alert' as const };

  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 28 }}>
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
            <span className="eyebrow">Booking.com deposits (*5623)</span>
            <span style={{
              fontSize: 11,
              fontWeight: statusLine.tone === 'alert' ? 600 : 400,
              color: statusLine.tone === 'alert' ? 'var(--signal)' : statusLine.tone === 'ok' ? 'var(--positive)' : 'var(--ink-4)',
            }}>
              {statusLine.text}
            </span>
          </span>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)', flexShrink: 0 }}>
            {expanded ? 'Hide' : (status?.known && status.rows > 0 ? 'Add more' : 'Upload')}
          </span>
        </button>

        {expanded && (
          <div style={{ padding: '4px 16px 16px' }}>
            <div className="flex items-baseline justify-between flex-wrap" style={{ gap: 16, marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                Upload the Chase Bookingcom Deposits (...5623) activity CSV; it verifies Booking.com stays fleet-wide.
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
        )}
      </div>
    </section>
  );
}
