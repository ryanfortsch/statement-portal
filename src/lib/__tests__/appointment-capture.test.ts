import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarCapture, messageCapture, reconcileCaptures, captureCoverage, type CaptureState } from '../appointment-capture.ts';
import { captureCalendar, captureGmail, CaptureAccessError } from '../appointment-capture-google.ts';
import { agendaGroups, validateAppointment, type AgendaEntry } from '../appointment-agenda.ts';
const email = 'operator@risingtidestr.com', now = new Date('2026-10-31T12:00:00Z');
const event = { id: 'event1', summary: 'Synthetic business meeting', status: 'confirmed', start: { dateTime: '2026-11-02T15:00:00Z' }, end: { dateTime: '2026-11-02T15:30:00Z' }, attendees: [{ self: true, responseStatus: 'accepted' }] };
const captured = () => calendarCapture(event, email, now);
const saved = (): AgendaEntry => ({ ...captured().details, reviewReason: null, id: 'saved', href: '/appointments/saved', editable: true, version: 1, updatedAt: now.toISOString(), sourceRevisions: { [captured().source_key]: captured().revision } });
function fake(responses: unknown[]) { const calls: URL[] = []; return { calls, get: (async (input: string | URL) => { calls.push(new URL(String(input))); const next = responses.shift(); if (next instanceof Response) return next; assert.notEqual(next, undefined, 'unexpected fetch'); return Response.json(next); }) as typeof fetch }; }

test('calendar conversion respects both sides of DST, RSVP and date-only/multiday semantics', () => {
  assert.equal(captured().details.time, '10:00'); assert.equal(captured().details.attendance, 'attending');
  assert.equal(calendarCapture({ ...event, start: { dateTime: '2026-10-31T14:00:00Z' } }, email, now).details.time, '10:00');
  const allDay = calendarCapture({ ...event, start: { date: '2026-11-02' }, end: { date: '2026-11-04' }, attendees: [] }, email, now);
  assert.equal(allDay.details.timeKind, 'date_only'); assert.equal(allDay.details.time, null); assert.equal(allDay.details.attendance, 'coverage_needed'); assert.ok(validateAppointment(allDay.details).ok);
  const overnight = calendarCapture({ ...event, end: { dateTime: '2026-11-03T15:00:00Z' } }, email, now);
  assert.equal(overnight.details.endTime, null); assert.match(overnight.details.reviewReason!, /spans more than one day/);
  assert.equal(calendarCapture({ ...event, attendees: [{ self: true, responseStatus: 'declined' }] }, email, now).details.attendance, 'not_attending');
});
test('unchanged reviewed observations preserve appointments; changed/cancelled/out-of-window records require review', () => {
  assert.equal(reconcileCaptures([saved()], [captured()])[0].reviewReason, null);
  const moved = calendarCapture({ ...event, start: { dateTime: '2026-12-10T15:00:00Z' } }, email, now);
  const result = reconcileCaptures([saved()], [moved]);
  assert.equal(result.length, 1); assert.equal(result[0].date, '2026-11-02'); assert.equal(result[0].status, 'needs_scheduling');
  assert.match(result[0].sourceUpdates![0].summary, /2026-12-10/);
  assert.equal(agendaGroups(result, '2026-10-31', '2026-11-29').scheduled.length, 0);
  const cancelled = reconcileCaptures([saved()], [calendarCapture({ id: event.id, status: 'cancelled' }, email, now)]);
  assert.match(cancelled[0].sourceUpdates![0].summary, /Cancelled/);
  assert.equal(reconcileCaptures([], [calendarCapture({ id: event.id, status: 'cancelled' }, email, now)]).length, 0);
  const future = { ...saved(), date: '2027-01-01', sourceRevisions: {} };
  assert.equal(agendaGroups(reconcileCaptures([future], [captured()]), '2026-10-31', '2026-11-29').review.length, 1);
});
test('exact email/calendar aliases collapse, identical titles with distinct IDs stay separate', () => {
  const c = captured(), mail = messageCapture('gmail', `gmail:${email}:thread:a`, [c.source_key], 'https://mail.google.com/#all/a', 'new reply', now);
  const merged = reconcileCaptures([], [mail, c]); assert.equal(merged.length, 1); assert.equal(merged[0].sourceUpdates?.length, 2);
  const separate = calendarCapture({ ...event, id: 'event2' }, email, now);
  assert.equal(reconcileCaptures([], [c, separate]).length, 2);
  assert.equal(reconcileCaptures([saved()], [mail, c]).length, 1);
});
test('freshness never equates unavailable or stale sources with empty calendars', () => {
  assert.equal(captureCoverage('calendar', undefined, now).state, 'not_connected');
  const state: CaptureState = { kind: 'calendar', state: 'available', detail: 'Read primary.', last_attempt_at: now.toISOString(), last_success_at: '2026-10-30T12:00:00Z' };
  assert.equal(captureCoverage('calendar', state, now).state, 'partial'); assert.match(captureCoverage('calendar', state, now).detail, /Stale/);
  assert.equal(captureCoverage('calendar', { ...state, last_success_at: now.toISOString() }, now).state, 'available');
  assert.equal(captureCoverage('calendar', { ...state, state: 'unavailable' }, now).state, 'unavailable');
});
test('calendar paginates, checks missing tracked IDs and excludes guest checkout placeholders', async () => {
  const api = fake([{ items: [event], nextPageToken: 'page2' }, { items: [{ ...event, id: 'checkout', summary: 'Guest Check-out: Example' }] }, { ...event, id: 'moved', start: { dateTime: '2026-12-02T15:00:00Z' } }, { id: 'cancelled', status: 'cancelled' }]);
  const rows = await captureCalendar('fake', email, [`gcal:${email}:moved`, `gcal:${email}:cancelled`], now, api.get);
  assert.deepEqual(rows.map(r => r.source_key), [`gcal:${email}:event1`, `gcal:${email}:moved`, `gcal:${email}:cancelled`]);
  assert.equal(api.calls[1].searchParams.get('pageToken'), 'page2'); assert.equal(api.calls[0].searchParams.get('singleEvents'), 'true');
  assert.equal(rows[1].details.date, '2026-12-02'); assert.equal(rows[2].details.status, 'cancelled');
});
test('provider errors cannot silently produce successful empty snapshots', async () => {
  const api = fake([new Response('', { status: 403 })]); await assert.rejects(captureCalendar('fake', email, [], now, api.get), (e: unknown) => e instanceof CaptureAccessError && e.status === 403);
  const laterPage = fake([{ items: [event], nextPageToken: 'next' }, new Response('', { status: 500 })]);
  await assert.rejects(captureCalendar('fake', email, [], now, laterPage.get));
});
test('mail paginates and reads complete tracked threads, hashes changes without persisting bodies', async () => {
  const payload = (body: string) => ({ headers: [{ name: 'Subject', value: 'Inspection' }], mimeType: 'text/plain', body: { data: Buffer.from(body).toString('base64url') } });
  const link = `https://calendar.google.com/calendar/event?eid=${Buffer.from(`event1 ${email}`).toString('base64url')}`;
  const api = fake([{ threads: [{ id: 'thread1' }], nextPageToken: 'next' }, { threads: [] }, { id: 'thread1', messages: [{ id: 'msg1', internalDate: '1', payload: payload(`Private content not stored. ${link}`) }, { id: 'msg2', internalDate: '2', payload: payload('Actually, can we move it?') }] }, { id: 'tracked', messages: [{ id: 'msg3', internalDate: '3', payload: payload('We will figure it out') }] }]);
  const rows = await captureGmail('fake', email, [`gmail:${email}:thread:tracked`], new Date('2026-10-01'), now, api.get);
  assert.equal(rows.length, 2); assert.equal(api.calls[1].searchParams.get('pageToken'), 'next');
  assert.ok(rows[0].aliases.includes(`gcal:${email}:event1`)); assert.ok(rows[0].aliases.includes(`gmail:${email}:msg2`));
  assert.ok(!JSON.stringify(rows).includes('Private content')); assert.equal(rows[0].details.date, null); assert.equal(rows[0].details.status, 'needs_scheduling');
});
