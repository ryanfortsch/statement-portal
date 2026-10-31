import Link from 'next/link';
import { agendaGroups, homeAgendaPreview, appointmentClock, compactAppointmentClock, agendaSourceStatus, ATTENDANCE_LABEL, overlappingAppointments, safeSourceUrl, STATUS_LABEL, type AgendaData, type AgendaEntry } from '@/lib/appointment-agenda';
import { houseDay } from '@/lib/house-date';

export function AppointmentAgenda({ data, full = false }: { data: AgendaData; full?: boolean }) {
  const groups = agendaGroups(data.entries, data.today, data.through);
  const overlaps = overlappingAppointments(groups.scheduled);
  const total = groups.scheduled.length + groups.review.length + groups.other.length;
  const preview = homeAgendaPreview(groups, data.today, data.through);
  const render = (items: AgendaEntry[]) => items.map(e => <AppointmentRow key={e.id} entry={e} overlap={overlaps.has(e.id)} compact={!full} />);
  const sourceDetails = <details id={full ? 'sources' : undefined} className="rt-agenda-coverage">
    <summary><span role="status">{agendaSourceStatus(data.sources)}</span></summary>
    <div className="rt-agenda-details-body">
      {data.sources.some(s => !s.excluded && s.state !== 'available') && <p>New or changed appointments from sources that are not syncing may be missing.</p>}
      <ul>{data.sources.map(s => <li key={s.name}><strong>{s.name}{s.excluded ? ' (not included)' : s.state !== 'available' ? ` (${s.state.replaceAll('_', ' ')})` : ''}: </strong>{s.detail}</li>)}</ul>
      <Link href="/turnovers">Walks and turnovers</Link> · <Link href="/turnovers/cleanings">Vendor cleanings</Link>
    </div>
  </details>;
  return <section aria-label="Upcoming appointments" className={`rt-agenda${full ? '' : ' rt-agenda-home'}`}>
    <div className="rt-agenda-heading">
      <h2>{full ? 'Upcoming appointments' : 'Upcoming'}</h2>
      <div className="rt-agenda-heading-actions">
        {!full && <Link href="/appointments">All{total ? ` ${total}` : ''}<span className="sr-only"> appointments</span> →</Link>}
        <Link href="/appointments/new" className="rt-agenda-add">+ Add<span className="sr-only"> appointment</span></Link>
      </div>
    </div>
    {full && <><p className="rt-agenda-window">Next 30 days · through {houseDay(data.through)} · Eastern time</p>{sourceDetails}</>}
    {!full && <>
      {render(preview)}
      {preview.length === 0 && <p className="rt-agenda-empty">{total > 0 ? 'Open the agenda for visits and plans awaiting a date.' : 'No upcoming appointments to show.'}</p>}
      {overlaps.size > 0 && <Link className="rt-agenda-warning" href="/appointments#scheduled">{overlaps.size} appointments overlap →</Link>}
      <div className="rt-agenda-home-footer">
        {sourceDetails}
        {groups.review.length > 0 && <Link href="/appointments#review">{groups.review.length} to review →</Link>}
        <span>Eastern time</span>
      </div>
    </>}
    {full && <>
      {groups.scheduled.length > 0 && <div id="scheduled" aria-label="Scheduled appointments">
        <h3 className="eyebrow rt-agenda-group">Your meetings & team coverage · {groups.scheduled.length}</h3>
        {render(groups.scheduled)}
      </div>}
      {groups.review.length > 0 && <div id="review" aria-label="Appointments needing review">
        <h3 className="eyebrow rt-agenda-group">Needs confirmation or scheduling · {groups.review.length}</h3>
        {render(groups.review)}
      </div>}
      {groups.other.length > 0 && <div id="other" aria-label="Owner-handled appointments">
        <h3 className="eyebrow rt-agenda-group">Owner-handled & not attending · {groups.other.length}</h3>
        {render(groups.other)}
      </div>}
    </>}
    {full && total === 0 && <p className="rt-agenda-empty">No appointments found in the sources listed here. Check unconnected sources before assuming you are free.</p>}
  </section>;
}

function AppointmentRow({ entry: e, overlap, compact = false }: { entry: AgendaEntry; overlap: boolean; compact?: boolean }) {
  const review = !!e.reviewReason || !!e.sourceUpdates?.length;
  if (compact) {
    const attention = e.status === 'needs_scheduling' ? 'Not booked' : e.status === 'tentative' ? 'Tentative' : review ? 'Needs review' : e.attendance === 'coverage_needed' ? 'Coverage to confirm' : null;
    const property = e.propertyName && !e.title.toLocaleLowerCase().includes(e.propertyName.toLocaleLowerCase()) ? e.propertyName : null;
    return <Link href={e.href} className="rt-agenda-brief-row" data-appointment-id={e.id}>
      <span className="rt-agenda-brief-date"><strong>{e.date ? houseDay(e.date) : 'Date to arrange'}</strong><span>{compactAppointmentClock(e)}</span></span>
      <span className="rt-agenda-brief-main">
        <span className="rt-agenda-title">{e.title}</span>
        {(property || attention || overlap) && <span className="rt-agenda-brief-meta">
          {property && <span>{property}</span>}
          {attention && <span className="rt-agenda-attention">{attention}</span>}
          {overlap && <span className="rt-agenda-attention">Overlaps another appointment</span>}
        </span>}
      </span>
      <span className="rt-agenda-brief-arrow" aria-hidden="true">→</span>
    </Link>;
  }
  const heading = <>
    <span className="rt-agenda-when">
      <strong>{e.date ? houseDay(e.date) : 'Date to arrange'} · {appointmentClock(e)}</strong>
      <span>{review && e.status === 'confirmed' ? 'Needs confirmation' : STATUS_LABEL[e.status]}</span>
    </span>
    <Link href={e.href} className="rt-agenda-title">{e.title}</Link>
    <span className="rt-agenda-context">
      {e.propertyName && <span>{e.propertyName} · </span>}
      <span className={e.attendance === 'coverage_needed' ? 'rt-agenda-attention' : undefined}>{e.id.startsWith('meeting:') ? 'Attendance to confirm' : ATTENDANCE_LABEL[e.attendance]}</span>
    </span>
    {overlap && <span className="rt-agenda-warning">Overlapping window · Separate coverage needed</span>}
  </>;
  return <article className="rt-agenda-row" data-appointment-id={e.id}>
    {heading}
    <details className="rt-agenda-row-details">
      <summary>{review ? 'What needs confirming & details' : 'Details & sources'}</summary>
      <AppointmentDetails entry={e} />
    </details>
  </article>;
}

function AppointmentDetails({ entry: e }: { entry: AgendaEntry }) {
  const sourceUrl = safeSourceUrl(e.sourceUrl);
  return <div className="rt-agenda-details-body">
    {e.location && <p>{e.location}</p>}
    {e.people && <p>{e.people}</p>}
    {e.reviewReason && <p className="rt-agenda-attention">{e.reviewReason}</p>}
    {e.sourceUpdates?.map(update => <p key={update.key}>{update.summary} {update.url && <a href={update.url} target="_blank" rel="noopener noreferrer">Check source ↗</a>}</p>)}
    {e.notes && <p style={{ whiteSpace: 'pre-line' }}>{e.notes}</p>}
    <div className="rt-agenda-links">
      {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noopener noreferrer">{e.sourceLabel} ↗</a> : <span>{e.sourceLabel}</span>}
      {e.updatedAt && <span>Reviewed {new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }).format(new Date(e.updatedAt))}</span>}
      <Link href={e.editable || e.id.startsWith('capture:') ? e.href : `/appointments/new?meeting=${encodeURIComponent(e.id.slice('meeting:'.length))}`}>{e.editable ? 'Edit / reschedule' : 'Review for my agenda'}</Link>
    </div>
  </div>;
}
