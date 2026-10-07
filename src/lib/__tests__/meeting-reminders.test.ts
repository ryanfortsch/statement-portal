/**
 * The evening-before meeting reminder: which meetings get the text, when
 * the sweep runs, and what the text says.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REMINDER_HOUR_ET,
  REMINDER_MAX_ATTEMPTS,
  defaultImportant,
  formatMeetingDay,
  formatMeetingTime,
  inReminderWindow,
  meetingDayLabel,
  meetingReminderText,
  meetingWhen,
  meetingsDueForReminder,
  parseRecipientList,
  reminderTargetDate,
  todayET,
  type MeetingCard,
} from '../meetings-core.ts';

// 2026-10-11 at 9 PM Eastern (EDT, UTC-4): already the 12th in UTC.
const SUNDAY_EVENING_ET = new Date('2026-10-12T01:00:00Z');

function row(over: Partial<{
  meeting_date: string;
  important: boolean;
  cancelled_at: string | null;
  reminder_sent_at: string | null;
  reminder_attempts: number;
}> = {}) {
  return {
    meeting_date: '2026-10-12',
    important: true,
    cancelled_at: null,
    reminder_sent_at: null,
    reminder_attempts: 0,
    ...over,
  };
}

test('the sweep reads the Eastern calendar, not UTC: a 9 PM Sunday run targets Monday', () => {
  assert.equal(todayET(SUNDAY_EVENING_ET), '2026-10-11');
  assert.equal(reminderTargetDate(SUNDAY_EVENING_ET), '2026-10-12');
});

test('only tomorrow, only important, never cancelled, never twice, three attempts at most', () => {
  const due = meetingsDueForReminder(
    [
      row(),
      row({ meeting_date: '2026-10-13' }),
      row({ meeting_date: '2026-10-11' }),
      row({ important: false }),
      row({ cancelled_at: '2026-10-10T00:00:00Z' }),
      row({ reminder_sent_at: '2026-10-11T21:00:00Z' }),
      row({ reminder_attempts: REMINDER_MAX_ATTEMPTS }),
      row({ reminder_attempts: REMINDER_MAX_ATTEMPTS - 1 }),
    ],
    SUNDAY_EVENING_ET,
  );
  assert.deepEqual(
    due.map((r) => [r.meeting_date, r.important, r.reminder_attempts]),
    [
      ['2026-10-12', true, 0],
      ['2026-10-12', true, REMINDER_MAX_ATTEMPTS - 1],
    ],
  );
});

test('the text goes out at 5 PM Eastern or later, never earlier in the day', () => {
  assert.equal(REMINDER_HOUR_ET, 17);
  assert.equal(inReminderWindow(16), false);
  assert.equal(inReminderWindow(17), true);
  assert.equal(inReminderWindow(19), true);
});

test('owner and prospect meetings are important by default; a vendor coffee is not', () => {
  assert.equal(defaultImportant('owner'), true);
  assert.equal(defaultImportant('lead'), true);
  assert.equal(defaultImportant('vendor'), false);
  assert.equal(defaultImportant('other'), false);
});

test('times read like a person wrote them and a Postgres time value is accepted', () => {
  assert.equal(formatMeetingTime('13:00:00'), '1 PM');
  assert.equal(formatMeetingTime('09:30'), '9:30 AM');
  assert.equal(formatMeetingTime('00:15:00'), '12:15 AM');
  assert.equal(formatMeetingTime('12:00'), '12 PM');
  assert.equal(formatMeetingTime(null), null);
  assert.equal(formatMeetingDay('2026-10-12'), 'Mon, Oct 12');
});

test('day labels and the when-line', () => {
  assert.equal(meetingDayLabel('2026-10-11', '2026-10-11'), 'today');
  assert.equal(meetingDayLabel('2026-10-12', '2026-10-11'), 'tomorrow');
  assert.equal(meetingDayLabel('2026-10-10', '2026-10-11'), 'past');
  assert.equal(meetingDayLabel('2026-10-20', '2026-10-11'), 'later');
  assert.equal(meetingWhen({ date: '2026-10-12', time: '13:00:00' }, '2026-10-11'), 'Tomorrow, Mon, Oct 12 · 1 PM');
  assert.equal(meetingWhen({ date: '2026-10-12', time: null }, '2026-10-12'), 'Today, Mon, Oct 12');
  assert.equal(meetingWhen({ date: '2026-10-20', time: '08:00' }, '2026-10-11'), 'Tue, Oct 20 · 8 AM');
});

test('the reminder names the contact and the home, the day, the time, and links the contact', () => {
  const lisa: MeetingCard = {
    id: 'm1',
    contactId: 'c1',
    contactName: 'Lisa Gruber',
    propertyName: '16 Waterman',
    title: 'Meeting with Lisa Gruber',
    date: '2026-10-12',
    time: '13:00:00',
    location: 'At the house',
    notes: 'Deck furniture and the winter plan',
    important: true,
  };
  const text = meetingReminderText(lisa, 'https://helm.risingtidestr.com/crm/c1');
  assert.equal(
    text,
    [
      'Helm · Meeting tomorrow',
      'Lisa Gruber (16 Waterman), Mon, Oct 12 at 1 PM',
      'Where: At the house',
      'Deck furniture and the winter plan',
      'https://helm.risingtidestr.com/crm/c1',
    ].join('\n'),
  );
  // The default title says nothing the first line does not; a custom one is kept.
  const custom = meetingReminderText({ ...lisa, title: 'Renewal conversation', location: null, notes: null, time: null }, 'u');
  assert.equal(custom, ['Helm · Meeting tomorrow', 'Lisa Gruber (16 Waterman), Mon, Oct 12', 'Renewal conversation', 'u'].join('\n'));
  // No em dashes anywhere in a Helm text.
  assert.equal(text.includes('—'), false);
});

test('recipients: E.164 or a typed US number, blanks dropped, no duplicates, no short numbers', () => {
  assert.deepEqual(parseRecipientList('+19785551234, (978) 555-1234,  ,978-555-9999'), ['+19785551234', '+19785559999']);
  assert.deepEqual(parseRecipientList('12345'), []);
  assert.deepEqual(parseRecipientList(''), []);
  assert.deepEqual(parseRecipientList(undefined), []);
});
