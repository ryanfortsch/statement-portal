'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { Button } from '@/components/Button';
import { saveAppointment } from './actions';
import { ATTENDANCE_LABEL, STATUS_LABEL, type AgendaEntry, type AppointmentInput } from '@/lib/appointment-agenda';

export function AppointmentForm({ initial, available }: { initial?: AgendaEntry; available: boolean }) {
  const router = useRouter();
  // Reviewing a CRM meeting you already answered keeps that answer's record,
  // so the meeting is never claimed twice in your agenda.
  const [id] = useState(() => initial?.editable ? initial.id : initial?.attendanceAnswer?.id ?? crypto.randomUUID());
  const expectedVersion = initial?.editable ? initial.version : initial?.attendanceAnswer?.version ?? 0;
  const [details, setDetails] = useState<AppointmentInput>(() => initial ?? {
    title: '', date: null, time: null, endTime: null, timeKind: 'exact', status: 'tentative', attendance: 'coverage_needed',
    propertyName: null, location: null, people: null, notes: null, sourceLabel: 'Manual business appointment',
    sourceUrl: null, sourceKeys: [`manual:${id}`], reviewReason: null,
  });
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  useUnsavedWorkGuard(dirty || pending);
  const [error, setError] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);
  // What, when, where, who and status stay up front; the rest folds. It opens
  // on its own for a review (what still needs confirming lives there) and when
  // the browser needs to show a required field inside it.
  const [moreOpen, setMoreOpen] = useState(() => !!initial?.reviewReason || !!initial?.sourceUpdates?.length);
  const change = (key: keyof AppointmentInput, value: string) => { setDirty(true); setDetails(d => ({ ...d, [key]: value || null })); };
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (pending || !available) return;
    setPending(true); setError(null);
    try {
      const updates = initial?.sourceUpdates || [];
      if (updates.length && !reviewed) { setError('Check the linked source changes and confirm the review before saving.'); return; }
      const reviewedDetails = updates.length ? { ...details, sourceKeys: [...new Set([...details.sourceKeys, ...updates.map(u => u.key)])],
        sourceRevisions: { ...details.sourceRevisions, ...Object.fromEntries(updates.map(u => [u.key, u.revision])) } } : details;
      const result = await saveAppointment({ id, expectedVersion, details: reviewedDetails });
      // A refusal can name a folded field (source, timing): show them all.
      if (!result.ok) { setError(result.error); setMoreOpen(true); return; }
      setDirty(false);
      router.push('/appointments'); router.refresh();
    } catch { setError('Save was not confirmed. Retry with these same details; the appointment will not be duplicated.'); }
    finally { setPending(false); }
  }
  const inputStyle = { display: 'block', width: '100%', marginTop: 5, padding: '10px 12px', border: '1px solid var(--rule)', borderRadius: 5, background: 'var(--paper)', color: 'var(--ink)', fontSize: 16 };
  const field = (label: string, key: keyof AppointmentInput, type = 'text', required = false) => <label style={{ display: 'block', fontSize: 13 }}>{label}<input name={key} type={type} required={required} value={(details[key] as string) ?? ''} onChange={e => change(key, e.target.value)} style={inputStyle} /></label>;
  const select = (label: string, key: 'timeKind' | 'status' | 'attendance', options: Record<string, string>) => <label style={{ display: 'block', fontSize: 13 }}>{label}<select value={details[key]} onChange={e => change(key, e.target.value)} style={inputStyle}>{Object.entries(options).map(([v, text]) => <option key={v} value={v}>{text}</option>)}</select></label>;
  const twoUp = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 14 };
  return <form onSubmit={save} onInvalidCapture={e => { if ((e.target as HTMLElement).closest('details')) setMoreOpen(true); }} style={{ maxWidth: 720 }}>
    <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--ink-3)' }}>Business appointments only, saved to your own agenda. Nobody is invited. Family and medical plans stay in your personal calendar.</p>
    {initial?.id.startsWith('meeting:') && <p style={{ color: 'var(--signal)', fontSize: 13 }}>This review updates your agenda only. The original CRM record and any reminder texts still need correction on <Link href={initial.href}>the contact page</Link>.</p>}
    {!!initial?.sourceUpdates?.length && <div style={{ padding: 14, background: 'var(--paper-2)', marginBottom: 18 }}>
      <strong>Review source changes</strong>
      {initial.sourceUpdates.map(u => <p key={u.key} style={{ fontSize: 13 }}>{u.summary} {u.url && <a href={u.url} target="_blank" rel="noopener noreferrer">Open source ↗</a>}</p>)}
      <label style={{ fontSize: 13 }}><input type="checkbox" checked={reviewed} onChange={e => { setReviewed(e.target.checked); setDirty(true); }} /> I checked the latest sources and updated the details below. To dismiss a non-appointment, choose Cancelled.</label>
    </div>}
    {!available && <p role="status" style={{ color: 'var(--negative)' }}>Appointment storage is unavailable. Setup or repair is required before saving.</p>}
    <div style={{ display: 'grid', gap: 18 }}>
      {field('Appointment', 'title', 'text', true)}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: 14 }}>
        {field('Date', 'date', 'date')}{field('Start / arrival from (ET)', 'time', 'time')}{field('End / arrival until (ET)', 'endTime', 'time')}
      </div>
      {field('Property (if applicable)', 'propertyName')}
      <div style={twoUp}>
        {select('Who from our team', 'attendance', ATTENDANCE_LABEL)}
        {select('Status', 'status', STATUS_LABEL)}
      </div>
      <details open={moreOpen} onToggle={e => setMoreOpen(e.currentTarget.open)}>
        <summary style={{ fontSize: 13, cursor: 'pointer' }}>Details</summary>
        <div style={{ display: 'grid', gap: 18, marginTop: 14 }}>
          {select('Timing', 'timeKind', { exact: 'Appointment time', arrival_window: 'Arrival window', date_only: 'Date only, no clock required' })}
          {field('Place or video-call instructions', 'location')}{field('People / assigned coverage', 'people')}
          <label style={{ fontSize: 13 }}>What still needs confirming?<textarea value={details.reviewReason ?? ''} onChange={e => change('reviewReason', e.target.value)} style={inputStyle} rows={2} /><span style={{ fontSize: 12 }}>Leave blank after verifying the date, property and attendance.</span></label>
          <label style={{ fontSize: 13 }}>Preparation / notes<textarea value={details.notes ?? ''} onChange={e => change('notes', e.target.value)} style={inputStyle} rows={3} /></label>
          {field('Source (for example, city notice or accepted invitation)', 'sourceLabel', 'text', true)}{field('Source link (Gmail, Google Calendar, Quo or Helm)', 'sourceUrl', 'url')}
        </div>
      </details>
      {error && <p role="alert" style={{ color: 'var(--negative)', fontSize: 14 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}><Button type="submit" pending={pending} disabled={!available} variant="primary">Save appointment</Button><Link href="/appointments">Back to appointments</Link></div>
    </div>
  </form>;
}
