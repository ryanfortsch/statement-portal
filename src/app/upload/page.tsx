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

type ReservationEntry = {
  guest_name: string;
  confirmation_code: string;
  check_in: string;
  check_out: string;
  nights: number;
  rental_income: number;
};

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
  const [platformCSV, setPlatformCSV] = useState<File | null>(null);
  const [bankCSV, setBankCSV] = useState<File | null>(null);
  const [reservations, setReservations] = useState<ReservationEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function addReservation() {
    setReservations([...reservations, {
      guest_name: '',
      confirmation_code: '',
      check_in: '',
      check_out: '',
      nights: 0,
      rental_income: 0,
    }]);
  }

  function updateReservation(index: number, field: keyof ReservationEntry, value: string | number) {
    const updated = [...reservations];
    (updated[index] as Record<string, string | number>)[field] = value;
    // Auto-calculate nights
    if (field === 'check_in' || field === 'check_out') {
      const ci = field === 'check_in' ? value as string : updated[index].check_in;
      const co = field === 'check_out' ? value as string : updated[index].check_out;
      if (ci && co) {
        const diff = (new Date(co).getTime() - new Date(ci).getTime()) / (1000 * 60 * 60 * 24);
        if (diff > 0) updated[index].nights = Math.round(diff);
      }
    }
    setReservations(updated);
  }

  function removeReservation(index: number) {
    setReservations(reservations.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    if (!propertyId) {
      setError('Please select a property');
      return;
    }
    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('month', month);
      formData.append('property_id', propertyId);
      if (platformCSV) formData.append('platform_csv', platformCSV);
      if (bankCSV) formData.append('bank_csv', bankCSV);
      if (reservations.length > 0) {
        formData.append('guesty_data', JSON.stringify(reservations));
      }

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
                onClick={() => { setResult(null); setReservations([]); setPlatformCSV(null); setBankCSV(null); }}
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
                    Platform CSV <span className="text-gray-400">(from Guesty - maps reservations to channels)</span>
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

            {/* Reservation Entry (from Guesty Owner Statement) */}
            <section className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Reservations</h2>
                  <p className="text-sm text-gray-500">Enter from the Guesty Owner Statement PDF</p>
                </div>
                <button
                  onClick={addReservation}
                  className="px-4 py-2 bg-[#1E2E34] text-white text-sm rounded-lg hover:bg-[#2a3f47]"
                >
                  + Add Reservation
                </button>
              </div>

              {reservations.length === 0 && (
                <p className="text-gray-400 text-sm text-center py-8">
                  No reservations added yet. Click &quot;Add Reservation&quot; to enter data from the Guesty owner statement.
                </p>
              )}

              {reservations.map((res, i) => (
                <div key={i} className="border border-gray-100 rounded-lg p-4 mb-3 bg-gray-50">
                  <div className="flex justify-between items-start mb-3">
                    <span className="text-xs font-medium text-gray-400">Reservation {i + 1}</span>
                    <button onClick={() => removeReservation(i)} className="text-red-400 text-xs hover:text-red-600">Remove</button>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Guest Name</label>
                      <input
                        type="text"
                        value={res.guest_name}
                        onChange={(e) => updateReservation(i, 'guest_name', e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                        placeholder="e.g. Smith"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Confirmation Code</label>
                      <input
                        type="text"
                        value={res.confirmation_code}
                        onChange={(e) => updateReservation(i, 'confirmation_code', e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                        placeholder="e.g. HMXXXXXXXX"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Rental Income ($)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={res.rental_income || ''}
                        onChange={(e) => updateReservation(i, 'rental_income', parseFloat(e.target.value) || 0)}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Check In</label>
                      <input
                        type="date"
                        value={res.check_in}
                        onChange={(e) => updateReservation(i, 'check_in', e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Check Out</label>
                      <input
                        type="date"
                        value={res.check_out}
                        onChange={(e) => updateReservation(i, 'check_out', e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Nights</label>
                      <input
                        type="number"
                        value={res.nights || ''}
                        onChange={(e) => updateReservation(i, 'nights', parseInt(e.target.value) || 0)}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm bg-gray-100"
                        readOnly
                      />
                    </div>
                  </div>
                </div>
              ))}
            </section>

            {/* Submit */}
            <div className="flex justify-end">
              <button
                onClick={handleSubmit}
                disabled={submitting || !propertyId}
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
