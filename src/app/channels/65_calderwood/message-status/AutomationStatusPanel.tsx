import Link from 'next/link';
import type { AutomationLane, AutomationOperations } from '@/lib/channex-messaging/operations';

const workflows: Record<string, string> = {
  booking_confirmed: 'Reservation confirmed', pre_arrival: 'Check-in instructions', checkin_day: 'Key code',
  pre_checkout: 'Check-out reminder', cleaner_reminder: 'Cleaner · 10-day reminder', cleaner_arrival: 'Cleaner · arrival day',
};
const labels: Record<AutomationLane['state'], string> = {
  off: 'Off', configured: 'Configured for retained stays', receipts_only: 'Delivery checks only', invalid: 'Configuration needs review',
};
const instant = (value: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York',
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(value));
const day = (value: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })
  .format(new Date(`${value}T12:00:00Z`));
const card = { borderColor: 'var(--rule)', background: 'var(--paper-raised, #fff)' };
function Lane({ title, value, cleaner = false }: { title: string; value: AutomationLane; cleaner?: boolean }) {
  return <article className="rounded-2xl border p-5 sm:p-6" style={card}>
    <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted-foreground)' }}>{title}</p>
    <h2 className="mt-3 text-lg font-semibold">{labels[value.state]}</h2>
    <p className="mt-2 text-sm leading-6" style={{ color: 'var(--muted-foreground)' }}>
      {value.state === 'off' ? 'Helm sends no messages and checks no new delivery receipts in this lane. Existing records remain visible below.'
        : value.state === 'invalid' ? 'The sender cannot run with its current configuration. Existing attempts still need review.'
        : value.state === 'receipts_only' ? 'New sends are paused. Accepted SMS can still be checked for delivery.'
        : `${value.stays} reviewed ${value.stays === 1 ? 'stay is' : 'stays are'} configured. This does not confirm the worker ran or a message was sent.`}
    </p>
    <Link href={cleaner ? '/channels/65_calderwood/message-preparation/templates' : '/channels/65_calderwood/message-preparation'}
      className="mt-4 inline-flex text-sm font-medium underline underline-offset-4">{cleaner ? 'Review original templates and cleaner setup' : 'Review guest messages'} →</Link>
  </article>;
}

export function AutomationStatusPanel({ report }: { report: AutomationOperations }) {
  const attention = report.rows.filter(r => r.category === 'attention').length;
  return <div className="mt-7 space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p style={{ color: 'var(--muted-foreground)' }}>Loaded {instant(report.observedAt)} · refresh for current records</p>
      <form action="/channels/65_calderwood/message-status" method="get"><button className="rounded-lg border px-4 py-2 font-medium" style={{ borderColor: 'var(--rule)' }}>Refresh status</button></form>
    </div>
    <div className="grid gap-4 md:grid-cols-2" aria-label="Helm sender status">
      <Lane title="Guest messages · Channex" value={report.guest} />
      <Lane title="Cleaner texts · SMS" value={report.cleaner} cleaner />
    </div>
    <section className="rounded-2xl border p-5 sm:p-6" style={card} aria-labelledby="message-history-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 id="message-history-title" className="text-lg font-semibold">Schedules & delivery</h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>Helm records for 65 Calderwood · scheduled times shown in Eastern time</p></div>
        {report.history !== 'unavailable' && <span className="rounded-full border px-3 py-1 text-xs font-medium" style={{ borderColor: 'var(--rule)' }}>
          {attention ? `${attention} to review` : `${report.rows.length} records shown`}</span>}
      </div>
      {report.history === 'unavailable' ? <div role="status" className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-950">
        <p className="font-semibold">Message history could not be verified</p><p className="mt-2">The history was unavailable or changed during this check. Refresh before making a handover decision. This does not mean the queue is empty.</p>
      </div> : <>
        {report.history === 'partial' && <p role="status" className="mt-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-950">
          Showing the latest {report.rows.length} of {report.total} records. Older records, including unresolved attempts, are not checked here.</p>}
        {report.rows.length === 0 ? <div className="mt-5 rounded-xl border border-dashed p-7 text-center" style={{ borderColor: 'var(--rule)' }}>
          <h3 className="font-semibold">No Helm message records</h3><p className="mx-auto mt-2 max-w-lg text-sm leading-6" style={{ color: 'var(--muted-foreground)' }}>
            Guesty’s schedules and sent messages are separate. This does not confirm that Guesty or Airbnb has no queued messages.</p>
        </div> : <ul className="mt-5 divide-y" style={{ borderColor: 'var(--rule)' }} aria-label="Message records">
          {report.rows.map(row => <li key={row.id} className="grid gap-3 py-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-w-0"><h3 className="font-medium">{workflows[row.key ?? ''] ?? 'Message · workflow needs review'}</h3>
              <Link href={`/channels/bookings/${row.bookingId}`} className="mt-1 inline-block text-sm underline underline-offset-4">{day(row.start)} – {day(row.end)} stay</Link>
              <p className="mt-2 text-xs" style={{ color: 'var(--muted-foreground)' }}>Scheduled {instant(row.fireAt)}</p></div>
            <div className="min-w-0"><span className={`inline-block rounded-md px-2.5 py-1 text-xs font-semibold ${row.category === 'attention' ? 'bg-amber-50 text-amber-950' : row.category === 'recorded' ? 'bg-emerald-50 text-emerald-950' : 'bg-slate-100 text-slate-700'}`}>{row.state}</span>
              <p className="mt-2 text-sm leading-6" style={{ color: 'var(--muted-foreground)' }}>{row.note}</p></div>
          </li>)}
        </ul>}
      </>}
      <p className="mt-5 border-t pt-4 text-xs leading-5" style={{ borderColor: 'var(--rule)', color: 'var(--muted-foreground)' }}>
        Accepted means the provider accepted the message. Channex readback confirms the provider record, not guest delivery. Only an SMS delivery receipt is labeled delivered. This page cannot send, retry, cancel or release messages.</p>
    </section>
    <section className="rounded-2xl border p-5 sm:p-6" style={card} aria-labelledby="handover-next-title">
      <h2 id="handover-next-title" className="text-lg font-semibold">Before new bookings move to Helm</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6" style={{ color: 'var(--muted-foreground)' }}>
        These senders cover explicitly reviewed existing stays. Automatic enrollment of new Airbnb stays is not implemented. The 30-minute confirmation sender, arrival and departure rules, and source-message handover still need a verified end-to-end test.</p>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3 text-sm font-medium">
        <Link href="/channels/65_calderwood/sync-status" className="underline underline-offset-4">Check Airbnb & calendar connection →</Link>
        <Link href="/channels/65_calderwood/message-preparation/timing-review" className="underline underline-offset-4">Review retained stay times →</Link>
        <Link href="/channels/65_calderwood/cleaner-schedule" className="underline underline-offset-4">Review cleaner schedule →</Link>
      </div>
    </section>
  </div>;
}
