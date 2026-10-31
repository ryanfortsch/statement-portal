import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { appointmentAddressConflict } from '../appointment-evidence.ts';
import { checkOwnerAppointment } from '../owner-appointments-core.ts';
import { agendaGroups, agendaWindow, appointmentClock, meetingToAgenda, mergeAgenda, overlappingAppointments, safeSourceUrl, sourceKeyFromUrl, validateAppointment, validDay, type AgendaEntry, type AppointmentInput } from '../appointment-agenda.ts';

const details: AppointmentInput = { title: 'Review with a business contact', date: '2026-11-02', time: '10:00', endTime: '10:30', timeKind: 'exact',
  status: 'confirmed', attendance: 'attending', propertyName: null, location: 'Video call', people: 'Alex Example', notes: null,
  sourceLabel: 'Accepted invitation', sourceUrl: null, sourceKeys: ['gcal:operator@example.test:event-a'], reviewReason: null };
const entry = (change: Partial<AgendaEntry> = {}): AgendaEntry => ({ ...details, id: 'a', version: 1, updatedAt: '2026-10-31T01:55:00Z', href: '/appointments/a', editable: true, ...change });

describe('appointment dates and clocks', () => {
  test('the upcoming window follows Eastern midnight, not server UTC', () => {
    assert.deepEqual(agendaWindow(new Date('2026-11-01T03:59:59Z')), { today: '2026-10-31', through: '2026-11-29' });
    assert.equal(agendaWindow(new Date('2026-11-01T04:00:00Z')).today, '2026-11-01');
    assert.equal(agendaWindow(new Date('2026-11-02T04:59:59Z')).today, '2026-11-01');
    assert.equal(agendaWindow(new Date('2026-11-02T05:00:00Z')).today, '2026-11-02');
  });
  test('both repeated fall-back hours stay on November 1', () => {
    assert.deepEqual(agendaWindow(new Date('2026-11-01T05:30:00Z')), agendaWindow(new Date('2026-11-01T06:30:00Z')));
  });
  test('spring forward does not shorten the calendar-day window', () => {
    assert.deepEqual(agendaWindow(new Date('2027-03-14T06:59:00Z')), { today: '2027-03-14', through: '2027-04-12' });
  });
  test('rejects impossible days and accepts leap days', () => {
    assert.equal(validDay('2026-02-30'), false); assert.equal(validDay('2026-02-29'), false);
    assert.equal(validDay('2028-02-29'), true); assert.equal(validDay('2026-13-01'), false);
  });
  test('arrival windows are different from fixed appointment durations', () => {
    assert.equal(appointmentClock(entry({ time: '09:30', endTime: '12:00', timeKind: 'arrival_window' })), 'Arrival 9:30 AM to 12 PM ET');
    assert.equal(appointmentClock(entry()), '10 AM to 10:30 AM ET');
    assert.equal(appointmentClock(entry({ time: null, endTime: null })), 'Time to confirm');
    assert.equal(appointmentClock(entry({ time: null, endTime: null, timeKind: 'date_only' })), 'Date only');
  });
});
describe('input and evidence', () => {
  test('normalizes safe input', () => { const r = validateAppointment({ ...details, title: '  Business meeting  ' }); assert.ok(r.ok); assert.equal(r.value.title, 'Business meeting'); });
  for (const [name, change] of Object.entries({ impossibleDay: { date: '2026-02-30' }, invalidTime: { time: '25:00' }, backwards: { endTime: '09:00' }, noStart: { time: null }, noDate: { date: null }, status: { status: 'accepted' }, script: { sourceUrl: 'javascript:alert(1)' }, long: { title: 'x'.repeat(201) }, noWindow: { timeKind: 'arrival_window', endTime: null }, dateOnlyWithTime: { timeKind: 'date_only' }, missing: { notes: undefined } })) {
    test(`rejects ${name}`, () => assert.equal(validateAppointment({ ...details, ...change }).ok, false));
  }
  test('an undated lead is allowed only as unconfirmed', () => {
    assert.equal(validateAppointment({ ...details, date: null, time: null, endTime: null, status: 'needs_scheduling' }).ok, true);
  });
  test('source links reject spoofed domains, credentials and unsafe schemes', () => {
    for (const u of ['https://mail.google.com.evil.test/a', 'http://mail.google.com/a', 'https://me:secret@mail.google.com/a', 'https://www.google.com/search?q=secret']) assert.equal(safeSourceUrl(u), null);
    assert.ok(safeSourceUrl('https://my.quo.com/inbox/example'));
    assert.ok(safeSourceUrl('https://www.google.com/calendar/event?eid=example'));
  });
  test('source aliases use stable event identities across changed dates', () => {
    const url = 'https://www.google.com/calendar/event?eid=' + btoa('event1 operator@example.test');
    assert.equal(sourceKeyFromUrl(url, 'operator@example.test'), 'gcal:operator@example.test:event1');
    assert.equal(sourceKeyFromUrl('https://mail.google.com/mail/u/?authuser=operator%40example.test#all/123456abcdef', 'operator@example.test'), 'gmail:operator@example.test:123456abcdef');
  });
  test('a mismatched CRM address is held for review, with no guessed correction', () => {
    const m = meetingToAgenda({ id: 'm', contactId: 'c', contactName: 'Owner Example', propertyName: '4 Beach', title: 'Inspection at 21 Harbor', date: '2026-11-03', time: '10:00:00', location: '4 Beach', notes: null, important: true, kind: 'appointment' });
    assert.match(m.reviewReason!, /different street number/); assert.equal(m.propertyName, '4 Beach');
    assert.equal(m.attendance, 'coverage_needed'); assert.equal(m.status, 'tentative');
  });
});
describe('reconciliation and honest availability', () => {
  test('an explicitly linked cancellation suppresses its old CRM record', () => {
    const old = entry({ id: 'old', sourceKeys: ['helm:meeting:old'] });
    const cancelled = entry({ id: 'new', status: 'cancelled', sourceKeys: ['gcal:work:event', 'helm:meeting:old'] });
    const merged = mergeAgenda([cancelled], [old]); assert.equal(merged.length, 1);
    assert.equal(agendaGroups(merged, '2026-10-31', '2026-11-29').scheduled.length, 0);
  });
  test('rescheduling beyond the window does not resurrect the old time', () => {
    const old = entry({ id: 'old', sourceKeys: ['helm:meeting:old'] });
    const newer = entry({ date: '2026-12-02', sourceKeys: ['gcal:work:event', 'helm:meeting:old'] });
    assert.equal(agendaGroups(mergeAgenda([newer], [old]), '2026-10-31', '2026-11-29').scheduled.length, 0);
  });
  test('duplicate source copies collapse but same-title events at different houses do not', () => {
    const a = entry(); const b = entry({ id: 'b', propertyName: '21 Harbor', sourceKeys: ['gcal:work:event-b'] });
    assert.equal(mergeAgenda([a, { ...a }], [b]).length, 2);
  });
  test('unconfirmed requests and owner-handled visits do not count as personal commitments', () => {
    const groups = agendaGroups([entry(), entry({ id: 'owner', attendance: 'owner_handled' }), entry({ id: 'tbd', status: 'needs_scheduling', date: null, time: null, endTime: null }), entry({ id: 'past', date: '2026-10-01' }), entry({ id: 'cancel', status: 'cancelled' }), entry({ id: 'review', reviewReason: 'Conflicting dates' })], '2026-10-31', '2026-11-29');
    assert.deepEqual(groups.scheduled.map(e => e.id), ['a']); assert.deepEqual(groups.other.map(e => e.id), ['owner']);
    assert.deepEqual(new Set(groups.review.map(e => e.id)), new Set(['tbd', 'review']));
  });
  test('inclusive window boundaries preserve the last day and exclude the next', () => {
    const g = agendaGroups([entry({ date: '2026-10-31' }), entry({ id: 'last', date: '2026-11-29' }), entry({ id: 'outside', date: '2026-11-30' })], '2026-10-31', '2026-11-29');
    assert.deepEqual(g.scheduled.map(e => e.id), ['a', 'last']);
  });
  test('simultaneous site windows require separate coverage; adjacent meetings do not', () => {
    const a = entry({ time: '09:30', endTime: '12:00', attendance: 'coverage_needed' });
    const b = entry({ id: 'b', time: '09:30', endTime: '12:00', attendance: 'coverage_needed' });
    const c = entry({ id: 'c', time: '12:00', endTime: '12:30' });
    assert.deepEqual(overlappingAppointments([a, b, c]), new Set(['a', 'b']));
    assert.equal(overlappingAppointments([a, { ...b, attendance: 'owner_handled' }]).size, 0);
    assert.equal(overlappingAppointments([a, { ...b, date: '2026-11-03' }]).size, 0);
  });
});

test('owner appointment intake rejects a contradictory title before writing', () => {
  assert.match(checkOwnerAppointment({ cardId: 'card', propertyId: '4_beach', date: '2026-11-02', what: 'Inspection at 21 Harbor', message: 'Business source' })!, /different street number/);
  assert.equal(appointmentAddressConflict('4 Beach', 'Meet at 2 PM'), false);
  assert.equal(appointmentAddressConflict('4 Beach', 'Inspection', '21 Harbor'), true);
});
