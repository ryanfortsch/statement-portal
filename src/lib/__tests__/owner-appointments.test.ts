// An appointment the owner booked at the house becomes an important
// appointment on their CRM contact (2026-10-23).
//
// Laila Rocha, 3 Windward: "Just made an appointment for the inspection on
// November 6th (Friday). The window they gave me is 9:30-12. We can give them
// a call the morning of, between 8:30-9:15am." The approved reply promised
// someone there and a call ahead; what filed was an undated work slip, and
// nothing would have texted anyone on the 5th or the 6th.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  appointmentKey,
  appointmentNotes,
  appointmentRow,
  checkOwnerAppointment,
  pickOwnerContact,
  type OwnerAppointment,
  type OwnerContactPick,
} from '../owner-appointments-core.ts';
import { appointmentReminderText, meetingReminderText, type MeetingCard } from '../meetings-core.ts';

const read = (repoPath: string): string => readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');
const code = (repoPath: string): string => read(repoPath).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

const LAILA: OwnerAppointment = {
  cardId: 'card-laila',
  propertyId: '3_windward',
  date: '2026-11-06',
  startTime: '09:30',
  endTime: '12:00',
  what: 'City of Gloucester safety inspection',
  who: 'city building and fire inspectors',
  instructions: 'Call 978-325-5210 between 8:30 and 9:15 AM for a tighter arrival time. Reference RRST-26-307. Someone must be at the house',
  ownerName: 'Laila Rocha',
  ownerContact: '+17865184199',
  channel: 'sms',
  message: 'Just made an appointment for the inspection on November 6th (Friday). The window they gave me is 9:30-12am.',
  messageAt: '2026-10-22T20:41:00Z',
  slipRequestKey: 'owner:card-laila:city-of-gloucester-safety-inspection',
};

const MOYNAHANS: OwnerContactPick = {
  id: 'c-moynahan', name: 'The Moynahan Family', type: 'owner',
  linked_property_ids: ['73_rocky_neck'], emails: ['matthewmoynahan@yahoo.com', 'lailarocha@gmail.com'], phone: null,
};
const CLAUDIA: OwnerContactPick = {
  id: 'c-claudia', name: 'Claudia Kittredge', type: 'owner',
  linked_property_ids: ['21_horton'], emails: ['ckittred1@gmail.com'], phone: '+19192599238',
};
const A_LEAD: OwnerContactPick = {
  id: 'c-lead', name: 'Someone Curious', type: 'lead', linked_property_ids: ['3_windward'], emails: ['lailarocha@gmail.com'], phone: '+17865184199',
};

describe('what an appointment must carry', () => {
  test("Laila's inspection is complete", () => {
    assert.equal(checkOwnerAppointment(LAILA), null);
  });

  test('missing its card, home, day, name or words, it is refused', () => {
    assert.match(checkOwnerAppointment({ ...LAILA, cardId: '' })!, /card_id/);
    assert.match(checkOwnerAppointment({ ...LAILA, propertyId: ' ' })!, /property_id/);
    assert.match(checkOwnerAppointment({ ...LAILA, date: 'November 6' })!, /YYYY-MM-DD/);
    assert.match(checkOwnerAppointment({ ...LAILA, startTime: '9:30am' })!, /HH:MM/);
    assert.match(checkOwnerAppointment({ ...LAILA, endTime: 'noon' })!, /HH:MM/);
    assert.match(checkOwnerAppointment({ ...LAILA, what: '' })!, /what/);
    assert.match(checkOwnerAppointment({ ...LAILA, message: '' })!, /message/);
  });

  test('one appointment per owner card and day', () => {
    assert.equal(appointmentKey('card-laila', '2026-11-06'), 'ownerappt:card-laila:2026-11-06');
  });
});

describe('which contact it lands on', () => {
  test('the owner contact linked to the home wins', () => {
    assert.equal(pickOwnerContact([MOYNAHANS, CLAUDIA], '21_horton', [], '+10000000000')?.id, 'c-claudia');
  });

  test("3 Windward: the Moynahans are linked to 73 Rocky Neck only, and the home's statement emails find them", () => {
    const pick = pickOwnerContact([CLAUDIA, MOYNAHANS], '3_windward', ['matthewmoynahan@yahoo.com', 'LailaRocha@gmail.com'], '+17865184199');
    assert.equal(pick?.id, 'c-moynahan');
  });

  test('then the phone or address the owner wrote from', () => {
    assert.equal(pickOwnerContact([MOYNAHANS, CLAUDIA], '7_sumac', [], '(919) 259-9238')?.id, 'c-claudia');
    assert.equal(pickOwnerContact([MOYNAHANS, CLAUDIA], '7_sumac', null, 'LAILAROCHA@gmail.com')?.id, 'c-moynahan');
  });

  test('a prospect is never the owner, and nobody is a refusal, not a guess', () => {
    assert.equal(pickOwnerContact([A_LEAD], '3_windward', ['lailarocha@gmail.com'], '+17865184199'), null);
    assert.equal(pickOwnerContact([CLAUDIA], '3_windward', [], ''), null);
  });
});

describe('the row it becomes', () => {
  test("Laila's inspection: important, on the home, the window and the call-ahead in the notes", () => {
    const row = appointmentRow(LAILA, 'c-moynahan', '3 Windward', 'concierge@helm.system');
    assert.equal(row.contact_id, 'c-moynahan');
    assert.equal(row.property_id, '3_windward');
    assert.equal(row.kind, 'appointment');
    assert.equal(row.source_key, 'ownerappt:card-laila:2026-11-06');
    assert.equal(row.title, 'City of Gloucester safety inspection');
    assert.equal(row.meeting_date, '2026-11-06');
    assert.equal(row.meeting_time, '09:30');
    assert.equal(row.location, '3 Windward');
    assert.equal(row.important, true);
    assert.equal(row.created_by_email, 'concierge@helm.system');
    assert.equal(
      row.notes,
      'City building and fire inspectors. Window 9:30 AM to 12 PM. Call 978-325-5210 between 8:30 and 9:15 AM for a tighter arrival time. Reference RRST-26-307. Someone must be at the house.',
    );
  });

  test('no time, no window; nothing to say, no notes', () => {
    assert.equal(appointmentNotes({ who: '', startTime: null, endTime: null, instructions: '' }), null);
    assert.equal(appointmentNotes({ who: 'the electrician', startTime: '14:00', endTime: null, instructions: 'Let him in.' }), 'The electrician. Let him in.');
    assert.equal(appointmentRow({ ...LAILA, startTime: null, endTime: null }, 'c', '3 Windward', 'x').meeting_time, null);
  });
});

describe('the evening-before text', () => {
  const card: MeetingCard = {
    id: 'm1', contactId: 'c-moynahan', contactName: 'The Moynahan Family', propertyName: '3 Windward',
    title: 'City of Gloucester safety inspection', date: '2026-11-06', time: '09:30:00', location: '3 Windward',
    notes: 'City building and fire inspectors. Window 9:30 AM to 12 PM. Call 978-325-5210 between 8:30 and 9:15 AM.',
    important: true, kind: 'appointment',
  };

  test('leads with the home, says what and when, what to do, and who booked it', () => {
    const text = meetingReminderText(card, 'https://helm.risingtidestr.com/crm/c-moynahan');
    assert.equal(text, appointmentReminderText(card, 'https://helm.risingtidestr.com/crm/c-moynahan'));
    assert.deepEqual(text.split('\n'), [
      'Helm · Appointment tomorrow',
      '3 Windward, Fri, Nov 6 at 9:30 AM',
      'City of Gloucester safety inspection',
      'City building and fire inspectors. Window 9:30 AM to 12 PM. Call 978-325-5210 between 8:30 and 9:15 AM.',
      'Booked by The Moynahan Family',
      'https://helm.risingtidestr.com/crm/c-moynahan',
    ]);
  });

  test('a meeting logged by hand reads as before', () => {
    const text = meetingReminderText({ ...card, kind: 'meeting', title: 'Meeting with The Moynahan Family' }, 'u');
    assert.equal(text.split('\n')[0], 'Helm · Meeting tomorrow');
    assert.ok(!text.includes('Booked by'));
  });
});

describe('the filer writes the calendar, never the house', () => {
  const filer = code('src/lib/owner-appointments.ts');
  const route = code('src/app/api/owner-appointments/route.ts');

  test('it reads the home and the owner contacts, writes the meeting, and dates only an undated slip', () => {
    const tables = new Set([...filer.matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1]));
    assert.deepEqual([...tables].sort(), ['contact_meetings', 'contacts', 'properties', 'work_slips']);
    assert.ok(/\.upsert\(row, \{ onConflict: 'source_key', ignoreDuplicates: true \}\)/.test(filer), 'one row per card and day, whoever files it');
    assert.ok(/\.update\(\{ scheduled_date: a\.date \}\)[\s\S]*?\.is\('scheduled_date', null\)/.test(filer), 'a date someone set by hand stays');
  });

  test('a home with no owner in the CRM is a refusal with what to do, never a guess', () => {
    assert.ok(filer.includes('status: 422'));
    assert.ok(filer.includes('add or link the owner on /crm'));
  });

  test("the route is the concierge's, header-authorized and allowlisted", () => {
    assert.ok(route.includes('authorizeStayConcierge(req)'));
    assert.ok(route.indexOf('authorizeStayConcierge(req)') < route.indexOf('fileOwnerAppointment('));
    assert.ok(read('src/proxy.ts').includes('"/api/owner-appointments",'));
  });

  test('the reminder sweep needs no new rail: an appointment is an important meeting row', () => {
    const sweep = code('src/lib/meetings.ts');
    assert.ok(sweep.includes(".eq('important', true)"));
    assert.ok(sweep.includes("kind: r.kind === 'appointment' ? 'appointment' : 'meeting'"));
  });
});
