'use client';

import { useState, useRef, useCallback } from 'react';
import Link from 'next/link';

const PROPERTIES = [
  { id: '3_south_st', name: '3 South St', owner: 'Bailey', location: 'Rockport' },
  { id: '21_horton', name: '21 Horton St', owner: 'Kittredge', location: 'Gloucester' },
  { id: '53_rocky_neck', name: '53 Rocky Neck Ave', owner: 'Prudenzi', location: 'Gloucester' },
  { id: '4_brier_neck', name: '4 Brier Neck Rd', owner: 'Armstrong', location: 'Gloucester' },
  { id: '30_woodward', name: '30 Woodward Ave', owner: 'McWethy', location: 'Gloucester' },
  { id: '20_hammond', name: '20 Hammond St', owner: 'Ramsey', location: 'Gloucester' },
  { id: '20_enon', name: '20 Enon Rd', owner: 'Snyder', location: 'Gloucester' },
  { id: '73_rocky_neck', name: '73 Rocky Neck Ave', owner: 'Moynahan', location: 'Gloucester' },
  { id: '17_beach_rd', name: '17 Beach Rd', owner: 'Nolan', location: 'Gloucester' },
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
  parsed_reservations: ParsedReservation[];
};

/* ─── Shared Components ─── */
function PlatformBadge({ platform }: { platform: string }) {
  const map: Record<string, { label: string; bg: string; text: string; ring: string }> = {
    'Airbnb':      { label: 'Airbnb',  bg: 'bg-rose-50',    text: 'text-rose-700',   ring: 'ring-rose-200/60' },
    'HomeAway':    { label: 'VRBO',    bg: 'bg-blue-50',    text: 'text-blue-700',   ring: 'ring-blue-200/60' },
    'Manual':      { label: 'Direct',  bg: 'bg-violet-50',  text: 'text-violet-700', ring: 'ring-violet-200/60' },
    'Booking.com': { label: 'Booking', bg: 'bg-indigo-50',  text: 'text-indigo-700', ring: 'ring-indigo-200/60' },
  };
  const p = map[platform] || { label: platform, bg: 'bg-gray-50', text: 'text-gray-600', ring: 'ring-gray-200/60' };
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md ${p.bg} ${p.text} ring-1 ${p.ring}`}>
      {p.label}
    </span>
  );
}

function IconCheck({ className = 'w-4 h-4' }: { className?: string }) {
  return <svg className={className} fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>;
}

function IconUpload({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  );
}

/* ─── File Drop Zone ─── */
function FileDropZone({
  label,
  description,
  required,
  accept,
  file,
  onFile,
  inputRef
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
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={`relative rounded-xl border-2 border-dashed transition-all duration-200 ${
        file
          ? 'border-emerald-300 bg-emerald-50/50'
          : dragOver
            ? 'border-[#C9A84C] bg-[#C9A84C]/5'
            : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/50'
      }`}
    >
      <label className="flex items-center gap-4 px-5 py-4 cursor-pointer">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
          file ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-400'
        }`}>
          {file ? (
            <IconCheck className="w-5 h-5" />
          ) : (
            <IconUpload className="w-5 h-5" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[13px] font-semibold text-gray-900">{label}</p>
            {required && <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">Required</span>}
          </div>
          <p className="text-[12px] text-gray-400 mt-0.5 truncate">
            {file ? file.name : description}
          </p>
        </div>
        <div className={`shrink-0 px-4 py-2 rounded-lg text-[12px] font-semibold transition-colors ${
          file
            ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
            : 'bg-[#1E2E34] text-white hover:bg-[#2a3f47]'
        }`}>
          {file ? 'Replace' : 'Choose File'}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0] || null)}
        />
      </label>
      {file && (
        <div className="absolute top-2 right-2">
          <button
            onClick={(e) => { e.preventDefault(); onFile(null); if (inputRef.current) inputRef.current.value = ''; }}
            className="w-6 h-6 bg-gray-200 hover:bg-gray-300 rounded-full flex items-center justify-center text-gray-500 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
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

  const fmtDate = (dateStr: string) => {
    if (!dateStr) return '--';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const monthLabel = (m: string) => {
    const d = new Date(m + '-01T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  return (
    <div className="min-h-screen bg-[#fafbfc]">
      {/* ─── Header ─── */}
      <header className="bg-[#1E2E34] sticky top-0 z-50 shadow-lg shadow-[#1E2E34]/10">
        <div className="max-w-3xl mx-auto px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Link href="/" className="flex items-center gap-2.5 group">
                <div className="w-8 h-8 bg-gradient-to-br from-[#C9A84C] to-[#B8953D] rounded-lg flex items-center justify-center shadow-sm">
                  <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M3 17l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M17 7h4v4" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <span className="text-white font-semibold text-[15px] tracking-tight group-hover:text-white/80 transition-colors">Rising Tide</span>
              </Link>
              <div className="w-px h-6 bg-white/10" />
              <span className="text-white/60 text-[13px] font-medium">Upload Data</span>
            </div>
            <Link href="/" className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 text-white/90 text-[12px] font-semibold rounded-lg hover:bg-white/20 transition-colors border border-white/10">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" /></svg>
              Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-8 py-8">

        {/* ═══ SUCCESS VIEW ═══ */}
        {result && (
          <div className="space-y-6">
            {/* Success Hero */}
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
              <div className="bg-gradient-to-r from-emerald-600 to-emerald-500 px-6 py-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm">
                      <IconCheck className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <p className="text-white font-bold text-[16px]">{result.property}</p>
                      <p className="text-emerald-100 text-[13px]">{monthLabel(result.month)} &middot; Successfully processed</p>
                    </div>
                  </div>
                  <span className={`px-3 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider ${
                    result.summary.confidence === 'green' ? 'bg-white/20 text-white backdrop-blur-sm' :
                    result.summary.confidence === 'yellow' ? 'bg-amber-100 text-amber-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    {result.summary.confidence === 'green' ? 'High Confidence' : result.summary.confidence === 'yellow' ? 'Medium Confidence' : 'Low Confidence'}
                  </span>
                </div>
              </div>

              <div className="p-6">
                {/* KPI Row */}
                <div className="grid grid-cols-4 gap-3 mb-6">
                  <div className="bg-gray-50 rounded-xl p-4 text-center">
                    <p className="text-[24px] font-bold text-[#1E2E34] tabular-nums">{result.summary.reservations}</p>
                    <p className="text-[11px] text-gray-400 font-medium mt-1">Reservations</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-4 text-center">
                    <p className="text-[24px] font-bold text-[#1E2E34] tabular-nums">{fmt(result.summary.total_revenue)}</p>
                    <p className="text-[11px] text-gray-400 font-medium mt-1">Net Revenue</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-4 text-center">
                    <p className="text-[24px] font-bold text-[#C9A84C] tabular-nums">{fmt(result.summary.management_fee)}</p>
                    <p className="text-[11px] text-gray-400 font-medium mt-1">Mgmt Fee</p>
                  </div>
                  <div className="bg-emerald-50 rounded-xl p-4 text-center border border-emerald-100">
                    <p className="text-[24px] font-bold text-emerald-600 tabular-nums">{fmt(result.summary.owner_payout)}</p>
                    <p className="text-[11px] text-emerald-600/60 font-medium mt-1">Owner Payout</p>
                  </div>
                </div>

                {/* Breakdown */}
                <div className="grid grid-cols-3 gap-4 text-[13px]">
                  <div className="flex items-center justify-between py-2 border-b border-gray-50">
                    <span className="text-gray-500">Stripe Fees</span>
                    <span className="font-medium text-gray-700 tabular-nums">{fmt(result.summary.stripe_fees)}</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-gray-50">
                    <span className="text-gray-500">Cleaning</span>
                    <span className="font-medium text-gray-700 tabular-nums">{fmt(result.summary.cleaning_total)}</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-gray-50">
                    <span className="text-gray-500">Data Gaps</span>
                    <span className={`font-semibold ${result.summary.data_gaps > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {result.summary.data_gaps}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Reservation Table */}
            {result.parsed_reservations.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
                  <h3 className="text-[14px] font-bold text-gray-900">Parsed Reservations</h3>
                  <span className="text-[12px] text-gray-400">{result.parsed_reservations.length} total</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="bg-gray-50 text-[10px] text-gray-500 uppercase tracking-wider">
                        <th className="px-5 py-2.5 text-left font-medium">Guest</th>
                        <th className="px-3 py-2.5 text-left font-medium">Dates</th>
                        <th className="px-2 py-2.5 text-center font-medium">Nts</th>
                        <th className="px-3 py-2.5 text-center font-medium">Channel</th>
                        <th className="px-3 py-2.5 text-right font-medium">Guesty</th>
                        <th className="px-3 py-2.5 text-right font-medium">Stripe</th>
                        <th className="px-3 py-2.5 text-right font-medium">Net</th>
                        <th className="px-5 py-2.5 text-center font-medium">Bank</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {result.parsed_reservations.map((r, i) => (
                        <tr key={i} className="hover:bg-blue-50/30 transition-colors">
                          <td className="px-5 py-3 text-gray-900 font-medium">{r.guest_name}</td>
                          <td className="px-3 py-3 text-gray-500 whitespace-nowrap">{fmtDate(r.check_in)} - {fmtDate(r.check_out)}</td>
                          <td className="px-2 py-3 text-center text-gray-500">{r.nights}</td>
                          <td className="px-3 py-3 text-center"><PlatformBadge platform={r.platform} /></td>
                          <td className="px-3 py-3 text-right text-gray-600 tabular-nums">{fmt(r.guesty_rental_income)}</td>
                          <td className="px-3 py-3 text-right tabular-nums">
                            {r.stripe_fee > 0 ? <span className="text-red-400">-{fmt(r.stripe_fee)}</span> : <span className="text-gray-300">--</span>}
                          </td>
                          <td className="px-3 py-3 text-right text-gray-900 font-semibold tabular-nums">{fmt(r.adjusted_revenue)}</td>
                          <td className="px-5 py-3 text-center">
                            {r.bank_match_status === 'matched' ? (
                              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-600">
                                <IconCheck className="w-3 h-3" />
                              </span>
                            ) : (
                              <span className="text-gray-300">--</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Action Bar */}
            <div className="flex items-center gap-3">
              <a
                href={`/statement?id=${result.property_statement_id}&month=${result.month}`}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-2 px-6 py-3 bg-[#1E2E34] text-white rounded-xl text-[13px] font-semibold hover:bg-[#2a3f47] transition-colors shadow-lg shadow-[#1E2E34]/10"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                View Statement
              </a>
              <button onClick={resetForm} className="inline-flex items-center gap-2 px-6 py-3 bg-white border border-gray-200 text-gray-700 rounded-xl text-[13px] font-semibold hover:bg-gray-50 transition-colors">
                Upload Another
              </button>
              <Link href="/" className="inline-flex items-center gap-2 px-6 py-3 bg-white border border-gray-200 text-gray-700 rounded-xl text-[13px] font-semibold hover:bg-gray-50 transition-colors">
                View Dashboard
              </Link>
            </div>
          </div>
        )}

        {/* ═══ UPLOAD FORM ═══ */}
        {!result && (
          <div className="space-y-6">
            {/* Page Title */}
            <div>
              <h1 className="text-xl font-bold text-[#1E2E34] tracking-tight">Upload Statement Data</h1>
              <p className="text-gray-400 text-[13px] mt-1">
                Upload Guesty owner statements, platform CSVs, and bank data for reconciliation.
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-100 rounded-xl px-5 py-3.5 flex items-center gap-3">
                <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/></svg>
                </div>
                <p className="text-red-700 text-[13px] font-medium">{error}</p>
              </div>
            )}

            {/* Step 1: Period & Property */}
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-gray-50 flex items-center gap-3">
                <span className="w-6 h-6 bg-[#1E2E34] text-white rounded-lg flex items-center justify-center text-[11px] font-bold">1</span>
                <h2 className="text-[14px] font-bold text-gray-900">Select Period & Property</h2>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-2 gap-5">
                  <div>
                    <label className="block text-[12px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Month</label>
                    <input
                      type="month"
                      value={month}
                      onChange={(e) => setMonth(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl text-[13px] focus:border-[#1E2E34] focus:ring-1 focus:ring-[#1E2E34]/10 bg-white transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Property</label>
                    <select
                      value={propertyId}
                      onChange={(e) => setPropertyId(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl text-[13px] focus:border-[#1E2E34] focus:ring-1 focus:ring-[#1E2E34]/10 bg-white transition-colors"
                    >
                      <option value="">Select property...</option>
                      {PROPERTIES.map(p => (
                        <option key={p.id} value={p.id}>{p.name} - {p.owner} ({p.location})</option>
                      ))}
                    </select>
                  </div>
                </div>
                {selectedProp && (
                  <div className="mt-4 bg-[#1E2E34]/[0.03] rounded-lg px-4 py-3 flex items-center gap-3">
                    <div className="w-8 h-8 bg-[#1E2E34] rounded-lg flex items-center justify-center">
                      <svg className="w-4 h-4 text-[#C9A84C]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold text-[#1E2E34]">{selectedProp.name}</p>
                      <p className="text-[11px] text-gray-400">{selectedProp.owner} &middot; {selectedProp.location} &middot; {monthLabel(month)}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Step 2: Files */}
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 bg-[#1E2E34] text-white rounded-lg flex items-center justify-center text-[11px] font-bold">2</span>
                  <h2 className="text-[14px] font-bold text-gray-900">Upload Files</h2>
                </div>
                <div className="flex items-center gap-1.5">
                  {[guestyPDF, platformCSV, bankCSV].map((f, i) => (
                    <div key={i} className={`w-2 h-2 rounded-full transition-colors ${f ? 'bg-emerald-500' : 'bg-gray-200'}`} />
                  ))}
                  <span className="text-[11px] text-gray-400 ml-1.5">{filesReady}/3</span>
                </div>
              </div>
              <div className="p-6 space-y-3">
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
                  description="Bank transactions for deposit and cleaning charge verification"
                  accept=".csv"
                  file={bankCSV}
                  onFile={setBankCSV}
                  inputRef={bankRef}
                />
              </div>
            </div>

            {/* Submit Bar */}
            <div className="flex items-center justify-between bg-white rounded-2xl border border-gray-100 px-6 py-4 shadow-sm">
              <p className="text-[12px] text-gray-400">
                {propertyId && guestyPDF
                  ? `Ready to process ${selectedProp?.name || ''} for ${monthLabel(month)}`
                  : 'Select a property and upload the Guesty statement to continue'}
              </p>
              <button
                onClick={handleSubmit}
                disabled={submitting || !propertyId || !guestyPDF}
                className="inline-flex items-center gap-2 px-8 py-3 bg-[#1E2E34] text-white rounded-xl text-[13px] font-semibold hover:bg-[#2a3f47] disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-lg shadow-[#1E2E34]/10"
              >
                {submitting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
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
      <footer className="border-t border-gray-100 mt-8">
        <div className="max-w-3xl mx-auto px-8 py-4">
          <p className="text-[11px] text-gray-400">Rising Tide STR &middot; 85 Eastern Ave, Gloucester, MA 01930</p>
        </div>
      </footer>
    </div>
  );
}
