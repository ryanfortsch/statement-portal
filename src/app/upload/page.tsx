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

  const confidenceLabel = (c: string) => {
    if (c === 'green') return { text: 'High', color: 'bg-emerald-100 text-emerald-800' };
    if (c === 'yellow') return { text: 'Medium', color: 'bg-amber-100 text-amber-800' };
    return { text: 'Low', color: 'bg-red-100 text-red-800' };
  };

  const monthLabel = (m: string) => {
    const [y, mo] = m.split('-');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[parseInt(mo) - 1]} ${y}`;
  };

  return (
    <div className="min-h-screen bg-[#F7F8F9]">
      {/* Header */}
      <header className="bg-[#1E2E34] border-b border-[#2a3f47]">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#C9A84C] rounded flex items-center justify-center">
              <span className="text-white font-bold text-sm">RT</span>
            </div>
            <div>
              <h1 className="text-white font-semibold text-lg leading-tight">Statement Upload</h1>
              <p className="text-gray-400 text-xs">Upload owner statement data for processing</p>
            </div>
          </div>
          <Link href="/" className="text-sm text-gray-400 hover:text-white transition-colors">
            Back to Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">

        {/* SUCCESS VIEW */}
        {result && (
          <div className="space-y-6">
            {/* Summary Card */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="bg-emerald-600 px-6 py-4 flex items-center justify-between">
                <div>
                  <h2 className="text-white font-semibold text-lg">Upload Successful</h2>
                  <p className="text-emerald-100 text-sm">{result.property} -- {monthLabel(result.month)}</p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${confidenceLabel(result.summary.confidence).color}`}>
                  {confidenceLabel(result.summary.confidence).text} Confidence
                </span>
              </div>

              <div className="p-6">
                <div className="grid grid-cols-3 gap-6">
                  <div className="text-center p-4 bg-gray-50 rounded-lg">
                    <p className="text-2xl font-bold text-gray-900">{result.summary.reservations}</p>
                    <p className="text-xs text-gray-500 mt-1">Reservations</p>
                  </div>
                  <div className="text-center p-4 bg-gray-50 rounded-lg">
                    <p className="text-2xl font-bold text-gray-900">{fmt(result.summary.total_revenue)}</p>
                    <p className="text-xs text-gray-500 mt-1">Net Revenue</p>
                  </div>
                  <div className="text-center p-4 bg-gray-50 rounded-lg">
                    <p className="text-2xl font-bold text-gray-900">{fmtSigned(result.summary.owner_payout)}</p>
                    <p className="text-xs text-gray-500 mt-1">Owner Payout</p>
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-gray-500">Management Fee</span>
                    <span className="text-gray-900 font-medium">{fmt(result.summary.management_fee)}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-gray-500">Stripe Fees</span>
                    <span className="text-gray-900 font-medium">{fmt(result.summary.stripe_fees)}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-gray-500">Cleaning Total</span>
                    <span className="text-gray-900 font-medium">{fmt(result.summary.cleaning_total)}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-gray-500">Data Gaps</span>
                    <span className={`font-medium ${result.summary.data_gaps > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {result.summary.data_gaps}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Reservation Details */}
            {result.parsed_reservations.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100">
                  <h3 className="font-semibold text-gray-900">Parsed Reservations</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                        <th className="px-4 py-3 text-left font-medium">Guest</th>
                        <th className="px-4 py-3 text-left font-medium">Code</th>
                        <th className="px-4 py-3 text-left font-medium">Dates</th>
                        <th className="px-4 py-3 text-center font-medium">Nights</th>
                        <th className="px-4 py-3 text-left font-medium">Platform</th>
                        <th className="px-4 py-3 text-right font-medium">Guesty</th>
                        <th className="px-4 py-3 text-right font-medium">Stripe Fee</th>
                        <th className="px-4 py-3 text-right font-medium">Net Revenue</th>
                        <th className="px-4 py-3 text-center font-medium">Bank</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {result.parsed_reservations.map((r, i) => (
                        <tr key={i} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 text-gray-900 font-medium">{r.guest_name}</td>
                          <td className="px-4 py-3 text-gray-500 font-mono text-xs">{r.confirmation_code}</td>
                          <td className="px-4 py-3 text-gray-600 text-xs">
                            {r.check_in} to {r.check_out}
                          </td>
                          <td className="px-4 py-3 text-center text-gray-600">{r.nights}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                              r.platform === 'Airbnb' ? 'bg-rose-50 text-rose-700' :
                              r.platform === 'HomeAway' ? 'bg-blue-50 text-blue-700' :
                              r.platform === 'Manual' ? 'bg-purple-50 text-purple-700' :
                              r.platform === 'Booking.com' ? 'bg-indigo-50 text-indigo-700' :
                              'bg-gray-100 text-gray-600'
                            }`}>
                              {r.platform}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-gray-600">{fmt(r.guesty_rental_income)}</td>
                          <td className="px-4 py-3 text-right text-gray-400">
                            {r.stripe_fee > 0 ? `-${fmt(r.stripe_fee)}` : '--'}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-900 font-medium">{fmt(r.adjusted_revenue)}</td>
                          <td className="px-4 py-3 text-center">
                            {r.bank_match_status === 'matched' ? (
                              <span className="inline-block w-5 h-5 bg-emerald-100 text-emerald-600 rounded-full text-xs leading-5">&#10003;</span>
                            ) : (
                              <span className="inline-block w-5 h-5 bg-amber-100 text-amber-600 rounded-full text-xs leading-5">?</span>
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
              <button onClick={resetForm} className="px-5 py-2.5 bg-[#1E2E34] text-white rounded-lg text-sm font-medium hover:bg-[#2a3f47] transition-colors">
                Upload Another Property
              </button>
              <Link href="/" className="px-5 py-2.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
                View Dashboard
              </Link>
            </div>
          </div>
        )}

        {/* UPLOAD FORM */}
        {!result && (
          <div className="space-y-6">
            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 flex items-start gap-3">
                <span className="text-red-500 text-lg leading-none mt-0.5">!</span>
                <div>
                  <p className="text-red-800 font-medium text-sm">Upload Error</p>
                  <p className="text-red-600 text-sm mt-0.5">{error}</p>
                </div>
              </div>
            )}

            {/* Step 1: Period & Property */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
                <span className="w-6 h-6 bg-[#1E2E34] text-white rounded-full text-xs flex items-center justify-center font-medium">1</span>
                <h2 className="font-semibold text-gray-900">Select Period & Property</h2>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Statement Month</label>
                    <input
                      type="month"
                      value={month}
                      onChange={(e) => setMonth(e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1E2E34] focus:border-transparent transition-shadow"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Property</label>
                    <select
                      value={propertyId}
                      onChange={(e) => setPropertyId(e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1E2E34] focus:border-transparent transition-shadow"
                    >
                      <option value="">Select property...</option>
                      {PROPERTIES.map(p => (
                        <option key={p.id} value={p.id}>{p.name} ({p.owner})</option>
                      ))}
                    </select>
                  </div>
                </div>
                {selectedProp && (
                  <div className="mt-4 px-4 py-3 bg-[#F0F1EE] rounded-lg text-sm text-gray-600">
                    Ready to upload for <span className="font-medium text-gray-900">{selectedProp.name}</span> ({selectedProp.owner}) -- {monthLabel(month)}
                  </div>
                )}
              </div>
            </div>

            {/* Step 2: File Uploads */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
                <span className="w-6 h-6 bg-[#1E2E34] text-white rounded-full text-xs flex items-center justify-center font-medium">2</span>
                <h2 className="font-semibold text-gray-900">Upload Files</h2>
              </div>
              <div className="p-6 space-y-5">
                {/* Guesty PDF */}
                <div className={`border-2 border-dashed rounded-xl p-5 transition-colors ${guestyPDF ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${guestyPDF ? 'bg-emerald-200' : 'bg-red-50'}`}>
                        <span className="text-lg">{guestyPDF ? '\u2713' : '\u2191'}</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          Guesty Owner Statement
                          <span className="text-red-500 ml-1">*</span>
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {guestyPDF ? guestyPDF.name : 'PDF from Guesty -- reservations are extracted automatically'}
                        </p>
                      </div>
                    </div>
                    <label className="px-4 py-2 bg-[#1E2E34] text-white text-xs font-medium rounded-lg cursor-pointer hover:bg-[#2a3f47] transition-colors">
                      {guestyPDF ? 'Replace' : 'Choose PDF'}
                      <input ref={pdfRef} type="file" accept=".pdf" className="hidden" onChange={(e) => setGuestyPDF(e.target.files?.[0] || null)} />
                    </label>
                  </div>
                </div>

                {/* Platform CSV */}
                <div className={`border-2 border-dashed rounded-xl p-5 transition-colors ${platformCSV ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${platformCSV ? 'bg-emerald-200' : 'bg-gray-100'}`}>
                        <span className="text-lg">{platformCSV ? '\u2713' : '\u2191'}</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">Platform CSV</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {platformCSV ? platformCSV.name : 'From Guesty -- maps reservations to booking channels and guest names'}
                        </p>
                      </div>
                    </div>
                    <label className="px-4 py-2 border border-gray-300 text-gray-700 text-xs font-medium rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                      {platformCSV ? 'Replace' : 'Choose CSV'}
                      <input ref={platRef} type="file" accept=".csv" className="hidden" onChange={(e) => setPlatformCSV(e.target.files?.[0] || null)} />
                    </label>
                  </div>
                </div>

                {/* Bank CSV */}
                <div className={`border-2 border-dashed rounded-xl p-5 transition-colors ${bankCSV ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${bankCSV ? 'bg-emerald-200' : 'bg-gray-100'}`}>
                        <span className="text-lg">{bankCSV ? '\u2713' : '\u2191'}</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">Chase Bank CSV</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {bankCSV ? bankCSV.name : 'Property bank account activity -- verifies deposits and cleaning charges'}
                        </p>
                      </div>
                    </div>
                    <label className="px-4 py-2 border border-gray-300 text-gray-700 text-xs font-medium rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                      {bankCSV ? 'Replace' : 'Choose CSV'}
                      <input ref={bankRef} type="file" accept=".csv" className="hidden" onChange={(e) => setBankCSV(e.target.files?.[0] || null)} />
                    </label>
                  </div>
                </div>

                {/* File status summary */}
                <div className="flex items-center gap-4 pt-2 text-xs text-gray-500">
                  <span className={guestyPDF ? 'text-emerald-600' : 'text-gray-400'}>
                    {guestyPDF ? '\u2713' : '\u25CB'} Owner Statement
                  </span>
                  <span className={platformCSV ? 'text-emerald-600' : 'text-gray-400'}>
                    {platformCSV ? '\u2713' : '\u25CB'} Platform CSV
                  </span>
                  <span className={bankCSV ? 'text-emerald-600' : 'text-gray-400'}>
                    {bankCSV ? '\u2713' : '\u25CB'} Bank CSV
                  </span>
                </div>
              </div>
            </div>

            {/* Submit */}
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-400">
                Uploads can be re-run -- existing data for this property/month will be replaced.
              </p>
              <button
                onClick={handleSubmit}
                disabled={submitting || !propertyId || !guestyPDF}
                className="px-8 py-3 bg-[#1E2E34] text-white rounded-xl font-medium text-sm hover:bg-[#2a3f47] disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-md"
              >
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
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
