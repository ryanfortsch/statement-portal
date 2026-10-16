import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCalderwoodReview } from '../calderwood-readonly/review-summary.ts';
import { normalizeCalendar, compareCalendar } from '../calderwood-readonly/calendar.ts';
import { CALDERWOOD } from '../calderwood-readonly/guesty-reader.ts';

type Input = Parameters<typeof summarizeCalderwoodReview>[0];
const window = { from: '2027-01-02', to: '2027-01-06' };
const stay = (id: string, start: string, end: string, status = 'confirmed', source = 'synthetic'): Input['reservations'][number] =>
  ({ id, listingId: CALDERWOOD.guestyListingId, start, end, status, source });
const input = (reservations: Input['reservations'] = []): Input => ({ window, reservations, calendar: null });
const day = (date: string, blocks: Record<string, boolean> = {}, minNights: number | null = 2) => ({
  listingId: CALDERWOOD.guestyListingId, date, status: Object.values(blocks).some(Boolean) ? 'unavailable' : 'available',
  price: 100, currency: 'USD', minNights, cta: false, ctd: false, requestToBook: false, blocks,
});
function withCalendar(days: ReturnType<typeof day>[]): Input {
  const normalized = normalizeCalendar({ days }, window);
  return { ...input(), calendar: { ...normalized, days: compareCalendar(normalized, []) } };
}

test('summary clips occupied nights to the requested window and excludes checkout', () => {
  const result = summarizeCalderwoodReview(input([
    stay('one', '2027-01-01', '2027-01-03'),
    stay('two', '2027-01-04', '2027-01-08'),
    stay('departed', '2027-01-01', window.from),
    stay('outside', window.to, '2027-01-08'),
  ]));
  assert.equal(result.nightsRequested, 4);
  assert.equal(result.reservations.total, 2);
  assert.equal(result.reservations.confirmed, 2);
  assert.equal(result.reservations.occupiedNights, 3);
  assert.equal(result.inventoryAuthority, false);
});

test('cancellation and inquiry sharing dates never subtract confirmed occupancy', () => {
  const result = summarizeCalderwoodReview(input([
    stay('active', window.from, window.to),
    stay('cancel', window.from, window.to, 'canceled'),
    stay('question', '2027-01-03', '2027-01-04', 'inquiry'),
    stay('cancel-elsewhere', '2027-01-06', '2027-01-07', 'canceled'),
  ]));
  assert.equal(result.reservations.occupiedNights, 4);
  assert.equal(result.reservations.nonConfirmedSharingDates, 2);
  assert.equal(result.reservations.overlappingConfirmedNights, 0);
  assert.deepEqual(result.reservations.statuses, [
    { status: 'canceled', count: 1 }, { status: 'confirmed', count: 1 }, { status: 'inquiry', count: 1 },
  ]);
});

test('confirmed overlaps count unique nights and adjacent stays do not overlap', () => {
  const result = summarizeCalderwoodReview(input([
    stay('one', window.from, '2027-01-04'),
    stay('two', '2027-01-03', '2027-01-05'),
    stay('three', '2027-01-05', window.to),
  ]));
  assert.equal(result.reservations.occupiedNights, 4);
  assert.equal(result.reservations.overlappingConfirmedNights, 1);
});

test('a failed calendar remains unknown even with no returned reservations', () => {
  const result = summarizeCalderwoodReview(input());
  assert.equal(result.reservations.total, 0);
  assert.equal(result.calendar, null);
  assert.equal(result.inventoryAuthority, false);
});

test('holds count unique nights while all reasons, unknowns and missing dates survive', () => {
  const result = summarizeCalderwoodReview(withCalendar([
    day('2027-01-02', { m: true, o: true, ic: true }),
    day('2027-01-03', { an: true, futureBlock: true }),
  ]));
  assert.equal(result.calendar?.returnedNights, 2);
  assert.equal(result.calendar?.missingNights, 2);
  assert.equal(result.calendar?.independentHoldNights, 1);
  assert.equal(result.calendar?.unknownBlockNights, 1);
  assert.equal(result.calendar?.issueNights, 1);
  assert.equal(result.calendar?.reasons.length, 5);
});

test('minimum range describes posted dates and keeps missing restrictions visible', () => {
  const result = summarizeCalderwoodReview(withCalendar([
    day('2027-01-02', {}, 1), day('2027-01-03', {}, 4), day('2027-01-04', {}, null), day('2027-01-05', {}, 2),
  ]));
  assert.deepEqual(result.calendar?.minimums, { lowest: 1, highest: 4, knownNights: 3 });
  assert.equal(result.calendar?.issueNights, 1);
  assert.equal(summarizeCalderwoodReview(withCalendar([day(window.from, {}, null)])).calendar?.minimums, null);
});

test('source labels and unknown statuses stay distinct without carrying reservation identifiers', () => {
  const result = summarizeCalderwoodReview(input([
    stay('PRIVATE-ID-1', window.from, window.to, 'confirmed', 'synthetic-vrbo'),
    stay('PRIVATE-ID-2', window.from, window.to, 'canceled', 'synthetic-homeaway2'),
    stay('PRIVATE-ID-3', window.from, window.to, 'future-status', '__proto__'),
  ]));
  assert.equal(result.reservations.sources.length, 3);
  assert.deepEqual(result.reservations.sources.find(s => s.source === 'synthetic-vrbo'), { source: 'synthetic-vrbo', confirmed: 1, other: 0 });
  assert.deepEqual(result.reservations.statuses.find(s => s.status === 'future-status'), { status: 'future-status', count: 1 });
  assert.equal(JSON.stringify(result).includes('PRIVATE-ID'), false);
  assert.equal(JSON.stringify(result).includes(CALDERWOOD.guestyListingId), false);
});
