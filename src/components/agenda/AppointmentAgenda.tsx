import Link from 'next/link';
import { agendaGroups, homeAgendaPreview, appointmentClock, ATTENDANCE_LABEL, overlappingAppointments, safeSourceUrl, STATUS_LABEL, type AgendaData, type AgendaEntry } from '@/lib/appointment-agenda';
import { houseDay } from '@/lib/house-date';

export function AppointmentAgenda({ data, full = false }: { data: AgendaData; full?: boolean }) {
  const groups = agendaGroups(data.entries, data.today, data.through);
  const overlaps = overlappingAppointments(groups.scheduled);
  const total = groups.scheduled.length + groups.review.length + groups.other.length;
  const preview = homeAgendaPreview(groups, data.today, data.through);
  const gaps = data.sources.filter(s => s.state !== 'available' && !s.detail.includes('viewing as staff'));
  const unavailable = gaps.some(s => s.state === 'unavailable');
  const render = (items: AgendaEntry[]) => items.map(e => <AppointmentRow key={e.id} entry={e} overlap={overlaps.has(e.id)} compact={!full} />);
  return <section aria-label="Upcoming appointments" className="rt-agenda">
    <div className="rt-agenda-heading">
      <h2>{full ? 'Upcoming appointments' : 'Next appointments'}</h2>
      <Link href="/appointments/new" className="rt-agenda-add">+ Add<span className="sr-only"> appointment</span></Link>
    </div>
    <p className="rt-agenda-window">{full ? `Next 30 days · through ${houseDay(data.through)}` : 'Next 30 days'} · Eastern time</p>
    <details className="rt-agenda-coverage">
      <summary>
        <span role="status">{gaps.length ? `${unavailable ? 'Sources unavailable' : 'Incomplete coverage'} · Appointments may be missing` : 'Source coverage · Review what is included'}</span>
      </summary>
      <div className="rt-agenda-details-body">
        <p>Only the sources below are included. New conversations and changed invitations need review.</p>
        <ul>{data.sources.map(s => <li key={s.name}><strong>{s.name}{s.state !== 'available' ? ` (${s.state.replaceAll('_', ' ')})` : ''}: </strong>{s.detail}</li>)}</ul>
        <Link href="/turnovers">Walks and turnovers</Link> · <Link href="/turnovers/cleanings">Vendor cleanings</Link>
      </div>
    </details>
    {!full && <>
      {overlaps.size > 0 && <Link className="rt-agenda-warning" href="/appointments#scheduled">{overlaps.size} appointments overlap · Check coverage →</Link>}
      {render(preview)}
      {preview.length === 0 && total > 0 && <p className="rt-agenda-empty">No dated personal appointments ready to show. Open the full agenda for visits and scheduling items.</p>}
      <Link href="/appointments" className="rt-agenda-all">
        <span>View all appointments{total ? ` (${total})` : ''} →</span>
        {(groups.review.length > 0 || groups.other.length > 0) && <span>
          {[groups.review.length > 0 ? `${groups.review.length} need review` : null,
            groups.other.length > 0 ? `${groups.other.length} owner-handled / not attending` : null].filter(Boolean).join(' · ')}
        </span>}
      </Link>
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
    {total === 0 && <p className="rt-agenda-empty">No appointments found in the sources listed here. Check unconnected sources before assuming you are free.</p>}
  </section>;
}

function AppointmentRow({ entry: e, overlap, compact = false }: { entry: AgendaEntry; overlap: boolean; compact?: boolean }) {
  const review = !!e.reviewReason || !!e.sourceUpdates?.length;
  const heading = <>
    <span className="rt-agenda-when">
      <strong>{e.date ? houseDay(e.date) : 'Date to arrange'} · {appointmentClock(e)}</strong>
      <span>{review && e.status === 'confirmed' ? 'Needs confirmation' : STATUS_LABEL[e.status]}</span>
    </span>
    {compact ? <span className="rt-agenda-title">{e.title}</span> : <Link href={e.href} className="rt-agenda-title">{e.title}</Link>}
    <span className="rt-agenda-context">
      {e.propertyName && <span>{e.propertyName} · </span>}
      <span className={e.attendance === 'coverage_needed' ? 'rt-agenda-attention' : undefined}>{ATTENDANCE_LABEL[e.attendance]}</span>
    </span>
    {overlap && <span className="rt-agenda-warning">Overlapping window · Separate coverage needed</span>}
  </>;
  if (compact) return <details className="rt-agenda-row rt-agenda-compact-row" data-appointment-id={e.id}>
    <summary>{heading}</summary>
    <AppointmentDetails entry={e} />
  </details>;
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
