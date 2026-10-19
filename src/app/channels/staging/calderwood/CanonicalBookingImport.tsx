'use client';
import { useState } from 'react';
export function CanonicalBookingImport({ enabled }: { enabled: boolean }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function run() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/channels/staging/canonical-revisions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(300000),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'Import incomplete.');
      setMessage(`Received ${data.received}; saved ${data.applied}; retained older revisions ${data.stale}; acknowledged ${data.acknowledged}. Initial calendar coverage and live delivery remain unverified.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Import incomplete. Retry is safe; no messages were sent.');
    } finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-lg border p-5" aria-labelledby="canonical-booking-import">
    <h2 id="canonical-booking-import" className="text-lg font-semibold">Booking integration rehearsal</h2>
    <p className="text-sm">Bring synthetic Calderwood bookings from Channex into Helm’s test calendar. New stays, date changes and cancellations use the same calendar functions as Helm. A cancellation stops waiting test messages.</p>
    <p className="text-sm text-slate-600">This uses a fictional Helm property. Guesty continues running the real home. It does not send messages or prove live channel delivery.</p>
    {!enabled && <p className="text-sm text-amber-900">Pending staging database installation and activation.</p>}
    <button type="button" onClick={run} disabled={!enabled || busy}
      className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? 'Importing…' : 'Import test booking changes'}</button>
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
