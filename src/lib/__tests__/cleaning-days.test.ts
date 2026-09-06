/**
 * The cleaning crew's day, flattened for the /turnovers/cleanings page and
 * the home strip. Fixtures are the real Monday 2026-09-07: ten checkouts on
 * our schedule, eight visits in A-1's 09:30 batch, and two houses (4 Middle
 * Road, 53 Rocky Neck Downstairs) they had nothing booked for.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { composeCleaningDay, composeVendorOnlyDay, ATTENTION_STATUSES } from '../cleaning-days.ts';
import type { ScheduleDay, ScheduleRow } from '../checkout-schedule.ts';
import type { VendorDayReport, VendorVerdict } from '../vendor-reconcile.ts';

function row(propertyId: string, propertyName: string, time: string, guestName = 'Guest'): ScheduleRow {
  return {
    propertyId,
    propertyName,
    address: '',
    city: 'Gloucester',
    guestName,
    checkIn: '2026-09-04',
    baseCheckOut: '2026-09-07',
    effectiveCheckOut: '2026-09-07',
    time,
    defaultTime: time,
    sameDayTurnover: false,
    conflictingCheckOut: null,
    nextCheckinTime: null,
    nextGuestName: null,
    adjustment: null,
    proposals: [],
  };
}

function day(rows: ScheduleRow[], date = '2026-09-07'): ScheduleDay {
  return { date, rows, counts: { checkouts: rows.length, sameDay: 0, adjusted: 0, proposed: 0 } };
}

function report(
  verdicts: Array<[ScheduleRow, VendorVerdict]>,
  orphans: VendorDayReport['orphans'] = [],
  announced = true,
): VendorDayReport {
  const byRow = new Map<string, VendorVerdict>();
  for (const [r, v] of verdicts) byRow.set(`${r.propertyId}|${r.checkIn}`, v);
  return { byRow, orphans, announced };
}

describe('composeCleaningDay', () => {
  // Monday 2026-09-07 as it stood on Saturday night. A-1's batch: 3 Windward
  // 10:00, 19 Rackliffe 12:00, 36 Granite 12:00, 3 Locust 13:00, 3 South
  // 13:30, 20 Hammond 14:00, 73 Rocky Neck 14:00, 53R Rocky Neck 15:30.
  const windward = row('3_windward', '3 Windward', '10:00', 'Natalie Pinckney');
  const middle = row('4_middle', '4 Middle Road', '10:00', 'Sarah Braun');
  const south = row('3_south_st', '3 South', '10:00', 'Nadeem');
  const rackliffe = row('19_rackliffe', '19 Rackliffe', '11:00', 'Melissa Buckley');
  const granite = row('36_granite', '36 Granite', '11:00', 'Kari Sizemore');
  const locust = row('3_locust', '3 Locust', '11:00', 'Brett McAllister');
  const hammond = row('20_hammond', '20 Hammond', '11:00', 'Carola Raggl');
  const rocky73 = row('73_rocky_neck', '73 Rocky Neck', '11:00', 'Christina Bethke');
  const rocky53 = row('53_rocky_neck', '53 Rocky Neck', '11:00', 'Linda Nelson');
  const rocky53down = row('53_rocky_neck_2', '53 Rocky Neck, Downstairs', '11:00', 'Simon Prudenzi');

  const monday = composeCleaningDay(
    day([windward, middle, south, rackliffe, granite, locust, hammond, rocky73, rocky53, rocky53down]),
    report([
      [windward, { kind: 'agree', time: '10:00' }],
      [middle, { kind: 'no_appointment' }],
      [south, { kind: 'agree', time: '13:30' }],
      [rackliffe, { kind: 'agree', time: '12:00' }],
      [granite, { kind: 'agree', time: '12:00' }],
      [locust, { kind: 'agree', time: '13:00' }],
      [hammond, { kind: 'agree', time: '14:00' }],
      [rocky73, { kind: 'agree', time: '14:00' }],
      [rocky53, { kind: 'agree', time: '15:30' }],
      [rocky53down, { kind: 'no_appointment' }],
    ]),
  );

  test('counts what the crew booked, what we have leaving, and what to chase', () => {
    assert.equal(monday.announced, true);
    assert.equal(monday.booked, 8);
    assert.equal(monday.checkouts, 10);
    assert.equal(monday.attention, 2);
  });

  test('reads in the route order the crew actually works, unbooked houses last', () => {
    assert.deepEqual(
      monday.items.map((i) => `${i.cleaningTime ?? '--:--'} ${i.propertyName}`),
      [
        '10:00 3 Windward',
        '12:00 19 Rackliffe',
        '12:00 36 Granite',
        '13:00 3 Locust',
        '13:30 3 South',
        '14:00 20 Hammond',
        '14:00 73 Rocky Neck',
        '15:30 53 Rocky Neck',
        '--:-- 4 Middle Road',
        '--:-- 53 Rocky Neck, Downstairs',
      ],
    );
  });

  test('a house with no visit booked keeps its checkout and its guest, so the row explains itself', () => {
    const item = monday.items.find((i) => i.propertyId === '4_middle')!;
    assert.equal(item.status, 'no_appointment');
    assert.equal(item.cleaningTime, null);
    assert.equal(item.checkoutTime, '10:00');
    assert.equal(item.guestName, 'Sarah Braun');
    assert.equal(item.checkIn, '2026-09-04');
    assert.ok(ATTENTION_STATUSES.has(item.status));
  });

  test('a visit at the checkout minute agrees; only a strictly earlier one is early', () => {
    const agree = monday.items.find((i) => i.propertyId === '3_windward')!;
    assert.equal(agree.status, 'agree');
    assert.equal(agree.cleaningTime, '10:00');
    assert.equal(agree.checkoutTime, '10:00');

    const thatcher = row('84_thatcher', '84 Thatcher', '11:00', 'Stacey Grillo');
    const early = composeCleaningDay(
      day([thatcher]),
      report([[thatcher, { kind: 'early', time: '10:30', checkoutTime: '11:00' }]]),
    );
    assert.equal(early.items[0].status, 'early');
    assert.equal(early.items[0].cleaningTime, '10:30');
    assert.equal(early.attention, 1);
    assert.equal(early.booked, 1);
  });

  test('a same-day visit at or after the next check-in is late: listed at its time and flagged', () => {
    const enon = { ...row('20_enon', '20 Enon', '11:00', 'Manmeet Singh'), sameDayTurnover: true, nextCheckinTime: '15:00' };
    const d = composeCleaningDay(day([enon]), report([[enon, { kind: 'late', time: '16:00', checkinTime: '15:00' }]]));
    assert.equal(d.items[0].status, 'late');
    assert.equal(d.items[0].cleaningTime, '16:00');
    assert.equal(d.items[0].sameDayTurnover, true);
    assert.equal(d.items[0].nextCheckinTime, '15:00');
    assert.equal(d.booked, 1);
    assert.equal(d.attention, 1);
    assert.ok(ATTENTION_STATUSES.has('late'));
  });

  test('a visit with nobody leaving is listed at its time, flagged, and counts as booked', () => {
    const enon = row('20_enon', '20 Enon', '11:00', 'Manmeet Singh');
    const d = composeCleaningDay(
      day([enon]),
      report(
        [[enon, { kind: 'agree', time: '11:30' }]],
        [{ propertyId: '84_thatcher', propertyName: '84 Thatcher', time: '13:00' }],
      ),
    );
    assert.equal(d.items.length, 2);
    const orphan = d.items[1];
    assert.equal(orphan.propertyName, '84 Thatcher');
    assert.equal(orphan.status, 'no_checkout');
    assert.equal(orphan.cleaningTime, '13:00');
    assert.equal(orphan.checkoutTime, null);
    assert.equal(orphan.guestName, null);
    assert.equal(d.booked, 2);
    assert.equal(d.checkouts, 1);
    assert.equal(d.attention, 1);
  });

  test('past the horizon every checkout is unannounced: listed, muted, never a problem', () => {
    const beach = row('17_beach_rd', '17 Beach', '10:00', 'jeremy abrams');
    const woodward = row('30_woodward', '30 Woodward', '11:00', 'Nicole Francoeur');
    const d = composeCleaningDay(
      day([woodward, beach], '2026-09-10'),
      report([[beach, { kind: 'unannounced' }], [woodward, { kind: 'unannounced' }]], [], false),
    );
    assert.equal(d.announced, false);
    assert.equal(d.booked, 0);
    assert.equal(d.checkouts, 2);
    assert.equal(d.attention, 0);
    assert.deepEqual(d.items.map((i) => i.status), ['unannounced', 'unannounced']);
    // Unbooked rows order by checkout time, then name.
    assert.deepEqual(d.items.map((i) => i.propertyName), ['17 Beach', '30 Woodward']);
  });

  test('a row the report never judged reads as unannounced rather than crashing or lying', () => {
    const r = row('21_horton', '21 Horton', '11:00');
    const d = composeCleaningDay(day([r]), report([]));
    assert.equal(d.items[0].status, 'unannounced');
    assert.equal(d.items[0].cleaningTime, null);
  });
});

describe('composeVendorOnlyDay', () => {
  const names = new Map([
    ['79_main', '79 Main'],
    ['17_beach_rd', '17 Beach'],
  ]);
  const appts = [
    { property_id: '79_main', service_date: '2026-09-08', service_time: '13:00' },
    { property_id: '17_beach_rd', service_date: '2026-09-08', service_time: '10:00' },
    { property_id: '30_woodward', service_date: '2026-09-08', service_time: '12:00' },
    { property_id: '3_south_st', service_date: '2026-09-07', service_time: '13:30' },
  ];

  test('lists the day the crew booked, unjudged, when our schedule is down', () => {
    const d = composeVendorOnlyDay('2026-09-08', appts, '2026-09-08', names);
    assert.equal(d.announced, true);
    assert.equal(d.booked, 3);
    assert.equal(d.checkouts, 0);
    assert.equal(d.attention, 0);
    assert.deepEqual(
      d.items.map((i) => `${i.cleaningTime} ${i.propertyName} ${i.status}`),
      ['10:00 17 Beach unchecked', '12:00 30_woodward unchecked', '13:00 79 Main unchecked'],
    );
  });

  test('a day past the horizon is unannounced even with no schedule to compare', () => {
    const d = composeVendorOnlyDay('2026-09-09', appts, '2026-09-08', names);
    assert.equal(d.announced, false);
    assert.equal(d.items.length, 0);
  });
});
