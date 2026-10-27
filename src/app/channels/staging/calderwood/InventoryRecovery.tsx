'use client';
import { useState } from 'react';
import type { inventoryRecoveryView } from '@/lib/channex-staging/inventory-recovery';
type View = ReturnType<typeof inventoryRecoveryView>;
const endpoint = '/api/channels/staging/inventory-recovery';
export default function InventoryRecovery({ enabled }: { enabled: boolean }) {
  const [view, setView] = useState<View | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function run(action: 'status' | 'prepare' | 'execute') {
    setBusy(true); setMessage(''); setReviewed(false);
    try {
      const response = await fetch(endpoint, action === 'status' ? { cache: 'no-store' } : {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(action === 'execute' && view?.job ? { binding: { id: view.job.id, digest: view.job.digest } } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error ?? 'Recovery unavailable');
      setView(data); setReviewed(action === 'prepare');
      if (data.result) setMessage(`Recovery ${data.result.status}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Refresh status before continuing.'); }
    finally { setBusy(false); }
  }
  const canCheck = view?.job && ['submitted', 'uncertain'].includes(view.job.status);
  return <section className="space-y-3 rounded-lg border p-5" aria-labelledby="inventory-recovery">
    <h2 id="inventory-recovery" className="text-lg font-semibold">Recover availability sync</h2>
    <p className="text-sm">Review and resend all 500 dates in a prepared staging recovery window. Prices and minimum stays remain with PriceLabs. The booking window stays at 365 days.</p>
    {!enabled && <p className="text-sm text-amber-900">Recovery is not enabled in this preview.</p>}
    <div className="flex flex-wrap gap-3">
      <button disabled={!enabled || busy} onClick={() => run('status')} className="rounded border px-3 py-2 disabled:opacity-50">Refresh status</button>
      <button disabled={!enabled || busy || view?.days !== 500} onClick={() => run('prepare')} className="rounded border px-3 py-2 disabled:opacity-50">Review recovery</button>
      <button disabled={!enabled || busy || (!canCheck && !reviewed)} onClick={() => run('execute')} className="rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50">{canCheck ? 'Check task completion' : 'Send reviewed full sync'}</button>
    </div>
    {view && <div className="space-y-2 text-sm"><p>Configured range: {view.start} through {view.end} (exclusive), {view.days} dates.</p>
      {view.days !== 500 && <p>A reviewed 500-day window must be prepared before this control can send. This action does not expand the configured window.</p>}
      {view.job && <><p>Last 500-day intent: {view.job.firstDate} through {view.job.lastDate}; {view.job.availableDays} available dates. Status: <strong>{view.job.status}</strong>.</p>
        {view.job.task && <p>Channex task: <code>{view.job.task}</code></p>}</>}
    </div>}
    {busy && <p role="status">Checking staging recovery…</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
