import { scheduleUpdateLabel } from '@/lib/checkout-commitment';
import Link from 'next/link';
import { NOTE_ROUTES, noteStatus, workStatus, workError, type WorkOutcome, type MessageOutcomes as Outcomes } from '@/lib/message-outcomes';

/** Shared by open cards and resolved follow-ups. No actions or inferred delivery. */
export function MessageOutcomes({ value }: { value?: Outcomes }) {
  if (!value || (!value.schedule && !value.work.length && !value.notes.length && !value.error)) return null;
  return <section aria-label="Work and notes" style={{ marginTop: 16, padding: '12px 14px', border: '1px solid var(--rule)', borderLeft: '3px solid var(--success, #426d66)', background: 'var(--paper)', fontSize: 13, width: '100%', minWidth: 0 }}>
    <div className="eyebrow" style={{ color: 'var(--ink-3)', marginBottom: 8 }}>Work &amp; notes</div>
    {value.schedule && <div role="status" style={{ padding: '6px 0', color: value.schedule.error ? 'var(--signal)' : 'var(--ink-2)' }}>
      {scheduleUpdateLabel(value.schedule)}{' '}
      <Link href="/turnovers/schedule" style={{ textDecoration: 'underline' }}>View schedule ↗</Link>
    </div>}
    {value.work.map((work, i) => <WorkOutcomeDetails key={work.id || `work-${i}`} work={work} />)}
    {value.notes.map((note, i) => <div key={`${note.audience}:${note.id || i}`} style={{ padding: '6px 0', borderTop: value.work.length || i ? '1px solid var(--rule-soft)' : undefined }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '4px 16px' }}><span>Note to {note.recipient || note.audience}</span><span style={{ fontWeight: 600, color: note.error || note.status === 'failed' ? 'var(--signal)' : 'var(--ink-2)' }}>{noteStatus(note)}</span></div>
      {note.error && <p style={{ margin: '4px 0', fontSize: 12, color: 'var(--signal)' }}>{note.error}</p>}
      <details style={{ marginTop: 4, color: 'var(--ink-3)', fontSize: 12 }}><summary style={{ cursor: 'pointer' }}>View note</summary>
        {note.body && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: 'var(--ink-2)', margin: '8px 0' }}>{note.body}</p>}
        {note.status === 'approved' && note.resolved_at && <p>Sent {new Date(note.resolved_at).toLocaleString('en-US', { timeZone: 'America/New_York' })} Eastern</p>}
        {note.status === 'scheduled' && note.send_at && <p>Scheduled {new Date(note.send_at).toLocaleString('en-US', { timeZone: 'America/New_York' })} Eastern</p>}
        {note.id && ['pending', 'scheduled', 'sending'].includes(note.status) && <Link href={`${NOTE_ROUTES[note.audience]}#approval-${encodeURIComponent(note.id)}`} style={{ textDecoration: 'underline' }}>Open note in messaging ↗</Link>}
      </details>
    </div>)}
    {value.error && <p role="status" style={{ color: 'var(--signal)', margin: '6px 0 0', fontSize: 12 }}>{value.error}</p>}
  </section>;
}

/** Reused inside the existing work controls so the status is shown once. */
export function WorkOutcomeDetails({ work }: { work: WorkOutcome }) {
  return <div style={{ padding: '6px 0' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '4px 16px' }}>
        {work.id ? <Link href={`/work/${encodeURIComponent(work.id)}`} style={{ color: 'var(--ink-1)', textDecoration: 'underline', textUnderlineOffset: 3 }}>{work.title} ↗</Link> : <span>{work.title}</span>}
        <span style={{ color: ['blocked', 'unavailable'].includes(work.status) || work.error ? 'var(--signal)' : 'var(--ink-2)', fontWeight: 600 }}>{workStatus(work.status, work.assignee)}</span>
      </div>
      {work.assignee && (work.assignee !== workStatus(work.status, work.assignee) || work.scheduledDate || work.completedAt) && <p style={{ margin: '4px 0 0', color: 'var(--ink-3)', fontSize: 12 }}>{work.assignee}{work.scheduledDate ? ` · Scheduled ${work.scheduledDate}` : ''}{work.completedAt ? ` · Completed ${new Date(work.completedAt).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })}` : ''}</p>}
      {!!work.visits?.length && <div style={{marginTop:4,fontSize:12}}>{work.visits.map(visit => <Link key={visit.id} href={`/fieldwork/packets/${encodeURIComponent(visit.id)}`} style={{display:'block',color:'var(--ink-3)',textDecoration:'underline'}}>On {visit.date} visit{visit.name ? ` · ${visit.name}` : ' · No contractor assigned'} ↗</Link>)}</div>}
      {work.error && <p style={{ margin: '4px 0 0', color: 'var(--signal)', fontSize: 12 }}>{workError(work)}</p>}
    </div>;
}
