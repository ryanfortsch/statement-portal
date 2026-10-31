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
  const [id] = useState(() => initial?.editable ? initial.id : crypto.randomUUID());
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
      const result = await saveAppointment({ id, expectedVersion: initial?.editable ? initial.version : 0, details: reviewedDetails });
      if (!result.ok) { setError(result.error); return; }
      setDirty(false);
      router.push('/appointments'); router.refresh();
    } catch { setError('Save was not confirmed. Retry with these same details; the appointment will not be duplicated.'); }
    finally { setPending(false); }
  }
  const inputStyle = { display: 'block', width: '100%', marginTop: 5, padding: '10px 12px', border: '1px solid var(--rule)', borderRadius: 5, background: 'var(--paper)', color: 'var(--ink)', fontSize: 16 };
  const field = (label: string, key: keyof AppointmentInput, type = 'text', required = false) => <label style={{ display: 'block', fontSize: 13 }}>{label}<input name={key} type={type} required={required} value={(details[key] as string) ?? ''} onChange={e => change(key, e.target.value)} style={inputStyle} /></label>;
  return <form onSubmit={save} style={{ maxWidth: 720 }}>
    <p style={{ fontSize: 14, lineHeight: 1.6 }}>Save business appointments to your own agenda. This does not invite anyone or change their calendar. Keep private family and medical details in your personal calendar.</p>
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
      <label style={{ fontSize: 13 }}>Timing<select value={details.timeKind} onChange={e => change('timeKind', e.target.value)} style={inputStyle}><option value="exact">Appointment time</option><option value="arrival_window">Arrival window</option><option value="date_only">Date only, no clock required</option></select></label>
      <label style={{ fontSize: 13 }}>Status<select value={details.status} onChange={e => change('status', e.target.value)} style={inputStyle}>{Object.entries(STATUS_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
      <label style={{ fontSize: 13 }}>Attendance<select value={details.attendance} onChange={e => change('attendance', e.target.value)} style={inputStyle}>{Object.entries(ATTENDANCE_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
      {field('Property (if applicable)', 'propertyName')}{field('Place or video-call instructions', 'location')}{field('People / assigned coverage', 'people')}
      <label style={{ fontSize: 13 }}>What still needs confirming?<textarea value={details.reviewReason ?? ''} onChange={e => change('reviewReason', e.target.value)} style={inputStyle} rows={2} /><span style={{ fontSize: 12 }}>Leave blank after verifying the date, property and attendance.</span></label>
      <label style={{ fontSize: 13 }}>Preparation / notes<textarea value={details.notes ?? ''} onChange={e => change('notes', e.target.value)} style={inputStyle} rows={3} /></label>
      {field('Source (for example, city notice or accepted invitation)', 'sourceLabel', 'text', true)}{field('Source link (Gmail, Google Calendar, Quo or Helm)', 'sourceUrl', 'url')}
      {error && <p role="alert" style={{ color: 'var(--negative)', fontSize: 14 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}><Button type="submit" pending={pending} disabled={!available} variant="primary">Save appointment</Button><Link href="/appointments">Back to appointments</Link></div>
    </div>
  </form>;
}
