'use client';
import { useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Button } from '@/components/Button';
import { timingReviewOverviewSchema, type TimingReviewOverview } from '@/lib/channex-messaging/timing-review-contract';

const endpoint = '/api/channex/message-preparation/timing-review';
const day = (s: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${s}T12:00:00Z`));
const stamp = (s: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(s));
const clock = (s: string) => { const [h, m] = s.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const subscribe = (change: () => void) => { window.addEventListener('storage', change); window.addEventListener('helm-timing-attempt', change);
  return () => { window.removeEventListener('storage', change); window.removeEventListener('helm-timing-attempt', change); }; };
const emptySnapshot = () => null;
const labels = { past: 'Stay ended', waiting_handover: 'Waiting for handover', needs_matching: 'Reservation match needs review', ready: 'Ready for provider review' };

function Stay({ stay, captureId, disabled }: { stay: TimingReviewOverview['stays'][number]; captureId: string; disabled: boolean }) {
  const key = `helm-timing-review:${captureId}:${stay.bookingId}`;
  const attempt = useSyncExternalStore(subscribe, () => { try { return localStorage.getItem(key); } catch { return 'storage-unavailable'; } }, emptySnapshot);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const running = useRef(false);
  async function review() {
    if (running.current || disabled || stay.state !== 'ready' || stay.review) return;
    running.current = true; setBusy(true); setMessage('');
    try {
      // Persist before POST. A reload, timeout or lost response must never rotate
      // an uncertain review ID and submit another write automatically.
      const bindingId = await navigator.locks.request(key, () => {
        if (localStorage.getItem(key)) throw Error();
        const id = crypto.randomUUID(); localStorage.setItem(key, id); return id;
      });
      window.dispatchEvent(new Event('helm-timing-attempt'));
      const res = await fetch(endpoint, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'review_timing', bindingId, captureId, bookingId: stay.bookingId }), signal: AbortSignal.timeout(125000) });
      const out = await res.json();
      if (!res.ok || out.bindingId !== bindingId || !['created', 'existing'].includes(out.state)
        || out.canSend !== false || out.jobsCreated !== 0 || out.messagesSent !== 0) throw Error();
      setMessage('Review saved. Refresh saved status to read it back. No messages were scheduled or sent.');
    } catch { setMessage('The review was not confirmed. Refresh saved status to check for a saved record. This attempt will not be sent again.'); }
    finally { setBusy(false); running.current = false; }
  }
  return <article className="rounded-2xl border p-5 sm:p-6" style={{ borderColor: 'var(--rule)', background: 'var(--paper)' }}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="font-semibold text-lg">{day(stay.start)} – {day(stay.end)}</h3>
        <Link href={`/channels/bookings/${stay.bookingId}`} className="mt-1 inline-block text-sm underline underline-offset-4">Open reservation</Link></div>
      <span className="rounded-full px-3 py-1 text-xs font-medium" style={{ background: 'var(--paper-2)', color: 'var(--ink-3)' }}>{stay.review
        ? stay.review.currentContext ? 'Review saved' : 'Review needs rechecking' : labels[stay.state]}</span>
    </div>
    <dl className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
      <div><dt style={{ color: 'var(--ink-3)' }}>Captured arrival</dt><dd className="mt-1 font-medium">{clock(stay.arrival)}</dd></div>
      <div><dt style={{ color: 'var(--ink-3)' }}>Captured departure</dt><dd className="mt-1 font-medium">{clock(stay.departure)}</dd></div>
      <div className="col-span-2 sm:col-span-1"><dt style={{ color: 'var(--ink-3)' }}>Booking confirmed</dt><dd className="mt-1 font-medium">{stamp(stay.confirmedAt)}</dd></div>
    </dl>
    <div className="mt-5 border-t pt-4 text-sm leading-6" style={{ borderColor: 'var(--rule)' }}>
      {stay.review ? <p><strong>Saved review · {stamp(stay.review.reviewedAt)}</strong><br />{stay.review.currentContext
        ? 'The saved review still matches Helm’s records. Provider details must be checked again before scheduling.'
        : 'The saved review no longer matches the current handover or reservation. It cannot be used for scheduling.'}</p>
        : <p style={{ color: 'var(--ink-3)' }}>{stay.state === 'waiting_handover'
          ? 'Saved as historical evidence. Queue clearance and an approved handover must be recorded before a current review.'
          : stay.state === 'needs_matching' ? 'The captured stay must match its current Guesty reservation and Channex booking.'
          : stay.state === 'past' ? 'Retained for reference. Past stays cannot enter a new message schedule.'
          : 'Compare Guesty’s current times and Channex’s booking and conversation twice, then save this review.'}</p>}
      {!stay.review && <div className="mt-4"><Button type="button" onClick={review} pending={busy} watchdog={false}
        disabled={disabled || stay.state !== 'ready' || Boolean(attempt)}>{busy ? 'Checking both systems…' : 'Verify and save review'}</Button></div>}
      <p role="status" className="mt-3 text-sm" style={{ color: 'var(--ink-3)' }}>{attempt && stay.review?.id === attempt
        ? 'Saved record confirmed. No new review was submitted.'
        : message || (attempt ? 'A previous attempt needs checking. Refresh saved status; this will only read records.' : '')}</p>
      {attempt && attempt !== 'storage-unavailable' && !stay.review && <details className="mt-2 text-xs" style={{ color: 'var(--ink-3)' }}>
        <summary className="cursor-pointer">Review reference</summary><p className="mt-1 break-all">{attempt}</p></details>}
    </div>
  </article>;
}

export function ReviewPanel({ initial }: { initial: TimingReviewOverview | null }) {
  const [data, setData] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function refresh() {
    setBusy(true); setError('');
    try { const res = await fetch(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw Error(); setData(timingReviewOverviewSchema.parse(await res.json()));
    } catch { setError('Saved status is unavailable. The last view is not a current verification. Try refreshing when the connection is available.'); }
    finally { setBusy(false); }
  }
  const handedOver = data?.handoverRecorded && data.authority === 'helm' && data.automationsEnabled;
  const reviewed = data?.stays.filter(s => s.review).length ?? 0;
  return <>
    <section className="mt-6 rounded-2xl border p-6 sm:p-8" style={{ borderColor: 'var(--rule)', background: 'var(--paper-2)' }}>
      <div className="flex flex-wrap justify-between items-start gap-5">
        <div className="max-w-2xl"><p className="eyebrow" style={{ color: 'var(--signal)' }}>Saved evidence · 65 Calderwood</p>
          <h2 className="mt-2 text-2xl font-semibold">{!data ? 'Saved status unavailable' : handedOver ? 'Timing reviews can be checked' : 'Waiting for the messaging handover'}</h2>
          <p className="mt-3 text-sm leading-6" style={{ color: 'var(--ink-3)' }}>{data?.authority === 'guesty'
            ? 'Guesty remains in control. The saved timing evidence is ready to compare after queue clearance and the approved switch.'
            : 'A timing review records a comparison of the two systems. Scheduling and sending remain separate steps.'}</p></div>
        <Button type="button" onClick={refresh} pending={busy}>{busy ? 'Reading saved status…' : 'Refresh saved status'}</Button>
      </div>
      <ol className="mt-7 grid gap-3 sm:grid-cols-3 text-sm">
        {[['1', 'Capture original timing', data?.capture ? `${data.stays.length} stays saved` : 'No capture confirmed'],
          ['2', 'Record the handover', handedOver ? 'Handover recorded' : 'Queue clearance and switch pending'],
          ['3', 'Verify each stay', `${reviewed} saved ${reviewed === 1 ? 'review' : 'reviews'}`]].map(([n, title, detail]) =>
          <li key={n} className="rounded-xl border p-4" style={{ borderColor: 'var(--rule)', background: 'var(--paper)' }}>
            <span className="text-xs" style={{ color: 'var(--ink-3)' }}>STEP {n}</span><p className="mt-2 font-semibold">{title}</p><p className="mt-1 text-xs leading-5" style={{ color: 'var(--ink-3)' }}>{detail}</p></li>)}
      </ol>
      <p className="mt-5 text-xs leading-5" style={{ color: 'var(--ink-3)' }}>Refreshing reads saved records only. Verifying a stay makes no provider changes and creates no messages.</p>
    </section>
    {error && <p role="alert" className="mt-5 border-l-4 p-4 text-sm" style={{ borderColor: 'var(--negative)' }}>{error}</p>}
    <section className="mt-8" aria-labelledby="saved-stays">
      <div className="mb-5"><h2 id="saved-stays" className="text-xl font-semibold">Captured stays</h2>
        <p className="mt-2 text-sm leading-6" style={{ color: 'var(--ink-3)' }}>{data?.capture
          ? `Source times checked ${stamp(data.capture.checkedAt)}. These are historical observations, not a live schedule.`
          : 'No saved capture has been loaded. Refresh status before taking another capture.'}</p></div>
      <div className="grid gap-4">{data?.capture && data.stays.map(stay => <Stay key={`${data.capture!.id}:${stay.bookingId}`}
        stay={stay} captureId={data.capture!.id} disabled={busy || Boolean(error) || !handedOver} />)}</div>
      {data?.stays.length === 0 && <p className="rounded-xl border p-6 text-sm" style={{ borderColor: 'var(--rule)' }}>No stays in the latest saved capture.</p>}
    </section>
  </>;
}
