import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { matchPropertyByAddress, parseReminder, type PropertyLite } from '../vendor-reminder.ts';
import { reconcileDay, summarize } from '../vendor-reconcile.ts';
import { composeCleaningDay } from '../cleaning-days.ts';
import type { ScheduleDay, ScheduleRow } from '../checkout-schedule.ts';

// Synthetic registry and dispatch texts. No live customer records.
const homes: PropertyLite[] = [
  { id: 'beach', name: '17 Beach', address: '17 Beach Road' },
  { id: 'beach_front', name: '17 Beach Front Unit', address: '17 Beach Road (Front Unit)' },
  { id: 'beach_back', name: '17 Beach Guest House', address: '17 Beach Road (Guest House)' },
  { id: 'middle', name: '4 Middle Road', address: '4 Middle Road' },
  { id: 'middle_north', name: '4 Middle North Unit', address: '4 Middle Road (North Unit)' },
  { id: 'middle_second', name: '4 Middle Second Unit', address: '4 Middle Road (Second Unit)' },
  { id: 'sumac', name: '7 Sumac', address: '7 Sumac Lane' },
  { id: 'sumac_main', name: '7 Sumac Main House', address: '7 Sumac Lane (Main House)' },
  { id: 'sumac_back', name: '7 Sumac Back Unit', address: '7 Sumac Lane (Back Unit)' },
  { id: 'rocky', name: '53 Rocky Neck', address: '53 Rocky Neck Avenue' },
  { id: 'rocky_down', name: '53 Rocky Neck, Downstairs', address: '53 Rocky Neck Avenue' },
];

describe('vendor reminder property identity', () => {
  for (const [address, expected] of [
    ['17 Beach Road', 'beach'],
    ['4 Middle Road', 'middle'],
    ['7 Sumac Lane', 'sumac'],
    ['53R Rocky Neck Avenue', 'rocky'],
    ['17 Beach Road (Front Unit)', 'beach_front'],
    ['17 Beach Road (Guest House)', 'beach_back'],
    ['4 Middle Road (North Unit)', 'middle_north'],
    ['4 Middle Road (Second Unit)', 'middle_second'],
    ['7 Sumac Lane (Main House)', 'sumac_main'],
    ['7 Sumac Lane (Back Unit)', 'sumac_back'],
    ['53R Down. Rocky Neck Avenue', 'rocky_down'],
  ]) {
    test(`${address} belongs to ${expected}, independent of registry order`, () => {
      assert.equal(matchPropertyByAddress(address, homes), expected);
      assert.equal(matchPropertyByAddress(address, [...homes].reverse()), expected);
    });
  }

  test('ambiguous sibling-only matches are unmatched, even with different name lengths', () => {
    const siblings = [
      { id: 'east', name: '99 Test East Unit', address: '99 Test Road (East Unit)' },
      { id: 'west', name: '99 Test West Guest House', address: '99 Test Road (West Guest House)' },
    ];
    assert.equal(matchPropertyByAddress('99 Test Road', siblings), null);
    assert.equal(matchPropertyByAddress('99 Test Road', [...siblings].reverse()), null);
  });

  test('indistinguishable rows do not depend on database row order', () => {
    const duplicates = [homes[0], { ...homes[0], id: 'other_beach' }];
    assert.equal(matchPropertyByAddress('17 Beach Road', duplicates), null);
  });

  test('requires a matching street number and at least two matching tokens', () => {
    assert.equal(matchPropertyByAddress('117 Beach Road', homes), null);
    assert.equal(matchPropertyByAddress('17 Unrecognized', homes), null);
    assert.equal(matchPropertyByAddress('Beach Road', homes), null);
    assert.equal(matchPropertyByAddress('', homes), null);
  });

  test('preserves reminder date, time and original address', () => {
    assert.deepEqual(parseReminder('Reminder: Nov 2, 2026  10:00AM at 17 Beach Road / Gloucester, Massachusetts 1930', homes), {
      property_id: 'beach', service_date: '2026-11-02', service_time: '10:00', raw_address: '17 Beach Road',
    });
    assert.equal(parseReminder('Nov 2, 2026 12:00AM at 17 Beach Road / MA', homes)?.service_time, '00:00');
    assert.equal(parseReminder('Nov 2, 2026 12:00PM at 17 Beach Road / MA', homes)?.service_time, '12:00');
    assert.equal(parseReminder('Nov 2, 2026 3:30PM at 53R Down. Rocky Neck Avenue / MA', homes)?.service_time, '15:30');
    assert.equal(parseReminder('Not an appointment', homes), null);
  });

  test('plain-address reminders reconcile to two checkouts without phantom subunit warnings', () => {
    const date = '2026-11-02';
    const rows: ScheduleRow[] = homes.filter((p) => ['beach', 'middle'].includes(p.id)).map((p) => ({
      propertyId: p.id, propertyName: p.name!, address: p.address!, city: 'Test city', guestName: 'Test guest',
      checkIn: '2026-10-30', baseCheckOut: date, effectiveCheckOut: date, time: '10:00', defaultTime: '10:00',
      sameDayTurnover: false, conflictingCheckOut: null, nextCheckinTime: null, nextGuestName: null,
      adjustment: null, proposals: [],
    }));
    const day: ScheduleDay = { date, rows, counts: { checkouts: 2, sameDay: 0, adjusted: 0, proposed: 0 } };
    const appointments = ['17 Beach Road', '4 Middle Road'].map((address) => parseReminder(
      `Nov 2, 2026 10:00AM at ${address} / Test city`, homes,
    )!);
    const report = reconcileDay(day, appointments, date, new Map(homes.map((p) => [p.id, p.name!])));
    assert.deepEqual(summarize([report]), { agree: 2, early: 0, late: 0, missing: 0, orphans: 0 });
    const display = composeCleaningDay(day, report);
    assert.equal(display.items.length, 2);
    assert.equal(display.booked, 2);
    assert.equal(display.attention, 0);
    assert.deepEqual(display.items.map((i) => i.propertyId).sort(), ['beach', 'middle']);
  });
});
