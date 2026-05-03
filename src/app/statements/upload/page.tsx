'use client';

import { useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { HelmModuleNav } from '@/components/HelmModuleNav';
import { downloadStatementPdf } from '@/lib/download-pdf';

const PROPERTIES = [
  { id: '3_south_st', name: '3 South', owner: 'Bailey', location: 'Rockport' },
  { id: '21_horton', name: '21 Horton', owner: 'Kittredge', location: 'Gloucester' },
  { id: '53_rocky_neck', name: '53 Rocky Neck', owner: 'Prudenzi', location: 'Gloucester' },
  { id: '4_brier_neck', name: '4 Brier Neck', owner: 'Armstrong', location: 'Gloucester' },
  { id: '30_woodward', name: '30 Woodward', owner: 'McWethy', location: 'Gloucester' },
  { id: '20_hammond', name: '20 Hammond', owner: 'Ramsey', location: 'Gloucester' },
  { id: '20_enon', name: '20 Enon', owner: 'Snyder', location: 'Beverly' },
  { id: '73_rocky_neck', name: '73 Rocky Neck', owner: 'Moynahan', location: 'Gloucester' },
  { id: '17_beach_rd', name: '17 Beach', owner: 'Nolan', location: 'Gloucester' },
];

type ParsedReservation = {
  guest_name: string;
  confirmation_code: string;
  check_in: string;
  check_out: string;
  nights: number;
  platform: string;
  guesty_rental_income: number;
  stripe_fee: number;
  adjusted_revenue: number;
  bank_deposit_amount: number | null;
  bank_match_status: string;
};

type StripeSyncSummary = {
  property_id: string;
  charges_found: number;
  matched: number;
  unmatched_charges: string[];
  fee_updates: { code: string; guest: string; prev: number; next: number; delta: number }[];
  refunds_detected: { code: string; guest: string; amount: number }[];
  gross_mismatches: { code: string; guest: string; stripe: number; guesty: number }[];
  reservations_missing_charge: { code: string; guest: string; expected: number }[];
  error?: string;
};

type IngestResult = {
  success: boolean;
  property: string;
  month: string;
  property_statement_id: string;
  summary: {
    reservations: number;
    total_revenue: number;
    stripe_fees: number;
    management_fee: number;
    cleaning_total: number;
    owner_payout: number;
    confidence: string;
    data_gaps: number;
  };
  stripe_sync: StripeSyncSummary | null;
  parsed_reservations: ParsedReservation[];
};

/* ─── Editorial components ─── */

const CHANNEL_DOT: Record<string, string> = {
  Airbnb: '#ff5a5f', VRBO: '#245abc', Booking: '#003580', Direct: '#4a6b3a', Unknown: '#8a969c',
};

function chShort(platform: string): string {
  return ({ HomeAway: 'VRBO', Manual: 'Direct', 'Booking.com': 'Booking' } as Record<string, string>)[platform] || platform;
}

function PlatformBadge({ platform }: { platform: string }) {
  const label = chShort(platform);
  const dot = CHANNEL_DOT[label] || CHANNEL_DOT.Unknown;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '2px 8px 2px 7px',
      border: '1px solid var(--rule)',
      background: 'var(--paper-2)',
      fontSize: 10, fontWeight: 600, color: 'var(--ink-2)',
      letterSpacing: '.04em',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot }} />
      {label}
    </span>
  );
}

function SectionHead({ num, title, meta }: { num: string; title: string; meta?: string }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'auto 1fr auto',
      gap: 12,
      alignItems: 'baseline',
      paddingBottom: 10,
    }}>
      <span className="font-mono" style={{ fontSize: 10, color: 'var(--signal)', letterSpacing: '.08em' }}>{num}</span>
      <h2 className="font-serif" style={{ fontSize: 16, fontWeight: 500, color: 'var(--ink)', margin: 0 }}>{title}</h2>
      {meta && <span style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.14em' }}>{meta}</span>}
    </div>
  );
}

function Insight({ label, value, sub, accent, last }: { label: string; value: string; sub?: string; accent?: boolean; last?: boolean }) {
  return (
    <div style={{
      padding: '14px 16px',
      borderRight: last ? 'none' : '1px solid var(--rule)',
    }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>{label}</div>
      <div className="font-serif tabular-nums" style={{
        fontSize: 22, lineHeight: 1, fontWeight: 400,
        color: accent ? 'var(--signal)' : 'var(--ink)',
      }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

/**
 * Renders the post-ingest Stripe sync result. Only mounted when the
 * property has a STRIPE_KEYS_JSON entry; otherwise the callout doesn't
 * appear at all.
 *
 * Three states:
 *   - error   -> red note, formula estimates still stand
 *   - "no-op" (charges_found > 0 && no fee_updates && no warnings)
 *               -> green tick, "Stripe verified -- no adjustments"
 *   - changes -> list of fee replacements + any warnings (refunds,
 *                gross mismatches, missing charges)
 */
function StripeSyncCallout({ sync }: { sync: NonNullable<IngestResult['stripe_sync']> }) {
  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(n));
  const totalDelta = sync.fee_updates.reduce((s, u) => s + u.delta, 0);
  const hasWarnings = sync.refunds_detected.length + sync.gross_mismatches.length + sync.reservations_missing_charge.length > 0;
  const hasChanges = sync.fee_updates.length > 0 || hasWarnings;
  const everythingClean = !sync.error && !hasChanges;

  return (
    <div style={{ marginTop: 24 }}>
      <SectionHead
        num="①"
        title="Stripe sync"
        meta={
          sync.error ? 'failed'
            : hasChanges ? `${sync.fee_updates.length} fee${sync.fee_updates.length === 1 ? '' : 's'} corrected`
              : `${sync.charges_found} charge${sync.charges_found === 1 ? '' : 's'} verified`
        }
      />

      {sync.error && (
        <div style={{
          padding: '12px 14px',
          borderLeft: '2px solid var(--negative)',
          background: 'var(--paper-2)',
          fontSize: 12, color: 'var(--ink-2)',
        }}>
          <div style={{ fontWeight: 600, color: 'var(--negative)', marginBottom: 4 }}>Sync error -- estimates kept</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>{sync.error}</div>
        </div>
      )}

      {everythingClean && (
        <div style={{
          padding: '10px 14px',
          borderLeft: '2px solid var(--positive)',
          background: 'var(--paper-2)',
          fontSize: 12, color: 'var(--ink-2)',
        }}>
          All Stripe fees match what we estimated -- no adjustments needed.
        </div>
      )}

      {sync.fee_updates.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <table className="w-full tabular-nums" style={{ borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                <th style={{ textAlign: 'left', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Guest</th>
                <th style={{ textAlign: 'right', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Estimate</th>
                <th style={{ textAlign: 'right', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Actual</th>
                <th style={{ textAlign: 'right', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Δ</th>
              </tr>
            </thead>
            <tbody>
              {sync.fee_updates.map((u, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                  <td style={{ padding: '8px 6px', color: 'var(--ink)', fontFamily: 'var(--font-fraunces)', fontWeight: 500 }}>{u.guest}</td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--ink-3)' }}>{fmt(u.prev)}</td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--ink)' }}>{fmt(u.next)}</td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', color: u.delta > 0 ? 'var(--negative)' : 'var(--positive)' }}>
                    {u.delta > 0 ? '+' : ''}{fmt(u.delta)}
                  </td>
                </tr>
              ))}
              <tr>
                <td style={{ padding: '8px 6px', fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Total</td>
                <td colSpan={2} />
                <td style={{ padding: '8px 6px', textAlign: 'right', fontFamily: 'var(--font-fraunces)', color: totalDelta > 0 ? 'var(--negative)' : 'var(--positive)' }}>
                  {totalDelta > 0 ? '+' : ''}{fmt(totalDelta)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {hasWarnings && (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 12 }}>
          {sync.refunds_detected.map((r, i) => (
            <li key={`refund-${i}`} style={{ padding: '6px 0', borderBottom: '1px dotted var(--rule)', color: 'var(--ink-2)' }}>
              <span style={{ color: 'var(--signal)', fontWeight: 600 }}>Refund detected:</span>{' '}
              {r.guest} ({r.code}) -- {fmt(r.amount)}
            </li>
          ))}
          {sync.gross_mismatches.map((m, i) => (
            <li key={`mm-${i}`} style={{ padding: '6px 0', borderBottom: '1px dotted var(--rule)', color: 'var(--ink-2)' }}>
              <span style={{ color: 'var(--signal)', fontWeight: 600 }}>Gross mismatch:</span>{' '}
              {m.guest} ({m.code}) -- Stripe {fmt(m.stripe)} vs Guesty {fmt(m.guesty)}
            </li>
          ))}
          {sync.reservations_missing_charge.map((mc, i) => (
            <li key={`mc-${i}`} style={{ padding: '6px 0', borderBottom: '1px dotted var(--rule)', color: 'var(--ink-2)' }}>
              <span style={{ color: 'var(--signal)', fontWeight: 600 }}>No Stripe charge:</span>{' '}
              {mc.guest} ({mc.code}) -- expected {fmt(mc.expected)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FileDropZone({
  label, description, required, accept, file, onFile, inputRef,
}: {
  label: string;
  description: string;
  required?: boolean;
  accept: string;
  file: File | null;
  onFile: (f: File | null) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) onFile(dropped);
  }, [onFile]);

  return (
    <div
      className="rt-dropzone"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      style={{
        position: 'relative',
        border: `1px ${file ? 'solid' : 'dashed'} ${file ? 'var(--ink)' : dragOver ? 'var(--signal)' : 'var(--rule)'}`,
        background: file ? 'var(--paper-2)' : dragOver ? 'var(--paper-2)' : 'transparent',
        transition: 'border-color .15s, background .15s',
      }}
    >
      <label style={{
        display: 'flex', alignItems: 'center', gap: 18,
        padding: '16px 18px',
        cursor: 'pointer',
      }}>
        <span style={{
          width: 38, height: 38,
          border: `1px solid ${file ? 'var(--ink)' : 'var(--rule)'}`,
          background: file ? 'var(--ink)' : 'var(--paper)',
          color: file ? 'var(--paper)' : 'var(--ink-4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          {file ? (
            <svg width="16" height="16" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
          ) : (
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
          )}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span className="font-serif" style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>{label}</span>
            {required && (
              <span style={{
                fontSize: 9, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase',
                color: 'var(--signal)',
              }}>Required</span>
            )}
          </div>
          <div style={{
            fontSize: 11, color: 'var(--ink-4)', marginTop: 3,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {file ? file.name : description}
          </div>
        </div>
        <span style={{
          flexShrink: 0,
          fontSize: 10, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase',
          color: file ? 'var(--ink)' : 'var(--paper)',
          background: file ? 'transparent' : 'var(--ink)',
          border: `1px solid ${file ? 'var(--ink)' : 'var(--ink)'}`,
          padding: '7px 14px',
        }}>
          {file ? 'Replace' : 'Choose File'}
        </span>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0] || null)}
        />
      </label>
      {file && (
        <button
          onClick={(e) => { e.preventDefault(); onFile(null); if (inputRef.current) inputRef.current.value = ''; }}
          style={{
            position: 'absolute', top: 8, right: 8,
            width: 22, height: 22,
            background: 'transparent', border: 'none',
            color: 'var(--ink-4)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          aria-label="remove file"
        >
          <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      )}
    </div>
  );
}

/* ─── Main Upload Page ─── */
export default function UploadPage() {
  const [month, setMonth] = useState('2026-04');
  const [propertyId, setPropertyId] = useState('');
  const [guestyPDF, setGuestyPDF] = useState<File | null>(null);
  const [platformCSV, setPlatformCSV] = useState<File | null>(null);
  const [bankCSV, setBankCSV] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const pdfRef = useRef<HTMLInputElement>(null);
  const platRef = useRef<HTMLInputElement>(null);
  const bankRef = useRef<HTMLInputElement>(null);

  const selectedProp = PROPERTIES.find(p => p.id === propertyId);
  const filesReady = [guestyPDF, platformCSV, bankCSV].filter(Boolean).length;

  async function handleSubmit() {
    if (!propertyId) { setError('Please select a property'); return; }
    if (!guestyPDF) { setError('Please upload the Guesty owner statement PDF'); return; }
    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('month', month);
      formData.append('property_id', propertyId);
      formData.append('guesty_pdf', guestyPDF);
      if (platformCSV) formData.append('platform_csv', platformCSV);
      if (bankCSV) formData.append('bank_csv', bankCSV);

      const res = await fetch('/api/ingest', { method: 'POST', body: formData });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Upload failed');
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setResult(null);
    setError(null);
    setGuestyPDF(null);
    setPlatformCSV(null);
    setBankCSV(null);
    if (pdfRef.current) pdfRef.current.value = '';
    if (platRef.current) platRef.current.value = '';
    if (bankRef.current) bankRef.current.value = '';
  }

  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(n));
  const fmtCompact = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
  const fmtDate = (dateStr: string) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  const monthLabel = (m: string) => {
    const d = new Date(m + '-01T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  const confidenceColor = (c: string) =>
    c === 'green' ? 'var(--positive)' : c === 'yellow' ? 'var(--signal)' : 'var(--negative)';
  const confidenceLabel = (c: string) =>
    c === 'green' ? 'High Confidence' : c === 'yellow' ? 'Medium Confidence' : 'Low Confidence';

  return (
    <div className="min-h-screen" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      {/* ─── MASTHEAD ─── */}
      <header className="sticky top-0 z-50" style={{ background: 'var(--paper)', borderBottom: '1px solid var(--ink)' }}>
        <div className="max-w-[1100px] mx-auto px-10">
          <div className="rt-masthead-top flex items-center justify-between" style={{ padding: '16px 0 12px', borderBottom: '1px solid var(--rule)' }}>
            <div className="flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <Link href="/" style={{ display: 'inline-flex' }} aria-label="Helm home">
                <img src="/rising-tide-logo.png" alt="Rising Tide" style={{ width: 28, height: 28 }} />
              </Link>
              <Link href="/" className="font-serif" style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-0.01em', color: 'var(--ink)', textDecoration: 'none' }}>Helm</Link>
              <span style={{ width: 1, height: 14, background: 'var(--rule)' }} aria-hidden="true" />
              <HelmModuleNav current="statements" />
            </div>
            <div className="flex items-center gap-3">
              <Link href="/statements" style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                border: '1px solid var(--rule)',
                background: 'transparent',
                color: 'var(--ink-3)',
                fontSize: 11, fontWeight: 500, letterSpacing: '.08em', textTransform: 'uppercase',
                padding: '6px 12px',
              }}>
                <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                </svg>
                Statements
              </Link>
              <form action="/api/auth/signout" method="post">
                <button
                  type="submit"
                  title="Sign out"
                  style={{
                    fontSize: 10,
                    letterSpacing: '.18em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-4)',
                    background: 'none',
                    border: '1px solid var(--rule)',
                    cursor: 'pointer',
                    padding: '4px 10px',
                  }}
                >
                  Sign out
                </button>
              </form>
            </div>
          </div>
          <div style={{ padding: '14px 0 4px' }}>
            <div className="eyebrow">Step</div>
            <h1 className="font-serif" style={{
              fontSize: 32, lineHeight: 1.05, fontWeight: 300,
              letterSpacing: '-0.02em', marginTop: 4,
            }}>
              {result ? (
                <>Processed <em style={{ color: 'var(--tide-deep)', fontWeight: 400 }}>{result.property}</em></>
              ) : (
                <>Upload <em style={{ color: 'var(--tide-deep)', fontWeight: 400 }}>Monthly Data</em></>
              )}
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 36, paddingBottom: 60 }}>

        {/* ═══ SUCCESS VIEW ═══ */}
        {result && (
          <div>
            {/* Header strip with confidence */}
            <div className="flex items-baseline justify-between" style={{ marginBottom: 16 }}>
              <div>
                <div className="eyebrow">{monthLabel(result.month)} · Successfully processed</div>
                <div className="font-serif" style={{ fontSize: 22, fontWeight: 500, marginTop: 6 }}>{result.property}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: confidenceColor(result.summary.confidence) }} />
                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: confidenceColor(result.summary.confidence) }}>
                  {confidenceLabel(result.summary.confidence)}
                </span>
              </div>
            </div>

            {/* Insights strip */}
            <div className="rule-top rule-bottom" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
              <Insight label="Reservations" value={String(result.summary.reservations)} />
              <Insight label="Net Revenue" value={fmtCompact(result.summary.total_revenue)} />
              <Insight label="Mgmt Fee" value={fmtCompact(result.summary.management_fee)} accent />
              <Insight label="Owner Payout" value={fmtCompact(result.summary.owner_payout)} last />
            </div>

            {/* Sub-breakdown */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 32, paddingTop: 16 }}>
              <div className="flex items-baseline justify-between" style={{ padding: '8px 0', borderBottom: '1px dotted var(--rule)' }}>
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Stripe Fees</span>
                <span className="font-serif tabular-nums" style={{ fontSize: 13, color: 'var(--ink)' }}>{fmt(result.summary.stripe_fees)}</span>
              </div>
              <div className="flex items-baseline justify-between" style={{ padding: '8px 0', borderBottom: '1px dotted var(--rule)' }}>
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Cleaning</span>
                <span className="font-serif tabular-nums" style={{ fontSize: 13, color: 'var(--ink)' }}>{fmt(result.summary.cleaning_total)}</span>
              </div>
              <div className="flex items-baseline justify-between" style={{ padding: '8px 0', borderBottom: '1px dotted var(--rule)' }}>
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Data Gaps</span>
                <span className="font-serif tabular-nums" style={{
                  fontSize: 13,
                  color: result.summary.data_gaps > 0 ? 'var(--signal)' : 'var(--positive)',
                }}>
                  {result.summary.data_gaps}
                </span>
              </div>
            </div>

            {/* Stripe sync callout. Only renders when the property has a
                Stripe key configured (otherwise stripe_sync is null and the
                ingest's formula estimates stand). */}
            {result.stripe_sync && <StripeSyncCallout sync={result.stripe_sync} />}

            {/* Reservations table */}
            {result.parsed_reservations.length > 0 && (
              <div style={{ marginTop: 32 }}>
                <SectionHead num="01" title="Parsed Reservations" meta={`${result.parsed_reservations.length} total`} />
                <table className="w-full tabular-nums" style={{ borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                      <th style={{ textAlign: 'left', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Guest</th>
                      <th style={{ textAlign: 'left', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Stay</th>
                      <th style={{ textAlign: 'center', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Nts</th>
                      <th style={{ textAlign: 'center', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Channel</th>
                      <th style={{ textAlign: 'right', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Guesty</th>
                      <th style={{ textAlign: 'right', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Stripe</th>
                      <th style={{ textAlign: 'right', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Net</th>
                      <th style={{ textAlign: 'center', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Bank</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.parsed_reservations.map((r, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--rule-soft)' }}>
                        <td style={{ padding: '10px 6px', color: 'var(--ink)', fontFamily: 'var(--font-fraunces)', fontWeight: 500 }}>{r.guest_name}</td>
                        <td style={{ padding: '10px 6px', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{fmtDate(r.check_in)} → {fmtDate(r.check_out)}</td>
                        <td style={{ padding: '10px 6px', textAlign: 'center', color: 'var(--ink-3)' }}>{r.nights}</td>
                        <td style={{ padding: '10px 6px', textAlign: 'center' }}><PlatformBadge platform={r.platform} /></td>
                        <td style={{ padding: '10px 6px', textAlign: 'right', color: 'var(--ink-3)' }}>{fmt(r.guesty_rental_income)}</td>
                        <td style={{ padding: '10px 6px', textAlign: 'right', color: r.stripe_fee > 0 ? 'var(--negative)' : 'var(--ink-4)' }}>
                          {r.stripe_fee > 0 ? `−${fmt(r.stripe_fee)}` : '—'}
                        </td>
                        <td style={{ padding: '10px 6px', textAlign: 'right', color: 'var(--ink)', fontFamily: 'var(--font-fraunces)', fontSize: 13 }}>{fmt(r.adjusted_revenue)}</td>
                        <td style={{ padding: '10px 6px', textAlign: 'center' }}>
                          {r.bank_match_status === 'matched' ? (
                            <span style={{ color: 'var(--positive)' }}>✓</span>
                          ) : (
                            <span style={{ color: 'var(--ink-4)' }}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3 flex-wrap" style={{ marginTop: 32 }}>
              <a
                href={`/statements/render?id=${result.property_statement_id}&month=${result.month}`}
                target="_blank"
                rel="noopener"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  background: 'var(--ink)', color: 'var(--paper)',
                  fontSize: 11, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase',
                  padding: '10px 18px',
                }}
              >
                <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                View Statement
              </a>
              <button
                disabled={downloadingPdf}
                onClick={async () => {
                  setDownloadingPdf(true);
                  setPdfError(null);
                  try {
                    await downloadStatementPdf(result.property_statement_id, result.month);
                  } catch (err) {
                    setPdfError(err instanceof Error ? err.message : 'Download failed');
                  } finally {
                    setDownloadingPdf(false);
                  }
                }}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  background: downloadingPdf ? 'var(--paper-2)' : 'transparent',
                  color: 'var(--ink-2)',
                  fontSize: 11, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase',
                  padding: '10px 18px',
                  border: '1px solid var(--ink)',
                  cursor: downloadingPdf ? 'wait' : 'pointer',
                  minWidth: 180,
                  justifyContent: 'center',
                }}
              >
                {downloadingPdf ? (
                  <>
                    <span style={{
                      width: 10, height: 10, borderRadius: '50%',
                      border: '1.5px solid var(--ink-3)', borderTopColor: 'transparent',
                      animation: 'spin 0.8s linear infinite',
                    }} />
                    Preparing PDF…
                  </>
                ) : (
                  <>
                    <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Download PDF
                  </>
                )}
              </button>
              {pdfError && (
                <span style={{ fontSize: 11, color: 'var(--negative)' }}>{pdfError}</span>
              )}
              <button onClick={resetForm} style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: 'transparent', color: 'var(--ink-3)',
                fontSize: 11, fontWeight: 500, letterSpacing: '.08em', textTransform: 'uppercase',
                padding: '10px 18px',
                border: '1px solid var(--rule)',
                cursor: 'pointer',
              }}>
                Upload Another
              </button>
              <Link href="/statements" style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: 'transparent', color: 'var(--ink-3)',
                fontSize: 11, fontWeight: 500, letterSpacing: '.08em', textTransform: 'uppercase',
                padding: '10px 18px',
                border: '1px solid var(--rule)',
              }}>
                View Statements
              </Link>
            </div>
          </div>
        )}

        {/* ═══ UPLOAD FORM ═══ */}
        {!result && (
          <div>
            {error && (
              <div style={{
                background: 'var(--paper-2)',
                borderLeft: '3px solid var(--negative)',
                borderTop: '1px solid var(--rule)',
                borderRight: '1px solid var(--rule)',
                borderBottom: '1px solid var(--rule)',
                padding: '12px 16px',
                fontSize: 12, color: 'var(--ink-2)',
                marginBottom: 24,
              }}>
                <strong style={{ color: 'var(--negative)', letterSpacing: '.08em', textTransform: 'uppercase', fontSize: 10, marginRight: 8 }}>Error</strong>
                {error}
              </div>
            )}

            {/* Step 1: Period & Property */}
            <div style={{ marginBottom: 36 }}>
              <SectionHead num="01" title="Select Period & Property" />
              <div className="rt-upload-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 24, paddingTop: 6 }}>
                <div>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>Month</div>
                  <input
                    type="month"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                    className="font-serif"
                    style={{
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      borderBottom: '1px solid var(--ink)',
                      padding: '8px 0',
                      fontSize: 16, fontWeight: 500, color: 'var(--ink)',
                      outline: 'none',
                    }}
                  />
                </div>
                <div>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>Property</div>
                  <select
                    value={propertyId}
                    onChange={(e) => setPropertyId(e.target.value)}
                    className="font-serif"
                    style={{
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      borderBottom: '1px solid var(--ink)',
                      padding: '8px 28px 8px 0',
                      fontSize: 16, fontWeight: 500, color: 'var(--ink)',
                      outline: 'none',
                      appearance: 'none',
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%23506068' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E")`,
                      backgroundRepeat: 'no-repeat',
                      backgroundPosition: 'right 4px center',
                      backgroundSize: '14px',
                    }}
                  >
                    <option value="">Select property…</option>
                    {PROPERTIES.map(p => (
                      <option key={p.id} value={p.id}>{p.name} — {p.owner} ({p.location})</option>
                    ))}
                  </select>
                </div>
              </div>
              {selectedProp && (
                <div style={{
                  marginTop: 18,
                  padding: '10px 14px',
                  background: 'var(--paper-2)',
                  borderLeft: '3px solid var(--tide)',
                  display: 'flex', alignItems: 'baseline', gap: 14,
                  fontSize: 12,
                }}>
                  <span className="font-serif" style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{selectedProp.name}</span>
                  <span style={{ color: 'var(--ink-4)' }}>
                    {selectedProp.owner} &middot; {selectedProp.location} &middot; {monthLabel(month)}
                  </span>
                </div>
              )}
            </div>

            {/* Step 2: Files */}
            <div style={{ marginBottom: 36 }}>
              <SectionHead num="02" title="Upload Files" meta={`${filesReady}/3`} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 6 }}>
                <FileDropZone
                  label="Guesty Owner Statement"
                  description="PDF containing reservation data and rental income"
                  required
                  accept=".pdf"
                  file={guestyPDF}
                  onFile={setGuestyPDF}
                  inputRef={pdfRef}
                />
                <FileDropZone
                  label="Platform CSV"
                  description="Maps confirmation codes to booking channels and guest names"
                  accept=".csv"
                  file={platformCSV}
                  onFile={setPlatformCSV}
                  inputRef={platRef}
                />
                <FileDropZone
                  label="Chase Bank CSV"
                  description="Bank transactions for deposit and cleaning-charge verification"
                  accept=".csv"
                  file={bankCSV}
                  onFile={setBankCSV}
                  inputRef={bankRef}
                />
              </div>
            </div>

            {/* Submit */}
            <div style={{
              borderTop: '1px solid var(--ink)',
              paddingTop: 18,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>
                {propertyId && guestyPDF
                  ? `Ready to process ${selectedProp?.name || ''} for ${monthLabel(month)}`
                  : 'Select a property and upload the Guesty statement to continue'}
              </span>
              <button
                onClick={handleSubmit}
                disabled={submitting || !propertyId || !guestyPDF}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 10,
                  background: 'var(--ink)', color: 'var(--paper)',
                  fontSize: 11, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase',
                  padding: '12px 22px',
                  border: 'none',
                  cursor: (submitting || !propertyId || !guestyPDF) ? 'not-allowed' : 'pointer',
                  opacity: (submitting || !propertyId || !guestyPDF) ? 0.4 : 1,
                }}
              >
                {submitting ? (
                  <>
                    <span style={{
                      width: 12, height: 12, borderRadius: '50%',
                      border: '1.5px solid var(--paper)', borderTopColor: 'transparent',
                      animation: 'spin 0.8s linear infinite',
                    }} />
                    Processing
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                    Process & Upload
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid var(--ink)', marginTop: 24 }}>
        <div className="rt-footer max-w-[1100px] mx-auto px-10 flex items-center justify-between" style={{ padding: '14px 40px', fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
          <span>Rising Tide &middot; 85 Eastern Ave &middot; Gloucester, MA 01930</span>
          <span className="font-serif" style={{ textTransform: 'none', letterSpacing: 0, fontStyle: 'italic', color: 'var(--ink-3)', fontSize: 11 }}>&ldquo;We care for your home as if it were our own.&rdquo;</span>
        </div>
      </footer>
    </div>
  );
}
