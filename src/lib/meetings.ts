/**
 * Contact meetings: the database half. Loaders for the contact page and the
 * home feed, and the evening-before reminder sweep the cron calls.
 *
 * Pure rules (which meetings are due, the text itself) live in
 * `meetings-core.ts` so they can be tested without a database.
 */

import 'server-only';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { selectAllPaged } from '@/lib/paged-select';
import { helmBaseUrl } from '@/lib/daily-brief';
import { shiftIsoDay } from '@/lib/sca-quotes-types';
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
  /** Filled by withPropertyNames, not by the read. */
  property_name?: string | null;
};

// contacts(...) embeds because contact_id is a foreign key. property_id is not
// (20261007100000_contact_meetings.sql), so PostgREST cannot embed
// properties(...): asking for it failed EVERY read with "Could not find a
// relationship". From 10/07 to 10/22 the reminder cron returned 500 on every
// run and the home Meetings card was silently empty. Names come from a second
// read in withPropertyNames; meeting-reminders.test.ts keeps the embed out.
const JOIN_SELECT = '*, contacts(id, name)';

/** The home's internal name for each meeting that names one. A failed read
 *  leaves the names off, and the card falls back to the property id. */
async function withPropertyNames(rows: MeetingJoinRow[]): Promise<MeetingJoinRow[]> {
  const ids = [...new Set(rows.map((r) => r.property_id).filter((id): id is string => !!id))];
  if (ids.length === 0) return rows;
  const { data, error } = await supabase.from('properties').select('id, name').in('id', ids);
  if (error) console.error(`contact_meetings: property names read failed: ${error.message}`);
  const names = new Map(((data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  return rows.map((r) => ({ ...r, property_name: r.property_id ? (names.get(r.property_id) ?? null) : null }));
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function toCard(r: MeetingJoinRow): MeetingCard {
  const contact = one(r.contacts);
  return {
    id: r.id,
    contactId: r.contact_id,
    contactName: contact?.name ?? 'Contact',
    propertyName: r.property_name ?? r.property_id,
    title: r.title,
    date: r.meeting_date,
    time: r.meeting_time,
    location: r.location,
    notes: r.notes,
    important: r.important,
    kind: r.kind === 'appointment' ? 'appointment' : 'meeting',
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

/** Meetings for the home feed: from today in Gloucester through `days`
 *  calendar days (today and tomorrow when none is given; This week passes
 *  seven), with the contact and property names resolved. Empty on any read
 *  failure, so the home page never breaks over a calendar card.
 *
 *  `createdBy` narrows to the meetings one person logged: a staff login's
 *  feed shows the sit-downs it logged, not the owners' meetings with owners and
 *  prospects. Owners pass nothing and see every meeting. */
export async function loadMeetingCards(
  now: Date = new Date(),
  opts: { createdBy?: string; days?: number } = {},
): Promise<MeetingCard[]> {
  return (await loadMeetingCardsResult(now, opts)).cards;
}

/** The agenda must distinguish a successful empty read from a failed source. */
export async function loadMeetingCardsResult(
  now: Date = new Date(),
  opts: { createdBy?: string; days?: number } = {},
): Promise<{ cards: MeetingCard[]; available: boolean }> {
  try {
    const today = todayET(now);
    const last = opts.days && opts.days > 1 ? shiftIsoDay(today, opts.days - 1) : reminderTargetDate(now);
    const rows = await selectAllPaged<MeetingJoinRow>((from, to) => {
      let q = supabase.from('contact_meetings').select(JOIN_SELECT)
        .is('cancelled_at', null).gte('meeting_date', today).lte('meeting_date', last);
      if (opts.createdBy) q = q.eq('created_by_email', opts.createdBy);
      return q.order('meeting_date').order('meeting_time', { nullsFirst: false }).order('id').range(from, to);
    }, { label: 'loadMeetingCards: contact_meetings read failed', maxRows: 10000 });
    return { cards: (await withPropertyNames(rows)).map(toCard), available: true };
  } catch {
    console.error('loadMeetingCards: contact_meetings read failed');
    return { cards: [], available: false };
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

  const rows = await withPropertyNames(meetingsDueForReminder((data ?? []) as MeetingJoinRow[], now));
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
