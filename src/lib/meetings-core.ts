/**
 * Contact meetings: the pure half. Types, Eastern date math, the reminder
 * text. No database, no env, so `meeting-reminders.test.ts` can exercise it.
 * The loaders and the cron's claim-and-send live in `meetings.ts`.
 *
 * A meeting is a dated sit-down with a contact (an owner, a prospect, a
 * vendor), logged on the CRM contact page. Two surfaces read it: the
 * Meetings card on the home feed (today and tomorrow) and the day-before
 * text, which only `important` meetings get. Owner and prospect meetings
 * default to important (Dotti, 2026-10-07).
 */

import { shiftIsoDay, todayInEastern } from './sca-quotes-types.ts';

export type ContactMeetingRow = {
  id: string;
  contact_id: string;
  property_id: string | null;
  title: string;
  /** Eastern calendar day, YYYY-MM-DD. */
  meeting_date: string;
  /** Postgres `time`: "13:00:00", or null when no clock was agreed. */
  meeting_time: string | null;
  location: string | null;
  notes: string | null;
  important: boolean;
  reminder_sent_at: string | null;
  reminder_message_id: string | null;
  reminder_attempts: number;
  reminder_error: string | null;
  cancelled_at: string | null;
  created_by_email: string;
  created_at: string;
  updated_at: string;
};

/** A meeting with its names resolved, ready for a card or a text. */
export type MeetingCard = {
  id: string;
  contactId: string;
  contactName: string;
  propertyName: string | null;
  title: string;
  date: string;
  time: string | null;
  location: string | null;
  notes: string | null;
  important: boolean;
};

/** The evening-before text goes at or after this Eastern hour. The cron is
 *  scheduled at 21, 22 and 23 UTC, so the first slot at or past 5 PM ET
 *  sends and the later slots are retries for a failed send. */
export const REMINDER_HOUR_ET = 17;

/** How many attempts a reminder gets before the cron stops trying. */
export const REMINDER_MAX_ATTEMPTS = 3;

/** Today in Gloucester. */
export function todayET(now: Date = new Date()): string {
  return todayInEastern(now);
}

/** The day the evening-before text is about. */
export function reminderTargetDate(now: Date = new Date()): string {
  return shiftIsoDay(todayET(now), 1);
}

/** True once the Eastern clock has reached the send hour. */
export function inReminderWindow(hourET: number): boolean {
  return hourET >= REMINDER_HOUR_ET;
}

/** Owner and prospect meetings are the important ones by default. */
export function defaultImportant(contactType: string): boolean {
  return contactType === 'owner' || contactType === 'lead';
}

/** "13:00:00" or "13:00" -> "1 PM"; "09:30" -> "9:30 AM". Null stays null. */
export function formatMeetingTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return value;
  const h = Number(m[1]);
  const min = m[2];
  if (h < 0 || h > 23) return value;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return min === '00' ? `${h12} ${ampm}` : `${h12}:${min} ${ampm}`;
}

/** "2026-10-12" -> "Mon, Oct 12". */
export function formatMeetingDay(ymd: string): string {
  const [y, mo, d] = ymd.split('-').map(Number);
  if (!y || !mo || !d) return ymd;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(Date.UTC(y, mo - 1, d)));
}

export type MeetingDayLabel = 'today' | 'tomorrow' | 'past' | 'later';

/** Where a meeting sits relative to today (both Eastern calendar days). */
export function meetingDayLabel(meetingDate: string, today: string): MeetingDayLabel {
  if (meetingDate === today) return 'today';
  if (meetingDate === shiftIsoDay(today, 1)) return 'tomorrow';
  return meetingDate < today ? 'past' : 'later';
}

/** One line of "when": "Tomorrow, Mon, Oct 12 · 1 PM". */
export function meetingWhen(m: Pick<MeetingCard, 'date' | 'time'>, today: string): string {
  const label = meetingDayLabel(m.date, today);
  const prefix = label === 'today' ? 'Today, ' : label === 'tomorrow' ? 'Tomorrow, ' : '';
  const time = formatMeetingTime(m.time);
  return `${prefix}${formatMeetingDay(m.date)}${time ? ` · ${time}` : ''}`;
}

/** The evening-before text. Same shape as the AirDNA reminder: a Helm
 *  header line, the facts, a link back to the contact. Internal, so it
 *  carries the property's internal name, never the guest-facing title. */
export function meetingReminderText(m: MeetingCard, contactUrl: string): string {
  const time = formatMeetingTime(m.time);
  const who = m.propertyName ? `${m.contactName} (${m.propertyName})` : m.contactName;
  const lines = [
    'Helm · Meeting tomorrow',
    `${who}, ${formatMeetingDay(m.date)}${time ? ` at ${time}` : ''}`,
  ];
  if (m.title && m.title.trim() && m.title.trim().toLowerCase() !== `meeting with ${m.contactName}`.toLowerCase()) {
    lines.push(m.title.trim());
  }
  if (m.location) lines.push(`Where: ${m.location}`);
  if (m.notes) lines.push(m.notes);
  lines.push(contactUrl);
  return lines.join('\n');
}

/** The title the form fills in when the operator leaves it blank. */
export function defaultMeetingTitle(contactName: string): string {
  return `Meeting with ${contactName}`;
}

/** Which meetings the evening-before sweep should text now. Pure, so the
 *  test can pin the rules: tomorrow only, important only, not cancelled,
 *  never already sent, and give up after REMINDER_MAX_ATTEMPTS. */
export function meetingsDueForReminder<T extends Pick<ContactMeetingRow,
  'meeting_date' | 'important' | 'cancelled_at' | 'reminder_sent_at' | 'reminder_attempts'>>(
  rows: T[],
  now: Date = new Date(),
): T[] {
  const target = reminderTargetDate(now);
  return rows.filter(
    (r) =>
      r.meeting_date === target &&
      r.important &&
      !r.cancelled_at &&
      !r.reminder_sent_at &&
      r.reminder_attempts < REMINDER_MAX_ATTEMPTS,
  );
}

/** Parse an E.164-ish recipient list from env. Accepts "+1978..." or
 *  "(978) 555-1234"; drops blanks and anything without ten digits. */
export function parseRecipientList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(/[,\n;]/)) {
    const digits = part.replace(/\D/g, '');
    if (!digits) continue;
    const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    if (national.length !== 10) continue;
    const e164 = `+1${national}`;
    if (!out.includes(e164)) out.push(e164);
  }
  return out;
}
