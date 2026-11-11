import type { InventoryOperations } from '@/lib/channex-inventory/operations';
import { inventoryAttemptLabel, inventoryOperationsMessage } from '@/lib/channex-inventory/operations';
const time = (value: number) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }).format(value);
export function InventoryStatusPanel({ report }: { report: InventoryOperations | null }) {
  if (!report) return <section role="alert" className="mt-7 rounded-2xl border p-7" style={{ borderColor: 'var(--signal)' }}>
    <h2 className="text-xl font-semibold">Calendar sync status unavailable</h2>
    <p className="mt-2 text-sm leading-6">The connection history could not be verified. Refresh to try again; this does not mean the queue is empty.</p>
  </section>;
  const message = inventoryOperationsMessage(report);
  return <div className="mt-7 space-y-6">
    <section className="rounded-2xl border p-6 sm:p-8" style={{ borderColor: 'var(--rule)', background: 'var(--paper-2)' }}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs uppercase tracking-widest opacity-60">Availability · 65 Calderwood</p>
          <h2 className="mt-2 text-2xl font-semibold">{message.title}</h2></div>
        <span className="rounded-full border px-3 py-1 text-xs font-medium" style={{ borderColor: message.tone === 'attention' ? 'var(--signal)' : 'var(--rule)' }}>
          {report.authority === 'guesty' ? 'Guesty controls calendar' : 'Helm controls calendar'}</span>
      </div>
      <p className="mt-3 max-w-2xl text-sm leading-6 opacity-80">{message.detail}</p>
      <p className="mt-5 text-xs opacity-60">Checked {time(report.observedAt)} · refresh for the latest state</p>
    </section>
    <section aria-label="Availability update counts" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[
        ['Current attempt', report.active ? '1' : '0', report.active ? 'One saved attempt is being tracked' : 'No pending attempt in this ledger'],
        ['Accepted by Channex', String(report.counts.accepted), 'Provider acceptance; channel delivery unverified'],
        ['Earlier unknown outcomes', String(report.counts.historicalUnknown), 'Replaced attempts retained for review'],
        ['Consecutive recoveries', `${report.consecutiveRecoveries} / 3`, 'Stops at the limit until reviewed or resolved'],
      ].map(([label,value,detail]) => <div key={label} className="rounded-xl border p-5" style={{ borderColor:'var(--rule)' }}>
        <h3 className="text-xs font-medium opacity-70">{label}</h3><p className="mt-3 text-3xl font-semibold tabular-nums">{value}</p>
        <p className="mt-3 text-xs leading-5 opacity-60">{detail}</p>
      </div>)}
    </section>
    <section className="overflow-hidden rounded-2xl border" style={{ borderColor:'var(--rule)' }}>
      <div className="border-b px-6 py-5" style={{ borderColor:'var(--rule)' }}><h2 className="font-semibold">Recent availability updates</h2>
        <p className="mt-1 text-xs opacity-60">Latest eight attempts · all times Eastern</p></div>
      {report.recent.length === 0 ? <div className="px-6 py-9"><p className="font-medium">No availability updates have been attempted</p>
        <p className="mt-2 text-sm opacity-70">This connection has no recorded send history. Existing Guesty messages and calendar activity are separate.</p></div>
        : <ol className="divide-y" style={{ borderColor:'var(--rule)' }}>{report.recent.map((row,index) => <li key={`${row.createdAt}-${index}`} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div><p className="text-sm font-medium">{inventoryAttemptLabel(row)}</p><p className="mt-1 text-xs opacity-60">Prepared {time(row.createdAt)}</p></div>
          <p className="text-xs opacity-60">{row.recordedAt ? `Response recorded ${time(row.recordedAt)}` : 'No response recorded'}</p>
        </li>)}</ol>}
    </section>
    <aside className="rounded-xl border px-6 py-5 text-sm leading-6" style={{ borderColor:'var(--rule)' }}>
      <p><strong>Acceptance is not channel delivery.</strong> This page cannot confirm that Airbnb applied an update. PriceLabs continues to own prices and minimum stays.</p>
      <p className="mt-2 opacity-70">This is a read-only status view. It cannot enable sending, retry an update or switch the calendar.</p>
    </aside>
  </div>;
}
