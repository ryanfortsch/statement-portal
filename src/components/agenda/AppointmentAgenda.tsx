import Link from 'next/link';
import { agendaGroups, homeAgendaPreview, appointmentClock, compactAppointmentClock, agendaSourceStatus, agendaSourceGap, ATTENDANCE_LABEL, overlappingAppointments, safeSourceUrl, type AgendaData, type AgendaEntry } from '@/lib/appointment-agenda';
import { houseDay } from '@/lib/house-date';
import { MeetingAttendance } from './MeetingAttendance';

export function AppointmentAgenda({ data, full = false }: { data: AgendaData; full?: boolean }) {
  const groups = agendaGroups(data.entries, data.today, data.through);
  const overlaps = overlappingAppointments(groups.scheduled);
  const total = groups.scheduled.length + groups.review.length + groups.other.length;
  const preview = homeAgendaPreview(groups, data.today, data.through);
  const render = (items: AgendaEntry[]) => items.map(e => <AppointmentRow key={e.id} entry={e} overlap={overlaps.has(e.id)} compact={!full} />);
  const addLink = <Link href="/appointments/new" className="rt-agenda-add">+ Add<span className="sr-only"> appointment</span></Link>;
  const sourceDetails = <details id={full ? 'sources' : undefined} className="rt-agenda-coverage">
    <summary><span role="status">{agendaSourceStatus(data.sources)}</span></summary>
    <div className="rt-agenda-details-body">
      {agendaSourceGap(data.sources) && <p>New or changed appointments from sources that are not syncing may be missing.</p>}
      <ul>{data.sources.map(s => <li key={s.name}><strong>{s.name}{s.excluded ? ' (not included)' : s.state !== 'available' ? ` (${s.state.replaceAll('_', ' ')})` : ''}: </strong>{s.detail}</li>)}</ul>
      <Link href="/turnovers">Walks and turnovers</Link> · <Link href="/turnovers/cleanings">Vendor cleanings</Link>
    </div>
  </details>;
  // Home with nothing on the agenda: one line and the add verb, plus the
  // source line only when a source that should be feeding the agenda is not
  // (that one stays visible by the agenda's rules). No heading, no "All →".
  if (!full && total === 0) {
    return <section aria-label="Upcoming appointments" className="rt-agenda rt-agenda-home">
      <p className="rt-agenda-empty">No appointments in the next 30 days · {addLink}</p>
      {agendaSourceGap(data.sources) && sourceDetails}
    </section>;
  }
  // Home with appointments but none to preview (all awaiting review or a
  // date, or owner-handled): one line that says how many and opens them, and
  // the source line under it when a source is not feeding the agenda. The
  // heading, the time zone, "All N" and an instruction sentence around zero
  // rows read as noise (2026-11-08, Dotti).
  if (!full && preview.length === 0 && overlaps.size === 0) {
    const review = groups.review.length;
    return <section aria-label="Upcoming appointments" className="rt-agenda rt-agenda-home">
      <p className="rt-agenda-empty">
        <Link href={review > 0 ? '/appointments#review' : '/appointments'}>
          {review > 0 ? `${review} appointment${review === 1 ? '' : 's'} to review` : `${total} appointment${total === 1 ? '' : 's'} awaiting a date`} →
        </Link>
        {' · '}{addLink}
      </p>
      {agendaSourceGap(data.sources) && <div className="rt-agenda-home-footer">{sourceDetails}</div>}
    </section>;
  }
  return <section aria-label="Upcoming appointments" className={`rt-agenda${full ? '' : ' rt-agenda-home'}`}>
    <div className="rt-agenda-heading">
      {/* The full page's one title is the page's own; this row carries the
          window and the add verb. The home block keeps its heading. */}
      {full
        ? <p className="rt-agenda-window">Next 30 days · through {houseDay(data.through)} · Eastern time</p>
        : <h2>Upcoming</h2>}
      <div className="rt-agenda-heading-actions">
        {!full && <span className="eyebrow">Eastern time</span>}
        {!full && <Link href="/appointments">All {total}<span className="sr-only"> appointments</span> →</Link>}
        {addLink}
      </div>
    </div>
    {full && sourceDetails}
    {!full && <>
      {render(preview)}
      {overlaps.size > 0 && <Link className="rt-agenda-warning" href="/appointments#scheduled">{overlaps.size} appointments overlap →</Link>}
      <div className="rt-agenda-home-footer">
        {sourceDetails}
        {groups.review.length > 0 && <Link href="/appointments#review">{groups.review.length} to review →</Link>}
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
  // The group heading already says the status once; the row's right-hand
  // slot is its one verb.
  const verbHref = e.editable || e.id.startsWith('capture:') ? e.href : `/appointments/new?meeting=${encodeURIComponent(e.id.slice('meeting:'.length))}`;
  const heading = <>
    <span className="rt-agenda-when">
      <strong>{e.date ? houseDay(e.date) : 'Date to arrange'} · {appointmentClock(e)}</strong>
      <Link href={verbHref}>{e.editable ? 'Edit / reschedule' : 'Review for my agenda'}</Link>
    </span>
    <Link href={e.href} className="rt-agenda-title">{e.title}</Link>
    <span className="rt-agenda-context">
      {e.propertyName && <span>{e.propertyName} · </span>}
      {e.id.startsWith('meeting:')
        ? <MeetingAttendance entry={e} />
        : <span className={e.attendance === 'coverage_needed' ? 'rt-agenda-attention' : undefined}>{ATTENDANCE_LABEL[e.attendance]}</span>}
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
    </div>
  </div>;
}
