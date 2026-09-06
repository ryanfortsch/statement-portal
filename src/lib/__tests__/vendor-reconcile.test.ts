/**
 * Does the cleaning vendor's schedule agree with ours? Fixture is the real
 * Monday 2026-09-07: ten checkouts, A-1's eight-visit batch, two houses
 * with no cleaner booked.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileDay, verdictLabel, summarize, VENDOR_LABEL } from '../vendor-reconcile.ts';
import type { ScheduleDay, ScheduleRow } from '../checkout-schedule.ts';

function row(
  propertyId: string,
  propertyName: string,
  time: string,
  opts: { guestName?: string; nextCheckinTime?: string | null } = {},
): ScheduleRow {
  const sameDay = opts.nextCheckinTime != null;
  return {
    propertyId,
    propertyName,
    address: '',
    city: 'Gloucester',
    guestName: opts.guestName ?? 'Guest',
    checkIn: '2026-09-04',
    baseCheckOut: '2026-09-07',
    effectiveCheckOut: '2026-09-07',
    time,
    defaultTime: time,
    sameDayTurnover: sameDay,
    conflictingCheckOut: null,
    nextCheckinTime: sameDay ? opts.nextCheckinTime! : null,
    nextGuestName: sameDay ? 'Next Guest' : null,
    adjustment: null,
    proposals: [],
  };
}

function day(rows: ScheduleRow[], date = '2026-09-07'): ScheduleDay {
  return { date, rows, counts: { checkouts: rows.length, sameDay: 0, adjusted: 0, proposed: 0 } };
}

const appt = (property_id: string, service_time: string, service_date = '2026-09-07') => ({
  property_id,
  service_date,
  service_time,
});

const names = new Map([
  ['4_middle', '4 Middle Road'],
  ['84_thatcher', '84 Thatcher'],
]);

describe('reconcileDay', () => {
  const windward = row('3_windward', '3 Windward', '10:00');
  const middle = row('4_middle', '4 Middle Road', '10:00', { guestName: 'Sarah Braun' });
  const south = row('3_south_st', '3 South', '10:00');
  const rackliffe = row('19_rackliffe', '19 Rackliffe', '11:00', { nextCheckinTime: '15:00' });
  const granite = row('36_granite', '36 Granite', '11:00');
  const locust = row('3_locust', '3 Locust', '11:00');
  const hammond = row('20_hammond', '20 Hammond', '11:00');
  const rocky73 = row('73_rocky_neck', '73 Rocky Neck', '11:00');
  const rocky53 = row('53_rocky_neck', '53 Rocky Neck', '11:00');
  const rocky53down = row('53_rocky_neck_2', '53 Rocky Neck, Downstairs', '11:00', { nextCheckinTime: '15:00' });
  const monday = day([windward, middle, south, rackliffe, granite, locust, hammond, rocky73, rocky53, rocky53down]);
  const batch = [
    appt('3_windward', '10:00'),
    appt('19_rackliffe', '12:00'),
    appt('36_granite', '12:00'),
    appt('3_locust', '13:00'),
    appt('3_south_st', '13:30'),
    appt('20_hammond', '14:00'),
    appt('73_rocky_neck', '14:00'),
    appt('53_rocky_neck', '15:30'),
  ];

  const report = reconcileDay(monday, batch, '2026-09-08', names);
  const verdict = (r: ScheduleRow) => report.byRow.get(`${r.propertyId}|${r.checkIn}`)!;

  test('eight visits agree, two houses have no cleaner booked, no orphans', () => {
    assert.equal(report.announced, true);
    assert.equal(report.orphans.length, 0);
    assert.deepEqual(summarize([report]), { agree: 8, early: 0, late: 0, missing: 2, orphans: 0 });
    assert.deepEqual(verdict(middle), { kind: 'no_appointment' });
    assert.deepEqual(verdict(rocky53down), { kind: 'no_appointment' });
    assert.deepEqual(verdict(rocky53), { kind: 'agree', time: '15:30' });
  });

  test('a visit at the checkout minute agrees; a same-day visit before check-in agrees', () => {
    assert.deepEqual(verdict(windward), { kind: 'agree', time: '10:00' });
    assert.deepEqual(verdict(rackliffe), { kind: 'agree', time: '12:00' });
  });

  test('a visit before the guest is out is early, and says when the house frees up', () => {
    const thatcher = row('84_thatcher', '84 Thatcher', '11:00');
    const r = reconcileDay(day([thatcher]), [appt('84_thatcher', '10:30')], '2026-09-07', names);
    assert.deepEqual(r.byRow.get('84_thatcher|2026-09-04'), { kind: 'early', time: '10:30', checkoutTime: '11:00' });
  });

  test('on a same-day turnover a visit at or after the next check-in is late', () => {
    const enon = row('20_enon', '20 Enon', '11:00', { nextCheckinTime: '15:00' });
    const at = reconcileDay(day([enon]), [appt('20_enon', '15:00')], '2026-09-07', names);
    assert.deepEqual(at.byRow.get('20_enon|2026-09-04'), { kind: 'late', time: '15:00', checkinTime: '15:00' });
    const after = reconcileDay(day([enon]), [appt('20_enon', '16:30')], '2026-09-07', names);
    assert.deepEqual(after.byRow.get('20_enon|2026-09-04'), { kind: 'late', time: '16:30', checkinTime: '15:00' });
    const before = reconcileDay(day([enon]), [appt('20_enon', '14:30')], '2026-09-07', names);
    assert.deepEqual(before.byRow.get('20_enon|2026-09-04'), { kind: 'agree', time: '14:30' });
    // Nobody arriving that day: a 4 PM cleaning is simply a cleaning.
    const noArrival = row('20_enon', '20 Enon', '11:00');
    const fine = reconcileDay(day([noArrival]), [appt('20_enon', '16:00')], '2026-09-07', names);
    assert.deepEqual(fine.byRow.get('20_enon|2026-09-04'), { kind: 'agree', time: '16:00' });
  });

  test('a visit with no checkout is an orphan, named from the registry', () => {
    const r = reconcileDay(day([windward]), [appt('3_windward', '10:00'), appt('84_thatcher', '13:00')], '2026-09-07', names);
    assert.deepEqual(r.orphans, [{ propertyId: '84_thatcher', propertyName: '84 Thatcher', time: '13:00' }]);
    assert.equal(summarize([r]).orphans, 1);
  });

  test('past the horizon, or with nothing on file, every row is unannounced and nothing is an orphan', () => {
    const past = reconcileDay(monday, batch, '2026-09-06', names);
    assert.equal(past.announced, false);
    assert.ok([...past.byRow.values()].every((v) => v.kind === 'unannounced'));
    assert.equal(past.orphans.length, 0);
    const nothing = reconcileDay(monday, [], null, names);
    assert.equal(nothing.announced, false);
  });

  test('only the same day counts: tomorrow\'s visit is not today\'s', () => {
    const r = reconcileDay(day([windward]), [appt('3_windward', '10:00', '2026-09-08')], '2026-09-08', names);
    assert.deepEqual(r.byRow.get('3_windward|2026-09-04'), { kind: 'no_appointment' });
    assert.equal(r.orphans.length, 0);
  });
});

describe('verdictLabel', () => {
  test('speaks about the cleaner, never about a vacancy', () => {
    assert.deepEqual(verdictLabel({ kind: 'no_appointment' }), { text: `${VENDOR_LABEL} has no cleaner booked`, tone: 'bad' });
    assert.deepEqual(verdictLabel({ kind: 'agree', time: '12:00' }), { text: `${VENDOR_LABEL} 12:00`, tone: 'ok' });
    assert.deepEqual(verdictLabel({ kind: 'early', time: '10:30', checkoutTime: '11:00' }), {
      text: `${VENDOR_LABEL} 10:30 · before 11:00 checkout`,
      tone: 'warn',
    });
    assert.deepEqual(verdictLabel({ kind: 'late', time: '16:00', checkinTime: '15:00' }), {
      text: `${VENDOR_LABEL} 16:00 · after 15:00 check-in`,
      tone: 'bad',
    });
    assert.equal(verdictLabel({ kind: 'unannounced' }), null);
    assert.equal(verdictLabel(undefined), null);
  });
});
