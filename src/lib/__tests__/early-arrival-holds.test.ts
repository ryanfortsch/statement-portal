/**
 * A paid early arrival reaches the cleaner schedule from the Guesty hold the
 * concierge writes, not from the reservation, which keeps the old check-in.
 * The fixture is the case that raised it: 7 Sumac, the guest paid for the
 * night of Tue 11/24 and the reservation still starts Wed 11/25 (Dotti,
 * 2026-11-11).
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  earlyArrivalReachStart,
  earlyArrivals,
  isEarlyArrivalNight,
  isEarlyArrivalNote,
  stayArrival,
} from '../early-arrival-holds.ts';
import type { HeldNight } from '../owner-hold-checkouts.ts';

const NOTE = 'Early arrival hold - Elisa Grassi (paid, Helm)';

function night(property_id: string, date: string, extra: Partial<HeldNight> = {}): HeldNight {
  return { property_id, date, block_type: 'm', block_reason: null, block_note: NOTE, ...extra };
}

describe('isEarlyArrivalNote', () => {
  test('the note the concierge writes is an early arrival', () => {
    assert.equal(isEarlyArrivalNote(NOTE), true);
  });
  test('an operator spelling it by hand is too', () => {
    assert.equal(isEarlyArrivalNote('early-arrival, guest paid'), true);
    assert.equal(isEarlyArrivalNote('Early Arrival'), true);
  });
  test('an extension, an owner block, nothing at all are not', () => {
    assert.equal(isEarlyArrivalNote('Extension hold - Stacey Grillo (paid, Helm)'), false);
    assert.equal(isEarlyArrivalNote('Owner use'), false);
    assert.equal(isEarlyArrivalNote(null), false);
  });
  test('a rule artifact with the words in its note is not a hold', () => {
    assert.equal(isEarlyArrivalNight({ block_type: 'bd', block_note: NOTE }), false);
    assert.equal(isEarlyArrivalNight({ block_type: null, block_note: NOTE }), false);
  });
});

describe('earlyArrivals', () => {
  const sumac = [{ property_id: '7_sumac', check_in: '2026-11-25' }];

  test('one held night before the check-in moves the arrival to that night', () => {
    assert.deepEqual(earlyArrivals([night('7_sumac', '2026-11-24')], sumac), [
      { propertyId: '7_sumac', bookedCheckIn: '2026-11-25', arrives: '2026-11-24' },
    ]);
  });

  test('two held nights move it back two', () => {
    const nights = [night('7_sumac', '2026-11-23'), night('7_sumac', '2026-11-24')];
    assert.deepEqual(earlyArrivals(nights, sumac), [
      { propertyId: '7_sumac', bookedCheckIn: '2026-11-25', arrives: '2026-11-23' },
    ]);
  });

  test('a hold the query window cut short still reaches its check-in through block_end', () => {
    // The window ends 11/23: only the first held night is in the read, but
    // every mirror row carries the ref's own range.
    const cut = [night('7_sumac', '2026-11-23', { block_start: '2026-11-23', block_end: '2026-11-24' })];
    assert.deepEqual(earlyArrivals(cut, sumac), [
      { propertyId: '7_sumac', bookedCheckIn: '2026-11-25', arrives: '2026-11-23' },
    ]);
  });

  test('a hold that ends a night early abuts nothing and moves nothing', () => {
    assert.deepEqual(earlyArrivals([night('7_sumac', '2026-11-23')], sumac), []);
  });

  test('a hold at another home moves nothing here', () => {
    assert.deepEqual(earlyArrivals([night('3_south_st', '2026-11-24')], sumac), []);
  });

  test('an owner block abutting a check-in is not an early arrival', () => {
    const owner = night('7_sumac', '2026-11-24', { block_reason: 'Owner block', block_note: 'Owner use' });
    assert.deepEqual(earlyArrivals([owner], sumac), []);
  });

  test('a removed hold (refunded) leaves the arrival where Guesty has it', () => {
    assert.deepEqual(earlyArrivals([], sumac), []);
  });

  test('a long hand-made hold past the reach is not read as an arrival', () => {
    const long = Array.from({ length: 10 }, (_, i) =>
      night('7_sumac', `2026-11-${String(15 + i).padStart(2, '0')}`));
    assert.deepEqual(earlyArrivals(long, sumac), []);
  });
});

describe('the schedule and the extension detector read it', () => {
  const schedule = readFileSync(new URL('../checkout-schedule.ts', import.meta.url), 'utf8');
  const extension = readFileSync(new URL('../extension-holds.ts', import.meta.url), 'utf8');

  test('the schedule moves arrivals through earlyArrivals', () => {
    assert.match(schedule, /earlyArrivals\(holdsRes\.data/);
    assert.match(schedule, /arrivalByPropertyDay\.set\(`\$\{ea\.propertyId\}\|\$\{ea\.arrives\}`/);
  });

  test('the arrivals read reaches past the window, or an early arrival on its last day is missed', () => {
    assert.match(schedule, /\.lte\('check_in', addDays\(endDate, EARLY_ARRIVAL_REACH_DAYS\)\)/);
  });

  test('the holds read carries block_end', () => {
    assert.match(schedule, /block_note, block_start, block_end'\)/);
  });

  test('an early-arrival hold on a same-day turn is never filed as the departing guest extending', () => {
    assert.match(extension, /if \(isEarlyArrivalNote\(hold\.block_note\)\) continue;/);
    assert.match(extension, /if \(isEarlyArrivalNote\(n\)\) return false;/);
  });
});

describe('stayArrival (the guest app stay link)', () => {
  test('a paid night before check-in is the day the guest arrives', () => {
    assert.equal(stayArrival([night('3_south_st', '2026-11-23')], '3_south_st', '2026-11-24'), '2026-11-23');
  });
  test('no early arrival keeps the booked day', () => {
    assert.equal(stayArrival([], '3_south_st', '2026-11-24'), '2026-11-24');
  });
  test('an extension or owner hold before check-in is not an arrival', () => {
    const others = [
      night('3_south_st', '2026-11-23', { block_note: 'Extension hold - Pat Rowe (paid, Helm)' }),
      night('3_south_st', '2026-11-22', { block_note: 'Owner use' }),
    ];
    assert.equal(stayArrival(others, '3_south_st', '2026-11-24'), '2026-11-24');
  });
  test('a hold at another home, or one that ends a day early, moves nothing', () => {
    assert.equal(stayArrival([night('7_sumac', '2026-11-23')], '3_south_st', '2026-11-24'), '2026-11-24');
    assert.equal(stayArrival([night('3_south_st', '2026-11-22')], '3_south_st', '2026-11-24'), '2026-11-24');
  });
  test('the read reaches a week back', () => {
    assert.equal(earlyArrivalReachStart('2026-11-24'), '2026-11-17');
  });
  test('the stay link reads it, and keeps adjustments on the booked day', () => {
    const db = readFileSync(new URL('../guest-app-stays-db.ts', import.meta.url), 'utf8');
    assert.ok(db.includes('arrivalDay(row.property_id, found.canonical.check_in)'), 'the page shows the day the guest comes');
    assert.ok(db.includes('stayTimes(row.property_id, found.canonical.check_in)'), 'checkout_adjustments are filed under the booked check-in');
    assert.ok(db.includes('checkIn: await arrivalDay(canonical.property_id, canonical.check_in)'), 'minting uses the same window');
  });
});
