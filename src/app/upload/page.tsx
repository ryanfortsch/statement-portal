'use client';

import { useState } from 'react';
import Link from 'next/link';

const PROPERTIES = [
  { id: '3_south_st', name: '3 South St (Bailey)' },
  { id: '21_horton', name: '21 Horton St (Kittredge)' },
  { id: '53_rocky_neck', name: '53 Rocky Neck Ave (Prudenzi)' },
  { id: '4_brier_neck', name: '4 Brier Neck Rd (Armstrong)' },
  { id: '30_woodward', name: '30 Woodward Ave (McWethy)' },
  { id: '20_hammond', name: '20 Hammond St (Ramsey)' },
  { id: '20_enon', name: '20 Enon Rd (Snyder)' },
  { id: '73_rocky_neck', name: '73 Rocky Neck Ave (Moynahan)' },
  { id: '17_beach_rd', name: '17 Beach Rd (Nolan)' },
];

type IngestResult = {
  success: boolean;
  property: string;
  month: string;
  summary: {
    reservations: number;
    total_revenue: number;
    management_fee: number;
    cleaning_total: number;
    owner_payout: number;
    confidence: string;
    data_gaps: number;
  };
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

  async function handleSubmit() {
    if (!propertyId) {
      setError('Please select a property');
      return;
    }
    if (!guestyPDF) {
      setError('Please upload the Guesty owner statement PDF');
      return;
    }
    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('month', month);
      formData.append('property_id', propertyId);
      if (guestyPDF) formData.append('guesty_pdf', guestyPDF);
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

  const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-[#1E2E34] text-white px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Rising Tide</h1>
            <p className="text-gray-300 text-sm">Statement Data Upload</p>
          </div>
          <Link href="/" className="text-sm text-gray-300 hover:text-white underline">
            Back to Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        {/* Success Result */}
        {result && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-6">
            <h2 className="text-lg font-bold text-emerald-800 mb-2">Upload Successful</h2>
            <p className="text-emerald-700 mb-4">{result.property} - {result.month}</p>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-emerald-600">Reservations:</span> {result.summary.reservations}</div>
              <div><span className="text-emerald-600">Revenue:</span> {fmt(result.summary.total_revenue)}</div>
              <div><span className="text-emerald-600">Management Fee:</span> {fmt(result.summary.management_fee)}</div>
              <div><span className="text-emerald-600">Cleaning:</span> {fmt(result.summary.cleaning_total)}</div>
              <div><span className="text-emerald-600">Owner Payout:</span> {fmt(result.summary.owner_payout)}</div>
              <div><span className="text-emerald-600">Data Gaps:</span> {result.summary.data_gaps}</div>
            </div>
            <div className="mt-4 flex gap-4">
              <button
                onClick={() => { setResult(null); setGuestyPDF(null); setPlatformCSV(null); setBankCSV(null); }}
                className="text-sm text-emerald-700 underline"
              >
                Upload another property
              </button>
              <Link href="/" className="text-sm text-emerald-700 underline">
                View Dashboard
              </Link>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-700">{error}</p>
          </div>
        )}

        {!result && (
          <>
            {/* Month + Property Selection */}
            <section className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Statement Period</h2>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Month</label>
                  <input
                    type="month"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E2E34]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Property</label>
                  <select
                    value={propertyId}
                    onChange={(e) => setPropertyId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E2E34]"
                  >
                    <option value="">Select property...</option>
                    {PROPERTIES.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </section>

            {/* File Uploads */}
            <section className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Upload Files</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Guesty Owner Statement PDF <span className="text-red-400">*</span>
                    <span className="text-gray-400 ml-1">(reservations are extracted automatically)</span>
                  </label>
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={(e) => setGuestyPDF(e.target.files?.[0] || null)}
                    className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[#1E2E34] file:text-white hover:file:bg-[#2a3f47] file:cursor-pointer"
                  />
                  {guestyPDF && <p className="text-xs text-gray-400 mt-1">{guestyPDF.name}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Platform CSV <span className="text-gray-400">(from Guesty -- maps reservations to channels)</span>
                  </label>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={(e) => setPlatformCSV(e.target.files?.[0] || null)}
                    className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[#1E2E34] file:text-white hover:file:bg-[#2a3f47] file:cursor-pointer"
                  />
                  {platformCSV && <p className="text-xs text-gray-400 mt-1">{platformCSV.name}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Chase Bank CSV <span className="text-gray-400">(property bank account activity)</span>
                  </label>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={(e) => setBankCSV(e.target.files?.[0] || null)}
                    className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[#1E2E34] file:text-white hover:file:bg-[#2a3f47] file:cursor-pointer"
                  />
                  {bankCSV && <p className="text-xs text-gray-400 mt-1">{bankCSV.name}</p>}
                </div>
              </div>
            </section>

            {/* Submit */}
            <div className="flex justify-end">
              <button
                onClick={handleSubmit}
                disabled={submitting || !propertyId || !guestyPDF}
                className="px-8 py-3 bg-[#1E2E34] text-white rounded-lg font-medium hover:bg-[#2a3f47] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Processing...' : 'Process & Upload'}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
