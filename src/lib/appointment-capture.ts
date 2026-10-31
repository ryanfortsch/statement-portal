import { createHash } from 'node:crypto';
import { appointmentClock, safeSourceUrl, type AgendaEntry, type AppointmentInput, type SourceCoverage } from './appointment-agenda.ts';

export type CaptureKind = 'calendar' | 'gmail' | 'quo';
export type Capture = { source_key: string; kind: CaptureKind; revision: string; aliases: string[]; details: AppointmentInput; checked_at: string; changed_at?: string };
export type CaptureState = { kind: CaptureKind; state: SourceCoverage['state']; detail: string; last_attempt_at: string; last_success_at: string | null };
export const CAPTURE_NAMES = { calendar: 'Work Google Calendar', gmail: 'Work Gmail', quo: 'Quo business texts' };
export const revisionOf = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const schedulingSignal = (s: string) => /\b(appointment|inspect(?:ion|or)|meet(?:ing)?|walk[ -]?through|tour|photo\s?shoot|photoshoot|schedule|reschedul\w*|zoom|video call|introductory call)\b/i.test(s);
export function captureCoverage(kind: CaptureKind, state: CaptureState | undefined, now: Date): SourceCoverage {
  if (!state) return { name: CAPTURE_NAMES[kind], automatic: true, state: 'not_connected', detail: 'Automatic updates have not run for your account.' };
  const fresh = state.last_success_at && now.getTime() - Date.parse(state.last_success_at) < 2 * 3600000;
  return { name: CAPTURE_NAMES[kind], automatic: true, state: state.state === 'available' && !fresh ? 'partial' : state.state,
    detail: `${state.detail}${state.last_success_at ? ` Last complete check: ${new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(state.last_success_at))}.` : ' No complete check yet.'}${!fresh && state.last_success_at ? ' Stale: check the source directly.' : ''}` };
}
const blank = (key: string, title: string, label: string, url: string | null): AppointmentInput => ({
  title, date: null, time: null, endTime: null, timeKind: 'exact', status: 'needs_scheduling', attendance: 'coverage_needed',
  propertyName: null, location: null, people: null, notes: null, sourceLabel: label, sourceUrl: safeSourceUrl(url), sourceKeys: [key],
  reviewReason: 'Review the conversation for its latest date, property and attendance. A scheduling mention is not a booked appointment.',
});
export function messageCapture(kind: 'gmail' | 'quo', key: string, aliases: string[], url: string, contentRevision: unknown, now: Date): Capture {
  const details = blank(key, kind === 'gmail' ? 'Scheduling email to review' : 'Scheduling text to review', kind === 'gmail' ? 'Open Gmail conversation' : 'Open Helm contact conversation', url);
  return { source_key: key, kind, aliases: [...new Set([key, ...aliases])], revision: revisionOf(contentRevision), details, checked_at: now.toISOString() };
}
export type CalendarEvent = { id: string; status?: string; summary?: string; htmlLink?: string; updated?: string; location?: string;
  start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string }; eventType?: string;
  attendees?: Array<{ self?: boolean; responseStatus?: string }>; recurringEventId?: string };
function localTime(value: string | undefined) {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
export function calendarCapture(event: CalendarEvent, email: string, now: Date): Capture {
  const key = `gcal:${email}:${event.id}`;
  const start = localTime(event.start?.dateTime), end = localTime(event.end?.dateTime);
  const self = event.attendees?.find(a => a.self)?.responseStatus;
  const details = blank(key, (event.summary || 'Calendar appointment').slice(0, 200), 'Google Calendar', event.htmlLink || `https://calendar.google.com/calendar/event?eid=${Buffer.from(`${event.id} ${email}`).toString('base64url')}`);
  details.date = start?.date || event.start?.date || null;
  details.time = start?.time || null;
  details.endTime = end && end.date === start?.date && end.time > start.time ? end.time : null;
  details.timeKind = event.start?.date ? 'date_only' : 'exact';
  details.status = event.status === 'cancelled' ? 'cancelled' : event.status === 'confirmed' ? 'confirmed' : 'tentative';
  details.attendance = self === 'accepted' ? 'attending' : self === 'declined' ? 'not_attending' : 'coverage_needed';
  details.location = event.location?.slice(0, 500) || null;
  details.reviewReason = event.status === 'cancelled' ? 'Calendar reports this event cancelled.' : 'Verify this is a business appointment and confirm attendance; an invitation alone is not acceptance.';
  if (end && start && end.date !== start.date) details.reviewReason += ` Ends ${end.date} at ${end.time} ET; spans more than one day.`;
  if (event.start?.date && event.end?.date) details.notes = `All-day event; Calendar end date ${event.end.date} is exclusive.`;
  return { source_key: key, kind: 'calendar', aliases: [key], revision: revisionOf({ details, updated: event.updated || null }), details, checked_at: now.toISOString() };
}

/** Exact source aliases only. Provider observations never overwrite a reviewed
 * appointment. Changed/cancelled/moved records leave the booked list until reviewed. */
export function reconcileCaptures(saved: AgendaEntry[], captures: Capture[]): AgendaEntry[] {
  const result = saved.map(s => ({ ...s, sourceUpdates: [] as NonNullable<AgendaEntry['sourceUpdates']> }));
  const unclaimed: Capture[] = [];
  for (const c of captures) {
    const matches = result.filter(e => e.sourceKeys.some(k => c.aliases.includes(k)));
    if (!matches.length) { if (c.details.status !== 'cancelled') unclaimed.push(c); continue; }
    for (const e of matches) {
      if (e.sourceRevisions?.[c.source_key] === c.revision) continue;
      e.sourceUpdates.push({ key: c.source_key, revision: c.revision, url: c.details.sourceUrl,
        summary: c.kind === 'calendar' ? `${c.details.status === 'cancelled' ? 'Cancelled at source' : 'Calendar now shows'}: ${c.details.date || 'date unavailable'} · ${appointmentClock(c.details)}.` : 'New or unreviewed conversation activity. Check all replies before keeping the appointment.' });
      e.reviewReason = 'Source activity needs review. The saved details below may be out of date.';
      e.status = 'needs_scheduling';
    }
  }
  // A mail copy with an exact event link belongs to that calendar candidate.
  const groups: Capture[][] = [];
  for (const c of unclaimed.sort((a, b) => Number(b.kind === 'calendar') - Number(a.kind === 'calendar') || a.source_key.localeCompare(b.source_key))) {
    const group = groups.find(g => g.some(x => x.aliases.some(k => c.aliases.includes(k))));
    if (group) group.push(c); else groups.push([c]);
  }
  for (const group of groups) {
    const c = group[0], href = `/appointments/new?capture=${encodeURIComponent(c.source_key)}`;
    result.push({ ...c.details, sourceKeys: [...new Set(group.flatMap(x => [x.source_key, ...x.details.sourceKeys]))].slice(0, 20),
      id: `capture:${c.source_key}`, href, editable: false, version: 0, updatedAt: null,
      sourceUpdates: group.map(x => ({ key: x.source_key, revision: x.revision, summary: x.kind === 'calendar' ? 'Calendar event captured; confirm business purpose and attendance.' : 'Check the latest conversation before saving.', url: x.details.sourceUrl })) });
  }
  return result;
}
