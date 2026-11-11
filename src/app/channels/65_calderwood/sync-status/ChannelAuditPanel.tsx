import { auditProductionChannelEnvironment, ChannelAuditError, type ChannelAudit } from '@/lib/channex-channel-audit';

export async function ChannelAuditSection() {
  let report: ChannelAudit | null = null;
  let changed = false;
  try { report = await auditProductionChannelEnvironment(process.env); }
  catch (error) { changed = error instanceof ChannelAuditError && error.code === 'CHANGED_DURING_CHECK'; }
  return <ChannelAuditPanel report={report} changed={changed} />;
}

export function ChannelAuditPanel({ report, changed = false }: { report: ChannelAudit | null; changed?: boolean }) {
  const title = !report ? 'Channel connection could not be verified'
    : report.status === 'not-connected' ? 'Airbnb is not connected through Channex'
    : report.status === 'needs-review' ? 'Channel setup needs review' : 'Reviewed mapping matches';
  return <section aria-labelledby="channel-review-title" className="mt-7 overflow-hidden rounded-2xl border" style={{ borderColor:'var(--rule)', background:'var(--paper-2)' }}>
    <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-6 sm:px-8">
      <div><p className="text-xs uppercase tracking-widest opacity-60">Channel connection</p>
        <h2 id="channel-review-title" className="mt-2 text-xl font-semibold">{title}</h2></div>
      <span className="rounded-full border px-3 py-1 text-xs" style={{ borderColor:'var(--rule)' }}>Read-only review</span>
    </div>
    <div className="px-6 pb-6 sm:px-8">
      {!report ? <p role="alert" className="max-w-2xl text-sm leading-6">{changed
        ? 'The connection changed while it was being checked. Refresh for a new review before taking any handover action.'
        : 'Channex did not provide a complete, current check. Refresh to try again. This does not establish that there are no connections.'}</p>
        : report.status === 'not-connected' ? <p className="max-w-2xl text-sm leading-6 opacity-80">Channex returned no connections for Calderwood in two matching checks. The Airbnb handover is still ahead; this page does not connect or activate it.</p>
          : <>
            <div className="mb-5 flex flex-wrap gap-x-6 gap-y-2 text-sm opacity-75">
              <span>{report.channelCount} connection{report.channelCount === 1 ? '' : 's'}</span>
              <span>{report.activeChannels} active</span><span>{report.mappedRates} mapped rate{report.mappedRates === 1 ? '' : 's'}</span>
            </div>
            <ul className="grid gap-3 md:grid-cols-2" aria-label="Channel mapping checks">{report.checks.map(check =>
              <li key={check.key} className="flex items-start gap-3 rounded-xl border bg-[var(--paper)] p-4" style={{ borderColor:'var(--rule)' }}>
                <span aria-hidden="true" className="mt-0.5 font-semibold">{check.passed ? '✓' : '—'}</span>
                <div><p className="text-sm leading-5">{check.label}</p><p className="mt-1 text-xs opacity-60">{check.passed ? 'Verified in this check' : 'Needs review'}</p></div>
              </li>)}</ul>
          </>}
      {report && <p className="mt-4 text-xs opacity-60">Checked {new Intl.DateTimeFormat('en-US', { timeZone:'America/New_York', month:'short', day:'numeric', hour:'numeric', minute:'2-digit', second:'2-digit', timeZoneName:'short' }).format(report.checkedAt)}</p>}
    </div>
    <div className="border-t px-6 py-4 text-xs leading-5 opacity-75 sm:px-8" style={{ borderColor:'var(--rule)' }}>
      Mapping verification does not prove Airbnb delivery or PriceLabs daily pricing. Connecting, mapping and activation belong to the reviewed handover; no controls on this page perform them.
    </div>
  </section>;
}
