'use client';

import { useRef, useState, useTransition } from 'react';
import type { ContactMeetingRow } from '@/lib/meetings-core';
import { defaultImportant, meetingWhen, todayET } from '@/lib/meetings-core';
import { displayNameForEmail } from '@/lib/team';
import { addContactMeeting, cancelContactMeeting } from '../actions';

type PropertyMini = { id: string; name: string };

type Props = {
  contactId: string;
  contactName: string;
  contactType: string;
  properties: PropertyMini[];
  linkedPropertyIds: string[];
  upcoming: ContactMeetingRow[];
  past: ContactMeetingRow[];
  disabled?: boolean;
};

/**
 * Meetings with this contact. Upcoming ones first (soonest at the top),
 * the last few that already happened underneath. An important meeting is
 * texted to the operator the evening before by /api/cron/meeting-reminders;
 * every meeting shows on the home feed on its day and the day before.
 */
export function ContactMeetings({
  contactId,
  contactName,
  contactType,
  properties,
  linkedPropertyIds,
  upcoming,
  past,
  disabled = false,
}: Props) {
  const [, startTransition] = useTransition();
  const [list, setList] = useState<ContactMeetingRow[]>(upcoming);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [propertyId, setPropertyId] = useState(linkedPropertyIds[0] ?? '');
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [important, setImportant] = useState(defaultImportant(contactType));
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cancelPending, setCancelPending] = useState<string[]>([]);
  const [cancelErrors, setCancelErrors] = useState<Record<string, string>>({});
  const posting = useRef(false);
  const cancelling = useRef<Set<string>>(new Set());

  const propertyName = (id: string | null) => (id ? properties.find((p) => p.id === id)?.name ?? id : null);
  const today = todayET();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (posting.current || !date) return;
    posting.current = true;
    setSubmitting(true);
    setErr(null);
    try {
      const res = await addContactMeeting({
        contact_id: contactId,
        meeting_date: date,
        meeting_time: time || null,
        property_id: propertyId || null,
        title: title.trim() || null,
        location: location.trim() || null,
        notes: notes.trim() || null,
        important,
      });
      if (!res.ok) { setErr(res.error); return; }
      setList((prev) =>
        [...prev, res.meeting].sort((a, b) =>
          a.meeting_date === b.meeting_date
            ? (a.meeting_time ?? '99').localeCompare(b.meeting_time ?? '99')
            : a.meeting_date.localeCompare(b.meeting_date),
        ),
      );
      setDate(''); setTime(''); setTitle(''); setLocation(''); setNotes('');
      setImportant(defaultImportant(contactType));
    } catch {
      setErr('Could not confirm whether the meeting was saved. Reload before retrying to avoid a duplicate.');
    } finally {
      posting.current = false;
      setSubmitting(false);
    }
  }

  function cancel(id: string) {
    if (cancelling.current.has(id)) return;
    cancelling.current.add(id);
    setCancelPending([...cancelling.current]);
    setCancelErrors((prev) => ({ ...prev, [id]: '' }));
    startTransition(async () => {
      try {
        const res = await cancelContactMeeting({ id, contact_id: contactId });
        if (!res.ok) { setCancelErrors((prev) => ({ ...prev, [id]: res.error })); return; }
        setList((prev) => prev.filter((m) => m.id !== id));
      } catch {
        setCancelErrors((prev) => ({ ...prev, [id]: 'Could not confirm the cancel. Retry.' }));
      } finally {
        cancelling.current.delete(id);
        setCancelPending([...cancelling.current]);
      }
    });
  }

  const busy = submitting || disabled;

  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 36, width: '100%' }}>
      <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
        <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
          Meetings
        </h2>
        <span className="eyebrow">{list.length} upcoming</span>
      </div>

      <div style={{ borderTop: '1px solid var(--ink)', paddingTop: 18 }}>
        <form onSubmit={submit} className="flex flex-col gap-3" style={{ marginBottom: 24 }}>
          <div className="flex gap-3" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '0 0 160px' }}>
              <Field label="Date *">
                <input type="date" value={date} min={today} disabled={busy} required onChange={(e) => setDate(e.target.value)} style={inputStyle()} />
              </Field>
            </div>
            <div style={{ flex: '0 0 130px' }}>
              <Field label="Time">
                <input type="time" value={time} disabled={busy} onChange={(e) => setTime(e.target.value)} style={inputStyle()} />
              </Field>
            </div>
            <div style={{ flex: '1 1 180px' }}>
              <Field label="Property">
                <select value={propertyId} disabled={busy} onChange={(e) => setPropertyId(e.target.value)} style={selectStyle()}>
                  <option value="">None</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ flex: '2 1 240px' }}>
              <Field label="What">
                <input
                  type="text"
                  value={title}
                  disabled={busy}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={`Meeting with ${contactName}`}
                  maxLength={200}
                  style={inputStyle()}
                />
              </Field>
            </div>
            <button
              type="submit"
              disabled={busy || !date}
              style={{
                background: busy || !date ? 'var(--ink-4)' : 'var(--ink)',
                color: 'var(--paper)',
                border: 'none',
                padding: '10px 18px',
                fontSize: 11,
                letterSpacing: '.18em',
                textTransform: 'uppercase',
                fontWeight: 600,
                cursor: busy || !date ? 'default' : 'pointer',
                height: 'fit-content',
              }}
            >
              {submitting ? 'Saving…' : 'Add Meeting'}
            </button>
          </div>
          <div className="flex gap-3" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 240px' }}>
              <input
                type="text"
                value={location}
                disabled={busy}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Where (optional): at the house, Zoom, the office"
                maxLength={200}
                style={inputStyle()}
              />
            </div>
            <div style={{ flex: '2 1 320px' }}>
              <input
                type="text"
                value={notes}
                disabled={busy}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Note (optional): what to bring, what to raise"
                maxLength={500}
                style={inputStyle()}
              />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink-2)', padding: '10px 0', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={important} disabled={busy} onChange={(e) => setImportant(e.target.checked)} />
              Text me the evening before
            </label>
          </div>
          {err && (
            <div role="alert" style={{ padding: '8px 12px', borderLeft: '3px solid var(--negative)', background: 'var(--paper-2)', color: 'var(--negative)', fontSize: 12 }}>
              {err}
            </div>
          )}
        </form>

        {list.length === 0 ? (
          <div style={{ padding: '18px 0', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
            Nothing on the calendar with {contactName}.
          </div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {list.map((m) => (
              <MeetingRow
                key={m.id}
                meeting={m}
                today={today}
                propertyName={propertyName(m.property_id)}
                pending={cancelPending.includes(m.id)}
                error={cancelErrors[m.id]}
                onCancel={disabled ? undefined : () => cancel(m.id)}
              />
            ))}
          </ul>
        )}

        {past.length > 0 && (
          <details style={{ marginTop: 18 }}>
            <summary style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.12em', textTransform: 'uppercase', cursor: 'pointer' }}>
              {past.length} past
            </summary>
            <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
              {past.map((m) => (
                <MeetingRow key={m.id} meeting={m} today={today} propertyName={propertyName(m.property_id)} dim />
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}

function MeetingRow({
  meeting: m,
  today,
  propertyName,
  pending,
  error,
  onCancel,
  dim,
}: {
  meeting: ContactMeetingRow;
  today: string;
  propertyName: string | null;
  pending?: boolean;
  error?: string;
  onCancel?: () => void;
  dim?: boolean;
}) {
  const isToday = m.meeting_date === today;
  const accent = isToday ? 'var(--signal)' : 'var(--tide-deep)';
  const reminder = !m.important
    ? null
    : m.reminder_sent_at
      ? `Texted ${new Date(m.reminder_sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      : m.reminder_error
        ? 'Text failed, retrying'
        : m.meeting_date > today
          ? 'Text the evening before'
          : null;
  return (
    <li
      style={{
        padding: '14px 0',
        borderBottom: '1px solid var(--rule)',
        display: 'flex',
        gap: 14,
        alignItems: 'flex-start',
        opacity: dim ? 0.7 : 1,
      }}
    >
      <span style={{
        fontSize: 9, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase',
        color: accent,
        border: `1px solid ${accent}`,
        padding: '2px 7px',
        flexShrink: 0,
        marginTop: 2,
        whiteSpace: 'nowrap',
      }}>
        {meetingWhen({ date: m.meeting_date, time: m.meeting_time }, today)}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, color: 'var(--ink)' }}>
          {m.title}
          {propertyName ? <span style={{ color: 'var(--ink-3)' }}> · {propertyName}</span> : null}
        </div>
        {(m.location || m.notes) && (
          <div style={{ marginTop: 4, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>
            {m.location ? <span>{m.location}</span> : null}
            {m.location && m.notes ? ' · ' : null}
            {m.notes ? <span>{m.notes}</span> : null}
          </div>
        )}
        {error && <div role="alert" style={{ color: 'var(--negative)', fontSize: 12, marginTop: 4 }}>{error}</div>}
        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.04em' }}>
          {displayNameForEmail(m.created_by_email)}
          {m.meeting_time ? null : <> &middot; no time set</>}
          {reminder ? <> &middot; {reminder}</> : null}
        </div>
      </div>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          aria-label="Cancel meeting"
          title="Cancel this meeting"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', fontSize: 14, padding: 0, lineHeight: 1 }}
        >
          {pending ? 'Cancelling…' : '×'}
        </button>
      )}
    </li>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>{label}</div>
      {children}
    </label>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid var(--rule)',
    background: 'var(--paper)',
    fontSize: 13,
    color: 'var(--ink)',
    fontFamily: 'inherit',
  };
}

function selectStyle(): React.CSSProperties {
  return { ...inputStyle(), appearance: 'none' };
}

