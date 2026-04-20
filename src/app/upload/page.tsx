'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';

const PROPERTIES = [
  { id: '3_south_st', name: '3 South St', owner: 'Bailey' },
  { id: '21_horton', name: '21 Horton St', owner: 'Kittredge' },
  { id: '53_rocky_neck', name: '53 Rocky Neck Ave', owner: 'Prudenzi' },
  { id: '4_brier_neck', name: '4 Brier Neck Rd', owner: 'Armstrong' },
  { id: '30_woodward', name: '30 Woodward Ave', owner: 'McWethy' },
  { id: '20_hammond', name: '20 Hammond St', owner: 'Ramsey' },
  { id: '20_enon', name: '20 Enon Rd', owner: 'Snyder' },
  { id: '73_rocky_neck', name: '73 Rocky Neck Ave', owner: 'Moynahan' },
  { id: '17_beach_rd', name: '17 Beach Rd', owner: 'Nolan' },
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

function PlatformPill({ platform }: { platform: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    'Airbnb': { label: 'Airbnb', cls: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200' },
    'HomeAway': { label: 'VRBO', cls: 'bg-sky-50 text-sky-600 ring-1 ring-sky-200' },
    'Manual': { label: 'Direct', cls: 'bg-violet-50 text-violet-600 ring-1 ring-violet-200' },
    'Booking.com': { label: 'Booking', cls: 'bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200' },
  };
  const p = map[platform] || { label: platform, cls: 'bg-gray-50 text-gray-500 ring-1 ring-gray-200' };
  return <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${p.cls}`}>{p.label}</span>;
}

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
    setGuestyPDF(null);
    setPlatformCSV(null);
    setBankCSV(null);
    if (pdfRef.current) pdfRef.current.value = '';
    if (platRef.current) platRef.current.value = '';
    if (bankRef.current) bankRef.current.value = '';
  }

  const fmt = (n: number) => '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtSigned = (n: number) => (n < 0 ? '-' : '') + fmt(n);

  const fmtDate = (dateStr: string) => {
    if (!dateStr) return '--';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const monthLabel = (m: string) => {
    const [y, mo] = m.split('-');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[parseInt(mo) - 1]} ${y}`;
  };

  return (
    <div className="min-h-screen bg-[#f8f9fa]">
      {/* Header */}
      <header className="bg-[#1E2E34] sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-6">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-[#C9A84C]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 17l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M17 7h4v4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="text-white/90 font-medium text-[14px]">Rising Tide</span>
              <span className="text-white/30 mx-1">/</span>
              <span className="text-white/70 text-[13px]">Upload</span>
            </div>
            <Link href="/" className="text-[12px] text-white/50 hover:text-white/80 font-medium">
              Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">

        {/* SUCCESS VIEW */}
        {result && (
          <div className="space-y-5">
            {/* Success banner */}
            <div className="bg-white rounded-lg border border-gray-100 overflow-hidden">
              <div className="bg-emerald-600 px-5 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
                  <div>
                    <p className="text-white font-medium text-[14px]">{result.property}</p>
                    <p className="text-emerald-100 text-[12px]">{monthLabel(result.month)}</p>
                  </div>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold ${
                  result.summary.confidence === 'green' ? 'bg-white/20 text-white' :
                  result.summary.confidence === 'yellow' ? 'bg-amber-100 text-amber-800' :
                  'bg-red-100 text-red-800'
                }`}>
                  {result.summary.confidence === 'green' ? 'High' : result.summary.confidence === 'yellow' ? 'Medium' : 'Low'} Confidence
                </span>
              </div>

              <div className="p-5">
                {/* Key numbers */}
                <div className="grid grid-cols-3 gap-4 mb-5">
                  <div className="text-center py-3 bg-gray-50 rounded-lg">
                    <p className="text-[22px] font-bold text-[#1E2E34] tabular-nums">{result.summary.reservations}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">Reservations</p>
                  </div>
                  <div className="text-center py-3 bg-gray-50 rounded-lg">
                    <p className="text-[22px] font-bold text-[#1E2E34] tabular-nums">{fmt(result.summary.total_revenue)}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">Net Revenue</p>
                  </div>
                  <div className="text-center py-3 bg-gray-50 rounded-lg">
                    <p className="text-[22px] font-bold text-emerald-600 tabular-nums">{fmtSigned(result.summary.owner_payout)}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">Owner Payout</p>
                  </div>
                </div>

                {/* Line items */}
                <div className="grid grid-cols-2 gap-x-6">
                  <div className="flex justify-between py-2 border-b border-gray-50 text-[13px]">
                    <span className="text-gray-500">Management Fee</span>
                    <span className="text-gray-900 font-medium tabular-nums">{fmt(result.summary.management_fee)}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-50 text-[13px]">
                    <span className="text-gray-500">Stripe Fees</span>
                    <span className="text-gray-900 font-medium tabular-nums">{fmt(result.summary.stripe_fees)}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-50 text-[13px]">
                    <span className="text-gray-500">Cleaning</span>
                    <span className="text-gray-900 font-medium tabular-nums">{fmt(result.summary.cleaning_total)}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-50 text-[13px]">
                    <span className="text-gray-500">Data Gaps</span>
                    <span className={`font-medium ${result.summary.data_gaps > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {result.summary.data_gaps}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Reservation details */}
            {result.parsed_reservations.length > 0 && (
              <div className="bg-white rounded-lg border border-gray-100 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-50">
                  <h3 className="text-[13px] font-semibold text-gray-900">Parsed Reservations</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="bg-gray-50/80 text-[10px] text-gray-400 uppercase tracking-wider">
                        <th className="px-4 py-2.5 text-left font-medium">Guest</th>
                        <th className="px-3 py-2.5 text-left font-medium">Dates</th>
                        <th className="px-2 py-2.5 text-center font-medium">Nts</th>
                        <th className="px-3 py-2.5 text-left font-medium">Channel</th>
                        <th className="px-3 py-2.5 text-right font-medium">Guesty</th>
                        <th className="px-3 py-2.5 text-right font-medium">Stripe</th>
                        <th className="px-3 py-2.5 text-right font-medium">Net</th>
                        <th className="px-4 py-2.5 text-center font-medium">Bank</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.parsed_reservations.map((r, i) => (
                        <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="px-4 py-2.5 text-gray-900 font-medium">{r.guest_name}</td>
                          <td className="px-3 py-2.5 text-gray-500">
                            {fmtDate(r.check_in)} - {fmtDate(r.check_out)}
                          </td>
                          <td className="px-2 py-2.5 text-center text-gray-500">{r.nights}</td>
                          <td className="px-3 py-2.5"><PlatformPill platform={r.platform} /></td>
                          <td className="px-3 py-2.5 text-right text-gray-600 tabular-nums">{fmt(r.guesty_rental_income)}</td>
                          <td className="px-3 py-2.5 text-right text-gray-400 tabular-nums">
                            {r.stripe_fee > 0 ? `-${fmt(r.stripe_fee)}` : '--'}
                          </td>
                          <td className="px-3 py-2.5 text-right text-gray-900 font-medium tabular-nums">{fmt(r.adjusted_revenue)}</td>
                          <td className="px-4 py-2.5 text-center">
                            {r.bank_match_status === 'matched' ? (
                              <span className="text-emerald-500">
                                <svg className="w-3.5 h-3.5 inline" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
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

            {/* Actions */}
            <div className="flex gap-3">
              <button onClick={resetForm} className="px-5 py-2.5 bg-[#1E2E34] text-white rounded-lg text-[13px] font-medium hover:bg-[#2a3f47]">
                Upload Another
              </button>
              <Link href="/" className="px-5 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-[13px] font-medium hover:bg-gray-50">
                View Dashboard
              </Link>
            </div>
          </div>
        )}

        {/* UPLOAD FORM */}
        {!result && (
          <div className="space-y-5">
            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-100 rounded-lg px-4 py-3 flex items-center gap-2.5">
                <svg className="w-4 h-4 text-red-400 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/></svg>
                <p className="text-red-700 text-[13px]">{error}</p>
              </div>
            )}

            {/* Period & Property */}
            <div className="bg-white rounded-lg border border-gray-100">
              <div className="px-5 py-3 border-b border-gray-50">
                <h2 className="text-[13px] font-semibold text-gray-900">Period & Property</h2>
              </div>
              <div className="p-5">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[12px] font-medium text-gray-500 mb-1.5">Month</label>
                    <input
                      type="month"
                      value={month}
                      onChange={(e) => setMonth(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-[13px] focus:border-[#1E2E34] bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium text-gray-500 mb-1.5">Property</label>
                    <select
                      value={propertyId}
                      onChange={(e) => setPropertyId(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-[13px] focus:border-[#1E2E34] bg-white"
                    >
                      <option value="">Select property...</option>
                      {PROPERTIES.map(p => (
                        <option key={p.id} value={p.id}>{p.name} ({p.owner})</option>
                      ))}
                    </select>
                  </div>
                </div>
                {selectedProp && (
                  <p className="mt-3 text-[12px] text-gray-400">
                    Uploading for <span className="text-gray-700 font-medium">{selectedProp.name}</span> ({selectedProp.owner}) - {monthLabel(month)}
                  </p>
                )}
              </div>
            </div>

            {/* Files */}
            <div className="bg-white rounded-lg border border-gray-100">
              <div className="px-5 py-3 border-b border-gray-50">
                <h2 className="text-[13px] font-semibold text-gray-900">Files</h2>
              </div>
              <div className="p-5 space-y-3">
                {/* Guesty PDF */}
                <div className={`flex items-center justify-between rounded-lg border px-4 py-3 ${guestyPDF ? 'border-emerald-200 bg-emerald-50/50' : 'border-gray-100 bg-gray-50/50'}`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-8 h-8 rounded flex items-center justify-center shrink-0 ${guestyPDF ? 'bg-emerald-100 text-emerald-600' : 'bg-red-50 text-red-400'}`}>
                      {guestyPDF ? (
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-gray-900">
                        Guesty Owner Statement <span className="text-red-400">*</span>
                      </p>
                      <p className="text-[11px] text-gray-400 truncate">
                        {guestyPDF ? guestyPDF.name : 'PDF with reservation data'}
                      </p>
                    </div>
                  </div>
                  <label className={`shrink-0 ml-3 px-3 py-1.5 text-[11px] font-medium rounded cursor-pointer ${guestyPDF ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-[#1E2E34] text-white hover:bg-[#2a3f47]'}`}>
                    {guestyPDF ? 'Replace' : 'Choose'}
                    <input ref={pdfRef} type="file" accept=".pdf" className="hidden" onChange={(e) => setGuestyPDF(e.target.files?.[0] || null)} />
                  </label>
                </div>

                {/* Platform CSV */}
                <div className={`flex items-center justify-between rounded-lg border px-4 py-3 ${platformCSV ? 'border-emerald-200 bg-emerald-50/50' : 'border-gray-100 bg-gray-50/50'}`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-8 h-8 rounded flex items-center justify-center shrink-0 ${platformCSV ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-400'}`}>
                      {platformCSV ? (
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-gray-900">Platform CSV</p>
                      <p className="text-[11px] text-gray-400 truncate">
                        {platformCSV ? platformCSV.name : 'Maps reservations to channels & guest names'}
                      </p>
                    </div>
                  </div>
                  <label className={`shrink-0 ml-3 px-3 py-1.5 text-[11px] font-medium rounded cursor-pointer ${platformCSV ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'border border-gray-200 text-gray-600 hover:bg-gray-100'}`}>
                    {platformCSV ? 'Replace' : 'Choose'}
                    <input ref={platRef} type="file" accept=".csv" className="hidden" onChange={(e) => setPlatformCSV(e.target.files?.[0] || null)} />
                  </label>
                </div>

                {/* Bank CSV */}
                <div className={`flex items-center justify-between rounded-lg border px-4 py-3 ${bankCSV ? 'border-emerald-200 bg-emerald-50/50' : 'border-gray-100 bg-gray-50/50'}`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-8 h-8 rounded flex items-center justify-center shrink-0 ${bankCSV ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-400'}`}>
                      {bankCSV ? (
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-gray-900">Chase Bank CSV</p>
                      <p className="text-[11px] text-gray-400 truncate">
                        {bankCSV ? bankCSV.name : 'Verifies deposits & cleaning charges'}
                      </p>
                    </div>
                  </div>
                  <label className={`shrink-0 ml-3 px-3 py-1.5 text-[11px] font-medium rounded cursor-pointer ${bankCSV ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'border border-gray-200 text-gray-600 hover:bg-gray-100'}`}>
                    {bankCSV ? 'Replace' : 'Choose'}
                    <input ref={bankRef} type="file" accept=".csv" className="hidden" onChange={(e) => setBankCSV(e.target.files?.[0] || null)} />
                  </label>
                </div>

                {/* File status */}
                <div className="flex items-center gap-4 pt-1 text-[11px]">
                  <span className={guestyPDF ? 'text-emerald-600' : 'text-gray-300'}>
                    {guestyPDF ? '\u2713' : '\u25CB'} Statement
                  </span>
                  <span className={platformCSV ? 'text-emerald-600' : 'text-gray-300'}>
                    {platformCSV ? '\u2713' : '\u25CB'} Platform
                  </span>
                  <span className={bankCSV ? 'text-emerald-600' : 'text-gray-300'}>
                    {bankCSV ? '\u2713' : '\u25CB'} Bank
                  </span>
                </div>
              </div>
            </div>

            {/* Submit */}
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-gray-400">
                Re-uploading replaces existing data for this property/month.
              </p>
              <button
                onClick={handleSubmit}
                disabled={submitting || !propertyId || !guestyPDF}
                className="px-6 py-2.5 bg-[#1E2E34] text-white rounded-lg text-[13px] font-medium hover:bg-[#2a3f47] disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                    Processing...
                  </span>
                ) : (
                  'Process & Upload'
                )}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
