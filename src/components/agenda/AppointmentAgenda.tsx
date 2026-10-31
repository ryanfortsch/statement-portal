import Link from 'next/link';
import { agendaGroups, appointmentClock, ATTENDANCE_LABEL, overlappingAppointments, safeSourceUrl, STATUS_LABEL, type AgendaData, type AgendaEntry } from '@/lib/appointment-agenda';
import { houseDay } from '@/lib/house-date';

const row: React.CSSProperties = { padding: '16px 0', borderBottom: '1px solid var(--rule)', overflowWrap: 'anywhere' };
export function AppointmentAgenda({ data, full = false }: { data: AgendaData; full?: boolean }) {
  const groups = agendaGroups(data.entries, data.today, data.through);
  const overlaps = overlappingAppointments(groups.scheduled);
  const total = groups.scheduled.length + groups.review.length + groups.other.length;
  const render = (items: AgendaEntry[]) => items.map(e => <AppointmentRow key={e.id} entry={e} overlap={overlaps.has(e.id)} />);
  return <section aria-label="Upcoming appointments" style={{ marginBottom: 28 }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 25, fontWeight: 400, margin: 0 }}>Upcoming appointments</h2>
      <Link href="/appointments/new" style={{ fontSize: 13 }}>Add appointment</Link>
    </div>
    <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '0 0 12px' }}>Next 30 days · through {houseDay(data.through)} · Eastern time</p>
    <div style={{ padding: '10px 12px', background: 'var(--paper-2)', fontSize: 12, lineHeight: 1.55, marginBottom: 10 }}>
      <strong>Coverage is incomplete.</strong> Work calendars are not synced; email and Quo appointments need to be filed or reviewed.
      <details style={{ marginTop: 5 }} open={full || undefined}>
        <summary style={{ cursor: 'pointer' }}>What is included</summary>
        <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          {data.sources.map(s => <li key={s.name} style={{ marginBottom: 7 }}><strong>{s.name}: </strong>{s.detail}</li>)}
        </ul>
        <div><Link href="/turnovers">Planned walks and turnovers</Link> · <Link href="/turnovers/cleanings">Vendor cleanings</Link></div>
      </details>
    </div>
    {data.sources.filter(s => s.state === 'unavailable' && !s.detail.includes('viewing as staff')).map(s => <p key={s.name} role="status" style={{ fontSize: 13, color: 'var(--negative)' }}>{s.name}: {s.detail}</p>)}
    {groups.scheduled.length > 0 && <div aria-label="Scheduled appointments">
      <h3 className="eyebrow" style={{ paddingTop: 8 }}>Your meetings & team coverage · {groups.scheduled.length}</h3>
      {render(groups.scheduled)}
    </div>}
    {groups.review.length > 0 && <div aria-label="Appointments needing review" style={{ marginTop: 16 }}>
      <h3 className="eyebrow">Needs confirmation or scheduling · {groups.review.length}</h3>
      {render(groups.review)}
    </div>}
    {groups.other.length > 0 && <details style={{ marginTop: 18 }} open={full || undefined}>
      <summary style={{ cursor: 'pointer', fontSize: 14 }}>Owner-handled & not attending · {groups.other.length}</summary>
      {render(groups.other)}
    </details>}
    {total === 0 && <p style={{ fontSize: 14, padding: '12px 0' }}>No appointments found in the sources listed here. Check unconnected sources before assuming you are free.</p>}
    {!full && <Link href="/appointments" style={{ display: 'inline-block', fontSize: 12, marginTop: 16 }}>Manage appointments and source reviews →</Link>}
  </section>;
}
function AppointmentRow({ entry: e, overlap }: { entry: AgendaEntry; overlap: boolean }) {
  const sourceUrl = safeSourceUrl(e.sourceUrl);
  return <article style={row} data-appointment-id={e.id}>
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '5px 18px', fontSize: 13, marginBottom: 5 }}>
      <strong>{e.date ? houseDay(e.date) : 'Date to arrange'} · {appointmentClock(e)}</strong>
      <span style={{ color: 'var(--ink-3)' }}>{STATUS_LABEL[e.status]}</span>
    </div>
    <Link href={e.href} style={{ fontSize: 16, color: 'var(--ink)', textDecoration: 'none', fontWeight: 500 }}>{e.title}</Link>
    <div style={{ fontSize: 13, lineHeight: 1.6, marginTop: 5, color: 'var(--ink-3)' }}>
      {[e.propertyName, e.location && e.location !== e.propertyName ? e.location : null].filter(Boolean).join(' · ')}
      {e.people && <div>{e.people}</div>}
      <div style={{ color: e.attendance === 'coverage_needed' ? 'var(--signal)' : 'var(--ink-2)' }}>{ATTENDANCE_LABEL[e.attendance]}</div>
      {overlap && <div style={{ color: 'var(--signal)', fontWeight: 600 }}>Overlapping window: assign separate coverage or confirm timing.</div>}
      {e.reviewReason && <div style={{ color: 'var(--signal)' }}>{e.reviewReason}</div>}
      {e.notes && <div style={{ marginTop: 4, whiteSpace: 'pre-line' }}>{e.notes}</div>}
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 14px', fontSize: 11, color: 'var(--ink-4)', marginTop: 9 }}>
      {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noopener noreferrer">{e.sourceLabel} ↗</a> : <span>{e.sourceLabel}</span>}
      {e.updatedAt && <span>Reviewed {new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }).format(new Date(e.updatedAt))}</span>}
      <Link href={e.editable ? e.href : `/appointments/new?meeting=${encodeURIComponent(e.id.slice('meeting:'.length))}`}>{e.editable ? 'Edit / reschedule' : 'Review for my agenda'}</Link>
    </div>
  </article>;
}
