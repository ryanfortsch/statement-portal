import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCalderwoodTiming, reviewCalderwoodMessageTiming } from '../calderwood-readonly/message-timing.ts';
import { CALDERWOOD, readCalderwoodGuesty } from '../calderwood-readonly/guesty-reader.ts';
const input = {
  arrival: '2027-01-15T21:00:00Z', departure: '2027-01-18T16:00:00Z',
  stayArrival: '2027-01-15T21:00:00Z', stayDeparture: '2027-01-18T16:00:00Z',
  start: '2027-01-15', end: '2027-01-18',
};
const now = new Date('2027-01-01T00:00:00Z');
const review = (i = input, date = now, status = 'confirmed') => reviewCalderwoodMessageTiming({ status, timing: { ...normalizeCalderwoodTiming(i), clockVerified: true } }, date);
const get = (rows: ReturnType<typeof review>, key: string) => rows.find(row => row.key === key)!;

test('normalization checks both source timestamps and local date without inventing defaults', () => {
  assert.deepEqual(normalizeCalderwoodTiming(input), { arrivalAt: '2027-01-15T21:00:00.000Z', departureAt: '2027-01-18T16:00:00.000Z', issues: [], clockVerified: false });
  for (const arrival of [null, undefined, 16, '16:00', '2027-01-15T21:00:00', '2027-02-30T21:00:00Z', '2027-01-15T21:00:15Z', '2027-01-15T21:00:00.100Z']) {
    const result = normalizeCalderwoodTiming({ ...input, arrival });
    assert.equal(result.arrivalAt, null);
    assert.equal(result.issues.length, 1);
  }
  for (const i of [{ ...input, stayArrival: '2027-01-15T22:00:00Z' }, { ...input, start: '2027-01-16' }, { ...input, stayArrival: null }]) assert.equal(normalizeCalderwoodTiming(i).arrivalAt, null);
  assert.equal(normalizeCalderwoodTiming({ ...input, stayArrival: '2027-01-15T16:00:00-05:00' }).arrivalAt, '2027-01-15T21:00:00.000Z');
});

test('confirmed stays retain existing offsets while confirmation remains unknown', () => {
  const rows = review();
  assert.equal(rows.length, 6);
  assert.equal(get(rows, 'confirmation').at, null);
  assert.equal(get(rows, 'pre_arrival').at, '2027-01-14T21:00:00.000Z');
  assert.equal(get(rows, 'key_code').at, '2027-01-15T20:00:00.000Z');
  assert.equal(get(rows, 'pre_checkout').at, '2027-01-17T16:00:00.000Z');
  assert.equal(get(rows, 'cleaner_reminder').at, '2027-01-05T21:00:00.000Z');
  assert.equal(get(rows, 'cleaner_arrival').at, '2027-01-15T14:00:00.000Z');
  assert.ok(rows.every(row => row.canSend === false));
});

test('changed arrival/departure and local dates update every affected proposal', () => {
  const changed = { ...input, arrival: '2027-07-15T22:00:00Z', stayArrival: '2027-07-15T22:00:00Z', departure: '2027-07-18T16:00:00Z', stayDeparture: '2027-07-18T16:00:00Z', start: '2027-07-15', end: '2027-07-18' };
  assert.equal(get(review(changed), 'key_code').at, '2027-07-15T21:00:00.000Z');
  assert.equal(get(review(changed), 'cleaner_arrival').at, '2027-07-15T15:00:00.000Z');
  assert.equal(get(review(changed), 'pre_checkout').at, '2027-07-17T16:00:00.000Z');
  const late = { ...input, arrival: '2027-01-16T02:00:00Z', stayArrival: '2027-01-16T02:00:00Z' };
  assert.equal(normalizeCalderwoodTiming(late).issues.length, 0);
  assert.equal(get(review(late), 'pre_arrival').at, '2027-01-15T02:00:00.000Z');
});

test('day offsets withhold competing DST clocks and nonexistent or ambiguous local times', () => {
  const spring = { ...input, arrival: '2027-03-15T20:00:00Z', stayArrival: '2027-03-15T20:00:00Z', start: '2027-03-15', departure: '2027-03-18T15:00:00Z', stayDeparture: '2027-03-18T15:00:00Z', end: '2027-03-18' };
  assert.equal(get(review(spring), 'cleaner_reminder').at, null);
  assert.deepEqual(get(review(spring), 'cleaner_reminder').dayOffsetConflict, { calendarAt: '2027-03-05T21:00:00.000Z', elapsedAt: '2027-03-05T20:00:00.000Z' });
  const gap = { ...spring, arrival: '2027-03-15T06:30:00Z', stayArrival: '2027-03-15T06:30:00Z' };
  assert.equal(get(review(gap), 'pre_arrival').at, null);
  assert.equal(get(review(gap), 'key_code').at, '2027-03-15T05:30:00.000Z');
  const fold = { ...input, arrival: '2027-11-08T06:30:00Z', stayArrival: '2027-11-08T06:30:00Z', start: '2027-11-08', departure: '2027-11-10T16:00:00Z', stayDeparture: '2027-11-10T16:00:00Z', end: '2027-11-10' };
  assert.equal(get(review(fold), 'pre_arrival').at, null);
  assert.equal(get(review(fold), 'key_code').at, '2027-11-08T05:30:00.000Z');
});

test('missing arrival cannot create arrival messages but does not hide verified departure timing', () => {
  const rows = review({ ...input, arrival: '', stayArrival: '' });
  assert.equal(rows.filter(row => row.at).length, 1);
  assert.equal(get(rows, 'pre_checkout').at, '2027-01-17T16:00:00.000Z');
  for (const status of ['canceled', 'inquiry', 'closed', 'reserved', 'unknown']) assert.ok(review(input, now, status).every(row => row.at === null && row.canSend === false));
});

test('past and exactly-due times are review-only without catch-up or sent-state assumptions', () => {
  const rows = review(input, new Date('2027-01-15T20:00:00Z'));
  assert.match(get(rows, 'key_code').review, /Past or due/);
  assert.match(get(rows, 'pre_arrival').review, /never replay/);
  assert.match(get(rows, 'pre_checkout').review, /verify queue and holds/);
  assert.throws(() => review(input, new Date(NaN)), /Valid timing/);
});

test('GET reader keeps timing from the existing response and discards private extra fields', async () => {
  let calls = 0;
  const result = await readCalderwoodGuesty('synthetic-token', { from: '2027-01-01', to: '2027-02-01' }, async () => {
    calls++;
    return Response.json({ pagination: { skip: 0, limit: 100, hasMore: false }, results: [{
      reservationId: '000000000000000000000001', status: 'confirmed', source: 'synthetic',
      checkInDateLocalized: input.start, checkOutDateLocalized: input.end, checkIn: input.arrival, checkOut: input.departure,
      createdAt: '2027-01-01T00:00:00Z', notes: { keyCode: 'PRIVATE' }, guestId: 'PRIVATE',
      stay: [{ listingId: CALDERWOOD.guestyListingId, checkInDateLocalized: input.start, checkOutDateLocalized: input.end, checkIn: input.stayArrival, checkOut: input.stayDeparture }],
    }] });
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.reservations[0].timing, normalizeCalderwoodTiming(input));
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.equal(get(reviewCalderwoodMessageTiming(result.reservations[0], now), 'confirmation').at, null);
});


test('matching API timestamps cannot verify their own clock or produce a live message schedule', () => {
  const timing = normalizeCalderwoodTiming(input);
  assert.equal(timing.clockVerified, false);
  const rows = reviewCalderwoodMessageTiming({ status: 'confirmed', timing }, now);
  assert.equal(rows.length, 6);
  assert.ok(rows.every(row => row.at === null && row.canSend === false));
  assert.ok(rows.every(row => row.review === 'Timing unverified'));
});


test('fall checkout offset exposes the one-hour disagreement without changing other reminders', () => {
  const fall = { ...input, arrival: '2027-11-04T20:00:00Z', stayArrival: '2027-11-04T20:00:00Z', start: '2027-11-04', departure: '2027-11-07T16:00:00Z', stayDeparture: '2027-11-07T16:00:00Z', end: '2027-11-07' };
  const rows = review(fall), checkout = get(rows, 'pre_checkout');
  assert.equal(checkout.at, null);
  assert.deepEqual(checkout.dayOffsetConflict, { calendarAt: '2027-11-06T15:00:00.000Z', elapsedAt: '2027-11-06T16:00:00.000Z' });
  assert.match(checkout.review, /verify Guesty queued time/);
  assert.equal(get(rows, 'key_code').at, '2027-11-04T19:00:00.000Z');
  assert.equal(get(rows, 'cleaner_arrival').at, '2027-11-04T13:00:00.000Z');
  assert.equal(rows.filter(r => r.dayOffsetConflict).length, 1);
  assert.ok(rows.every(r => !r.canSend));
});

test('spring checkout offset reverses the candidate clocks; neither becomes a send time', () => {
  const spring = { ...input, arrival: '2027-03-12T21:00:00Z', stayArrival: '2027-03-12T21:00:00Z', start: '2027-03-12', departure: '2027-03-14T15:00:00Z', stayDeparture: '2027-03-14T15:00:00Z', end: '2027-03-14' };
  const checkout = get(review(spring), 'pre_checkout');
  assert.equal(checkout.at, null);
  assert.deepEqual(checkout.dayOffsetConflict, { calendarAt: '2027-03-13T16:00:00.000Z', elapsedAt: '2027-03-13T15:00:00.000Z' });
  assert.equal(checkout.canSend, false);
});

test('unverified and canceled stays expose no DST candidates or inferred queue state', () => {
  const timing = { arrivalAt: '2027-11-08T21:00:00Z', departureAt: '2027-11-10T16:00:00Z', issues: [] };
  for (const [status, clockVerified] of [['confirmed', false], ['canceled', true]] as const) {
    const rows = reviewCalderwoodMessageTiming({ status, timing: { ...timing, clockVerified } }, now);
    assert.ok(rows.every(r => r.at === null && !r.dayOffsetConflict && !r.canSend));
  }
});
