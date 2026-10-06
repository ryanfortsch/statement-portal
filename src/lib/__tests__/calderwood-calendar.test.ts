import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALDERWOOD } from '../calderwood-readonly/guesty-reader.ts';
import { normalizeCalendar, readCalderwoodCalendar, compareCalendar } from '../calderwood-readonly/calendar.ts';
import { loadCalderwoodRead } from '../calderwood-readonly/access.ts';
const window = { from: '2027-01-01', to: '2027-01-03' };
const id = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const day = (date = window.from) => ({ listingId: CALDERWOOD.guestyListingId, date, status: 'available', price: 100, currency: 'USD', minNights: 2, cta: false, ctd: false, requestToBook: false, blocks: { m: false, b: false }, blockRefs: [] });
test('calendar request is fixed-property GET and converts exclusive end to inclusive', async () => {
  const result = await readCalderwoodCalendar('test-token', window, async (url, init) => {
    const parsed = new URL(url);
    assert.ok(parsed.pathname.endsWith(CALDERWOOD.guestyListingId));
    assert.equal(parsed.searchParams.get('endDate'), '2027-01-02');
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    return Response.json({ data: { days: [day(), day('2027-01-02')] } });
  });
  assert.equal(result.coverageComplete, true); assert.equal(result.inventoryAuthority, false);
});
test('missing dates stay missing; duplicate, out-of-range and wrong-property dates fail', () => {
  const result = normalizeCalendar({ days: [day()] }, window);
  assert.deepEqual(result.missingDates, ['2027-01-02']);
  assert.equal(result.coverageComplete, false);
  for (const days of [[day(), day()], [day('2027-01-03')], [{ ...day(), listingId: 'other' }]]) assert.throws(() => normalizeCalendar({ days }, window));
  assert.throws(() => normalizeCalendar({}, window));
});
test('multiple block reasons survive and customer fields are stripped', () => {
  const result = normalizeCalendar({ days: [{ ...day(), status: 'booked', blocks: { b: true, m: true, futureType: true }, reservationId: id,
    blockRefs: [{ type: 'm', note: 'PRIVATE NOTE', createdBy: 'PRIVATE EMAIL', reservation: { guest: 'PRIVATE GUEST' } }], note: 'PRIVATE NOTE' }] }, window);
  assert.deepEqual(result.days[0].reasons, ['Reservation', 'Manual hold', 'Unknown block']);
  assert.equal(result.days[0].unknownBlock, true);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
test('confirmed stays use exact references and exclude checkout; unknown evidence never becomes an all-clear', () => {
  const reservations = [{ id, listingId: CALDERWOOD.guestyListingId, start: '2027-01-01', end: '2027-01-02', status: 'confirmed', source: 'synthetic' }];
  const result = compareCalendar(normalizeCalendar({ days: [day(), day('2027-01-02')] }, window), reservations);
  assert.ok(result[0].issues.includes('Confirmed stay missing calendar reference'));
  assert.equal(result[1].issues.length, 0);
  const unknown = compareCalendar(normalizeCalendar({ days: [{ ...day(), status: 'unavailable', blocks: null, minNights: null, cta: undefined }] }, window), []);
  assert.ok(unknown[0].issues.includes('Unknown calendar evidence'));
  assert.ok(unknown[0].issues.includes('Incomplete pricing or restrictions'));
  assert.ok(unknown[0].issues.includes('Unavailable date needs explanation'));
});
test('reference mismatch and overlapping confirmed records require review', () => {
  const calendar = normalizeCalendar({ days: [{ ...day(), status: 'booked', reservationId: id, blocks: { b: true } }] }, window);
  assert.ok(compareCalendar(calendar, [])[0].issues.includes('Calendar reference missing matching stay dates'));
  const row = { id, listingId: CALDERWOOD.guestyListingId, start: window.from, end: window.to, status: 'confirmed', source: 'synthetic' };
  assert.ok(compareCalendar(calendar, [row, { ...row, id: 'bbbbbbbbbbbbbbbbbbbbbbbb' }])[0].issues.includes('Overlapping confirmed records need identity review'));
});
test('calendar failure retains reservation snapshot without exposing error or credential', async () => {
  const result = await loadCalderwoodRead({ email: 'staff@risingtidestr.com', env: { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'codex/channex-staging-pilot', CHANNEX_STAGING_ENABLED: 'true' }, ...window, includeCalendar: true }, {
    token: async () => 'secret', read: async () => ({ mode: 'read-only-snapshot', executable: false, inventoryAuthority: false, paginationComplete: true, baselineComplete: false, missingEvidence: ['independent-blocks', 'authoritative-revisions', 'channex-mapping', 'cross-provider-comparison'], window, reservations: [] }),
    calendar: async () => { throw Error('secret private response'); },
  });
  assert.equal(result.calendarError, true); assert.equal(result.calendar, null); assert.ok(!JSON.stringify(result).includes('secret'));
});
