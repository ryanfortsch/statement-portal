/** Business appointments only. Local clocks are always America/New_York;
 * dates never pass through the server's local timezone. No inferred attendance. */
import { appointmentAddressConflict } from './appointment-evidence.ts';
import { addDays } from './home-week.ts';
import { operatingDate } from './operating-date.ts';
import { formatMeetingTime, type MeetingCard } from './meetings-core.ts';

export const AGENDA_DAYS = 30;
export const AGENDA_TIME_ZONE = 'America/New_York';
export const APPOINTMENT_STATUSES = ['confirmed', 'tentative', 'needs_scheduling', 'cancelled'] as const;
export const ATTENDANCE = ['attending', 'coverage_needed', 'owner_handled', 'not_attending'] as const;
export type AppointmentStatus = typeof APPOINTMENT_STATUSES[number];
export type Attendance = typeof ATTENDANCE[number];
export type AppointmentInput = {
  title: string;
  date: string | null;
  time: string | null;
  endTime: string | null;
  timeKind: 'exact' | 'arrival_window' | 'date_only';
  status: AppointmentStatus;
  attendance: Attendance;
  propertyName: string | null;
  location: string | null;
  people: string | null;
  notes: string | null;
  sourceLabel: string;
  sourceUrl: string | null;
  /** Stable event/thread identities, never include the event date. */
  sourceKeys: string[];
  reviewReason: string | null;
  /** Explicitly reviewed provider revisions; polling alone never acknowledges changes. */
  sourceRevisions?: Record<string, string>;
  /** A private attendance answer for one CRM meeting (its only source key is
   *  that meeting). It never renders as a row of its own and copies nothing
   *  from the meeting: the live CRM row keeps its own date, time and place
   *  and takes only this person's attendance from the answer. */
  attendanceOnly?: true;
};
export type AgendaEntry = AppointmentInput & {
  id: string;
  href: string;
  version: number;
  updatedAt: string | null;
  editable: boolean;
  sourceUpdates?: Array<{ key: string; revision: string; summary: string; url: string | null }>;
  /** On a CRM meeting row: the signed-in person's saved attendance answer. */
  attendanceAnswer?: { id: string; version: number };
};
export type SourceCoverage = {
  name: string;
  state: 'available' | 'partial' | 'unavailable' | 'not_connected';
  detail: string;
  /** An intentional privacy/view boundary is information, not a broken source. */
  excluded?: boolean;
  automatic?: boolean;
};

export function agendaSourceStatus(sources: SourceCoverage[]): string {
  const included = sources.filter(s => !s.excluded);
  if (!included.length) return 'Sources not checked';
  const gaps = included.filter(s => s.state !== 'available');
  if (!gaps.length) return 'Sources checked';
  if (gaps.some(s => s.state === 'unavailable')) return 'Some sources unavailable';
  if (gaps.some(s => s.state === 'partial')) return 'Source updates need review';
  const automatic = included.filter(s => s.automatic);
  if (automatic.length && automatic.every(s => s.state === 'not_connected')) return 'Automatic sync is off';
  if (gaps.some(s => s.state === 'not_connected')) return 'Some sources not connected';
  return 'Source updates need review';
}
/** A source that should be feeding the agenda and is not. A deliberate
 *  exclusion (a personal calendar) is information, not a gap. */
export function agendaSourceGap(sources: SourceCoverage[]): boolean {
  return sources.some(s => !s.excluded && s.state !== 'available');
}
/** Whether the home's Upcoming block has anything to print: an appointment
 *  in the window (dated or awaiting a date), or a source gap, which stays
 *  visible by the agenda's rules. With neither the feed leaves the block
 *  out, so its All clear can show. */
export function homeAgendaSpeaks(data: AgendaData): boolean {
  const groups = agendaGroups(data.entries, data.today, data.through);
  return groups.scheduled.length + groups.review.length + groups.other.length > 0 || agendaSourceGap(data.sources);
}
export type AgendaData = {
  entries: AgendaEntry[];
  sources: SourceCoverage[];
  today: string;
  through: string;
  canSave: boolean;
};

export function validDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}
const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export function safeSourceUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password &&
      (['calendar.google.com', 'mail.google.com', 'my.quo.com', 'app.quo.com', 'app.openphone.com', 'helm.risingtidestr.com'].includes(u.hostname) || (u.hostname === 'www.google.com' && u.pathname.startsWith('/calendar/'))) ? u.href : null;
  } catch { return null; }
}
/** Validate at the mutation boundary too; form controls are not validation. */
export function validateAppointment(value: unknown): { ok: true; value: AppointmentInput } | { ok: false; error: string } {
  if (!value || typeof value !== 'object') return { ok: false, error: 'Enter an appointment.' };
  const v = value as Record<string, unknown>;
  if (v.attendanceOnly !== undefined && (v.attendanceOnly !== true || !Array.isArray(v.sourceKeys) || v.sourceKeys.length !== 1 ||
    typeof v.sourceKeys[0] !== 'string' || !MEETING_KEY.test(v.sourceKeys[0]) || v.sourceRevisions !== undefined)) {
    return { ok: false, error: 'An attendance answer belongs to exactly one contact meeting.' };
  }
  if (v.sourceRevisions !== undefined && (!v.sourceRevisions || typeof v.sourceRevisions !== 'object' || Array.isArray(v.sourceRevisions) ||
    Object.keys(v.sourceRevisions).length > 40 || Object.entries(v.sourceRevisions).some(([key, revision]) =>
      !/^(gcal|gmail|quo):[^\s]{1,400}$/.test(key) || typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)))) {
    return { ok: false, error: 'Invalid source review. Reload the appointment.' };
  }
  const fields = ['title', 'date', 'time', 'endTime', 'propertyName', 'location', 'people', 'notes', 'sourceLabel', 'sourceUrl', 'reviewReason'] as const;
  for (const field of fields) if (v[field] !== null && typeof v[field] !== 'string') return { ok: false, error: `Invalid ${field}.` };
  const text = (key: typeof fields[number]) => (v[key] as string | null)?.trim() || null;
  const title = text('title'), sourceLabel = text('sourceLabel');
  if (!title || title.length > 200) return { ok: false, error: 'Use a title of 1 to 200 characters.' };
  if (!sourceLabel || sourceLabel.length > 100) return { ok: false, error: 'Name the source of this appointment.' };
  if (!APPOINTMENT_STATUSES.includes(v.status as AppointmentStatus) || !ATTENDANCE.includes(v.attendance as Attendance)) return { ok: false, error: 'Choose a status and who is attending.' };
  if (!['exact', 'arrival_window', 'date_only'].includes(v.timeKind as string)) return { ok: false, error: 'Choose an exact time, arrival window or date only.' };
  const date = text('date'), time = text('time'), endTime = text('endTime');
  if (v.timeKind === 'date_only' && (time || endTime)) return { ok: false, error: 'Clear the times for a date-only appointment.' };
  if (v.timeKind === 'arrival_window' && (!time || !endTime)) return { ok: false, error: 'An arrival window needs both a start and an end.' };
  if (date && !validDay(date)) return { ok: false, error: 'Choose a valid calendar date.' };
  if ([time, endTime].some(t => t && !CLOCK.test(t))) return { ok: false, error: 'Times must be HH:MM in Eastern time.' };
  if (time && !date) return { ok: false, error: 'Choose a date before setting a time.' };
  if (endTime && (!time || endTime <= time)) return { ok: false, error: 'The end of the window must be after the start on the same day.' };
  if (v.status === 'confirmed' && !date) return { ok: false, error: 'A confirmed appointment needs a date.' };
  const sourceUrl = text('sourceUrl');
  if (sourceUrl && (!safeSourceUrl(sourceUrl) || sourceUrl.length > 2000)) return { ok: false, error: 'Use a Google Calendar, Gmail, Quo or Helm source link.' };
  if (!Array.isArray(v.sourceKeys) || v.sourceKeys.length < 1 || v.sourceKeys.length > 20 ||
      v.sourceKeys.some(k => typeof k !== 'string' || !/^(manual|gcal|gmail|quo|helm):[^\s]{1,400}$/.test(k))) return { ok: false, error: 'Provide a stable source identity, without a date added to it.' };
  for (const field of ['propertyName', 'location', 'people', 'notes', 'reviewReason'] as const) {
    if ((text(field)?.length ?? 0) > (field === 'notes' ? 3000 : 500)) return { ok: false, error: `${field} is too long.` };
  }
  return { ok: true, value: {
    title, date, time, endTime, timeKind: v.timeKind as AppointmentInput['timeKind'], status: v.status as AppointmentStatus, attendance: v.attendance as Attendance,
    propertyName: text('propertyName'), location: text('location'), people: text('people'), notes: text('notes'),
    sourceLabel, sourceUrl, sourceKeys: [...new Set(v.sourceKeys as string[])].sort(), reviewReason: text('reviewReason'),
    ...(v.sourceRevisions ? { sourceRevisions: v.sourceRevisions as Record<string, string> } : {}),
    ...(v.attendanceOnly ? { attendanceOnly: true as const } : {}),
  } };
}
export const MEETING_KEY = /^helm:meeting:[a-f0-9-]{36}$/i;
/** The two one-tap answers on a CRM meeting row. */
export const MEETING_ANSWERS = ['attending', 'not_attending'] as const;
export type MeetingAnswer = typeof MEETING_ANSWERS[number];
/** The private record behind a one-tap answer. Generic title and source on
 *  purpose: nothing of the shared meeting is copied into it, so the meeting's
 *  own date, time and place keep coming from the CRM row. */
export function meetingAttendanceDetails(meetingId: string, attendance: MeetingAnswer): AppointmentInput {
  return { title: 'Attendance answer', date: null, time: null, endTime: null, timeKind: 'exact', status: 'tentative', attendance,
    propertyName: null, location: null, people: null, notes: null, sourceLabel: 'Attendance answer', sourceUrl: null,
    sourceKeys: [`helm:meeting:${meetingId}`], reviewReason: null, attendanceOnly: true };
}

/** A conflicting address is a review task, never an automatic reassignment.
 *  Otherwise a CRM meeting or an owner-booked record is an ordinary dated row:
 *  it stays tentative with attendance open (the CRM records neither), and the
 *  row asks for attendance in one tap instead of filing it under review. */
export function meetingReviewReason(m: MeetingCard): string | null {
  if (appointmentAddressConflict(m.propertyName, m.title, m.location)) return 'The title/location names a different street number from the filed property. Verify the source, date and attendance.';
  return null;
}
export function meetingToAgenda(m: MeetingCard): AgendaEntry {
  return {
    id: `meeting:${m.id}`, href: `/crm/${m.contactId}`, version: 0, updatedAt: null, editable: false,
    title: m.title, date: m.date, time: m.time?.slice(0, 5) ?? null, endTime: null, timeKind: 'exact',
    status: 'tentative', attendance: 'coverage_needed', propertyName: m.propertyName, location: m.location,
    people: m.contactName, notes: m.notes, sourceLabel: 'Helm contact record', sourceUrl: null,
    sourceKeys: [`helm:meeting:${m.id}`], reviewReason: meetingReviewReason(m),
  };
}

/** Reviewed records explicitly link their original source(s). Cancelled and
 * rescheduled replacements suppress old rows BEFORE filtering by date. Never
 * merge two similar titles: they can be different inspections. An attendance
 * answer never suppresses its meeting: it sets that row's attendance only. */
export function mergeAgenda(saved: AgendaEntry[], inherited: AgendaEntry[]): AgendaEntry[] {
  const answers = new Map(saved.filter(e => e.attendanceOnly).map(e => [e.sourceKeys[0], e]));
  const records = saved.filter(e => !e.attendanceOnly);
  const claimed = new Set(records.flatMap(e => e.sourceKeys));
  const byIdentity = new Map<string, AgendaEntry>();
  for (const e of [...records].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))) {
    if (!e.sourceKeys.some(k => byIdentity.has(k))) for (const k of e.sourceKeys) byIdentity.set(k, e);
  }
  const answered = (e: AgendaEntry): AgendaEntry => {
    const a = e.id.startsWith('meeting:') ? answers.get(`helm:${e.id}`) : undefined;
    return a ? { ...e, attendance: a.attendance, attendanceAnswer: { id: a.id, version: a.version } } : e;
  };
  return [...new Set(byIdentity.values()), ...inherited.filter(e => !e.sourceKeys.some(k => claimed.has(k))).map(answered)];
}
export function agendaWindow(now = new Date()) {
  const today = operatingDate(now);
  return { today, through: addDays(today, AGENDA_DAYS - 1) };
}
export function agendaGroups(entries: AgendaEntry[], today: string, through: string) {
  const relevant = entries.filter(e => e.status !== 'cancelled' && (e.date === null || e.date <= through || !!e.sourceUpdates?.length) &&
    (e.date === null || e.date >= today || e.status === 'needs_scheduling' || !!e.reviewReason));
  const sort = (a: AgendaEntry, b: AgendaEntry) => (a.date ?? '9999').localeCompare(b.date ?? '9999') ||
    (a.time ?? '99').localeCompare(b.time ?? '99') || a.title.localeCompare(b.title);
  const review = relevant.filter(e => !!e.reviewReason || e.status === 'needs_scheduling' || !e.date || (e.date < today));
  const ready = relevant.filter(e => !review.includes(e));
  return {
    scheduled: ready.filter(e => e.attendance === 'attending' || e.attendance === 'coverage_needed').sort(sort),
    review: review.sort(sort),
    other: ready.filter(e => e.attendance === 'owner_handled' || e.attendance === 'not_attending').sort(sort),
  };
}
/** Home is a short preview, not a second full agenda. Dated tentative plans
 * remain in date order. Owner-handled and undated records stay in the full view. */
export function homeAgendaPreview(groups: ReturnType<typeof agendaGroups>, today: string, through: string) {
  return [...groups.scheduled, ...groups.review]
    .filter(e => e.date && e.date >= today && e.date <= through &&
      (e.attendance === 'attending' || e.attendance === 'coverage_needed'))
    .sort((a, b) => a.date!.localeCompare(b.date!) || (a.time ?? '99').localeCompare(b.time ?? '99') || a.id.localeCompare(b.id))
    .slice(0, 3);
}
export const STATUS_LABEL: Record<AppointmentStatus, string> = { confirmed: 'Confirmed', tentative: 'Tentative', needs_scheduling: 'Awaiting scheduling', cancelled: 'Cancelled' };
export const ATTENDANCE_LABEL: Record<Attendance, string> = { attending: 'You are attending', coverage_needed: 'Assign team coverage', owner_handled: 'Owner is handling', not_attending: 'You are not attending' };
export function appointmentClock(e: Pick<AgendaEntry, 'time' | 'endTime' | 'timeKind'>): string {
  if (e.timeKind === 'date_only') return 'Date only';
  return e.time ? `${e.timeKind === 'arrival_window' ? 'Arrival ' : ''}${formatMeetingTime(e.time)}${e.endTime ? ` to ${formatMeetingTime(e.endTime)}` : ''} ET` : 'Time to confirm';
}
/** Same wall clocks as the full agenda, with the shared timezone printed once. */
export function compactAppointmentClock(e: Pick<AgendaEntry, 'time' | 'endTime' | 'timeKind'>): string {
  if (!e.time) return e.timeKind === 'date_only' ? 'Date only' : 'Time TBD';
  let start = formatMeetingTime(e.time) ?? 'Time TBD';
  const end = (formatMeetingTime(e.endTime) ?? '').replace('12 PM', 'noon');
  if (end && / (AM|PM)$/.exec(start)?.[1] === / (AM|PM)$/.exec(end)?.[1]) start = start.replace(/ (AM|PM)$/, '');
  return `${e.timeKind === 'arrival_window' ? 'Arrival ' : ''}${start}${end ? `–${end}` : ''}`;
}
/** Use local wall clocks on the SAME Eastern day. No fixed UTC offset, no
 * invented duration for meetings without an end. Adjacent windows don't clash. */
export function overlappingAppointments(entries: AgendaEntry[]): Set<string> {
  const result = new Set<string>();
  const eligible = entries.filter(e => e.date && e.time && !e.reviewReason && e.status !== 'cancelled' && e.status !== 'needs_scheduling' &&
    (e.attendance === 'attending' || e.attendance === 'coverage_needed'));
  for (let i = 0; i < eligible.length; i++) for (let j = i + 1; j < eligible.length; j++) {
    const a = eligible[i], b = eligible[j];
    if (a.date !== b.date) continue;
    const overlap = a.time === b.time || (a.time! < b.time! ? !!a.endTime && b.time! < a.endTime : !!b.endTime && a.time! < b.endTime);
    if (overlap) { result.add(a.id); result.add(b.id); }
  }
  return result;
}

/** Canonical aliases from supported source links. Calendar and email copies can
 * be attached to one appointment; their dates are deliberately not part of IDs. */
export function sourceKeyFromUrl(value: string | null, email: string): string | null {
  const safe = safeSourceUrl(value);
  if (!safe) return null;
  const u = new URL(safe);
  if (u.hostname === 'mail.google.com') {
    const id = u.hash.split('/').at(-1);
    return id && /^[a-f0-9]{12,32}$/.test(id) ? `gmail:${email}:${id}` : null;
  }
  if (u.hostname === 'calendar.google.com' || u.hostname === 'www.google.com') {
    const encoded = u.searchParams.get('eid');
    if (encoded) try {
      const decoded = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
      const [eventId, calendarId] = decoded.split(' ');
      if (eventId && calendarId && /^[a-zA-Z0-9_@.\-]+$/.test(eventId + calendarId)) return `gcal:${calendarId}:${eventId}`;
    } catch { /* Keep a manual identity when the provider link cannot resolve. */ }
  }
  return null;
}
