/**
 * Contact meetings: the database half. Loaders for the contact page and the
 * home feed, and the evening-before reminder sweep the cron calls.
 *
 * Pure rules (which meetings are due, the text itself) live in
 * `meetings-core.ts` so they can be tested without a database.
 */

import 'server-only';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { helmBaseUrl } from '@/lib/daily-brief';
import { normalizePhone, quoFromNumber, sendMessage } from '@/lib/quo';
import {
  REMINDER_MAX_ATTEMPTS,
  meetingReminderText,
  meetingsDueForReminder,
  parseRecipientList,
  reminderTargetDate,
  todayET,
  type ContactMeetingRow,
  type MeetingCard,
} from '@/lib/meetings-core';

type MeetingJoinRow = ContactMeetingRow & {
  contacts: { id: string; name: string } | { id: string; name: string }[] | null;
  properties: { id: string; name: string } | { id: string; name: string }[] | null;
};

const JOIN_SELECT = '*, contacts(id, name), properties(id, name)';

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function toCard(r: MeetingJoinRow): MeetingCard {
  const contact = one(r.contacts);
  const property = one(r.properties);
  return {
    id: r.id,
    contactId: r.contact_id,
    contactName: contact?.name ?? 'Contact',
    propertyName: property?.name ?? r.property_id,
    title: r.title,
    date: r.meeting_date,
    time: r.meeting_time,
    location: r.location,
    notes: r.notes,
    important: r.important,
  };
}

/** Everything still on the calendar for one contact, soonest first, plus
 *  the last few that already happened (newest first). Cancelled rows are
 *  left out of both. */
export async function listContactMeetings(contactId: string): Promise<{
  upcoming: ContactMeetingRow[];
  past: ContactMeetingRow[];
}> {
  const today = todayET();
  const [{ data: upcoming }, { data: past }] = await Promise.all([
    supabase
      .from('contact_meetings')
      .select('*')
      .eq('contact_id', contactId)
      .is('cancelled_at', null)
      .gte('meeting_date', today)
      .order('meeting_date', { ascending: true })
      .order('meeting_time', { ascending: true, nullsFirst: false }),
    supabase
      .from('contact_meetings')
      .select('*')
      .eq('contact_id', contactId)
      .is('cancelled_at', null)
      .lt('meeting_date', today)
      .order('meeting_date', { ascending: false })
      .limit(6),
  ]);
  return {
    upcoming: (upcoming ?? []) as ContactMeetingRow[],
    past: (past ?? []) as ContactMeetingRow[],
  };
}

/** Meetings for the home feed: today and tomorrow in Gloucester, with the
 *  contact and property names resolved. Empty on any read failure, so the
 *  home page never breaks over a calendar card. */
export async function loadMeetingCards(now: Date = new Date()): Promise<MeetingCard[]> {
  try {
    const today = todayET(now);
    const tomorrow = reminderTargetDate(now);
    const { data } = await supabase
      .from('contact_meetings')
      .select(JOIN_SELECT)
      .is('cancelled_at', null)
      .gte('meeting_date', today)
      .lte('meeting_date', tomorrow)
      .order('meeting_date', { ascending: true })
      .order('meeting_time', { ascending: true, nullsFirst: false })
      .limit(12);
    return ((data ?? []) as MeetingJoinRow[]).map(toCard);
  } catch {
    return [];
  }
}

/** Who the evening-before text goes to. MEETING_REMINDER_PHONES (comma
 *  list) when set, otherwise DOTTI_PHONE, the AirDNA reminder's recipient. */
export function meetingReminderRecipients(): string[] {
  const explicit = parseRecipientList(process.env.MEETING_REMINDER_PHONES);
  if (explicit.length > 0) return explicit;
  return parseRecipientList(process.env.DOTTI_PHONE);
}

export type ReminderOutcome = {
  id: string;
  contactName: string;
  status: 'sent' | 'dry' | 'failed' | 'skipped_claimed';
  to?: string[];
  error?: string;
  body?: string;
};

export type ReminderSweep = {
  targetDate: string;
  recipients: string[];
  candidates: number;
  outcomes: ReminderOutcome[];
};

/**
 * The evening-before sweep. Reads tomorrow's important meetings that have
 * not been texted, claims each one by bumping `reminder_attempts` against
 * the value just read (an optimistic lock, so two overlapping runs cannot
 * both send), texts the recipients from the 24/7 line, and stamps
 * `reminder_sent_at` with the first Quo message id. A failed send keeps
 * the stamp empty and records the error, so the next hourly slot retries
 * until REMINDER_MAX_ATTEMPTS.
 *
 * `dry` composes and reports without claiming or sending.
 */
export async function sendMeetingReminders(opts: { dry?: boolean; now?: Date } = {}): Promise<ReminderSweep> {
  const now = opts.now ?? new Date();
  const targetDate = reminderTargetDate(now);
  const recipients = meetingReminderRecipients();

  const { data, error } = await supabase
    .from('contact_meetings')
    .select(JOIN_SELECT)
    .eq('meeting_date', targetDate)
    .eq('important', true)
    .is('cancelled_at', null)
    .is('reminder_sent_at', null)
    .lt('reminder_attempts', REMINDER_MAX_ATTEMPTS);
  if (error) throw new Error(`contact_meetings read failed: ${error.message}`);

  const rows = meetingsDueForReminder((data ?? []) as MeetingJoinRow[], now);
  const outcomes: ReminderOutcome[] = [];

  for (const row of rows) {
    const card = toCard(row);
    const body = meetingReminderText(card, `${helmBaseUrl()}/crm/${card.contactId}`);

    if (opts.dry) {
      outcomes.push({ id: row.id, contactName: card.contactName, status: 'dry', to: recipients, body });
      continue;
    }

    if (recipients.length === 0) {
      outcomes.push({
        id: row.id,
        contactName: card.contactName,
        status: 'failed',
        error: 'no recipient: set DOTTI_PHONE or MEETING_REMINDER_PHONES',
      });
      continue;
    }

    // Claim: only the run that bumps attempts from the value it read sends.
    const { data: claimed } = await supabase
      .from('contact_meetings')
      .update({ reminder_attempts: row.reminder_attempts + 1 })
      .eq('id', row.id)
      .eq('reminder_attempts', row.reminder_attempts)
      .is('reminder_sent_at', null)
      .select('id');
    if (!claimed || claimed.length === 0) {
      outcomes.push({ id: row.id, contactName: card.contactName, status: 'skipped_claimed' });
      continue;
    }

    const from = quoFromNumber('ops');
    const sentIds: string[] = [];
    const errors: string[] = [];
    for (const to of recipients) {
      try {
        const sent = await sendMessage({ from, to: `+1${normalizePhone(to)}`, content: body });
        sentIds.push(sent.id);
      } catch (err) {
        errors.push(`${to}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (sentIds.length > 0) {
      await supabase
        .from('contact_meetings')
        .update({
          reminder_sent_at: now.toISOString(),
          reminder_message_id: sentIds[0],
          reminder_error: errors.length ? errors.join(' | ') : null,
        })
        .eq('id', row.id);
      outcomes.push({ id: row.id, contactName: card.contactName, status: 'sent', to: recipients });
    } else {
      await supabase
        .from('contact_meetings')
        .update({ reminder_error: errors.join(' | ') || 'send failed' })
        .eq('id', row.id);
      outcomes.push({ id: row.id, contactName: card.contactName, status: 'failed', error: errors.join(' | ') });
    }
  }

  return { targetDate, recipients, candidates: rows.length, outcomes };
}
