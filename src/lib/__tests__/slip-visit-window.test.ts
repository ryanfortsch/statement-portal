import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gearNeedsArrivals, slipInVisitWindow, type HomeArrival } from '../slip-visit-window.ts';

const RES = '6a8f08d94c9065d58b24e3f7';
const gear = (scheduled_date: string | null) => ({
  from_guest_request_key: `gear:${RES}`,
  scheduled_date,
  guesty_reservation_id: RES,
});
const theFamily: HomeArrival = { check_in: '2026-10-05', ids: ['b-uuid-1', RES] };

test("20 Hammond: the 10/05 family's gear rides the 10/01 visit, the last one before them", () => {
  assert.equal(slipInVisitWindow(gear('2026-10-04'), '2026-10-01', [theFamily]), true);
  assert.equal(slipInVisitWindow(gear('2026-10-04'), '2026-10-01', []), true);
});

test("Ryan's rule holds: gear waits when another guest arrives first", () => {
  const between: HomeArrival = { check_in: '2026-07-27', ids: ['b-uuid-2', 'other-guesty-id'] };
  assert.equal(slipInVisitWindow(gear('2026-07-30'), '2026-07-25', [between]), false);
  // An arrival on the visit day itself is somebody else's stay too.
  const sameDay: HomeArrival = { check_in: '2026-07-25', ids: ['b-uuid-3'] };
  assert.equal(slipInVisitWindow(gear('2026-07-30'), '2026-07-25', [sameDay]), false);
});

test("the gear stay's own arrival never blocks it, matched by Guesty id or booking id", () => {
  // A slip approved on check-in day is dated that day, so its own arrival
  // falls inside the range.
  const own: HomeArrival = { check_in: '2026-10-05', ids: ['b-uuid-1', RES] };
  assert.equal(slipInVisitWindow(gear('2026-10-05'), '2026-10-01', [own]), true);
});

test('unreadable arrivals let the gear ride', () => {
  assert.equal(slipInVisitWindow(gear('2026-10-04'), '2026-10-01', null), true);
});

test('the plain window is unchanged for every slip', () => {
  const office = (d: string | null) => ({ from_guest_request_key: null, scheduled_date: d });
  assert.equal(slipInVisitWindow(office(null), '2026-10-01', []), true);
  assert.equal(slipInVisitWindow(office('2026-10-02'), '2026-10-01', []), true);
  assert.equal(slipInVisitWindow(office('2026-09-20'), '2026-10-01', []), true);
  assert.equal(slipInVisitWindow(office('2026-10-03'), '2026-10-01', []), false);
  // Only gear gets the early ride; arrivals are irrelevant to other rails.
  assert.equal(slipInVisitWindow(office('2026-10-03'), '2026-10-01', null), false);
  const contact = { from_guest_request_key: `staycontact:${RES}:x`, scheduled_date: '2026-10-04' };
  assert.equal(slipInVisitWindow(contact, '2026-10-01', []), false);
  // Overdue gear still shows.
  assert.equal(slipInVisitWindow(gear('2026-10-04'), '2026-10-07', []), true);
});

test('arrivals are read only for gear past the plain window', () => {
  assert.equal(gearNeedsArrivals(gear('2026-10-04'), '2026-10-01'), true);
  assert.equal(gearNeedsArrivals(gear('2026-10-02'), '2026-10-01'), false);
  assert.equal(gearNeedsArrivals(gear(null), '2026-10-01'), false);
  assert.equal(gearNeedsArrivals({ from_guest_request_key: null, scheduled_date: '2026-10-04' }, '2026-10-01'), false);
});

test('the Field packet pool actually applies the rule', () => {
  // Guards the wiring: putting the bare scheduled_date gate back in
  // loadOpenSlipsForStops, or dropping the column the own-stay match reads,
  // must fail here.
  const src = readFileSync(new URL('../field-packets.ts', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export async function loadOpenSlipsForStops'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /guesty_reservation_id/);
  assert.match(body, /slipInVisitWindow\(w, visitDate,/);
  assert.doesNotMatch(body, /scheduled_date <= dayAfterVisit/);
});
