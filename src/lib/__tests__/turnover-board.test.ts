/**
 * The turnover board: one line per house per day. Synthetic homes and
 * guests; the clock is fixed at Sunday 2026-10-18, 9:00 AM Eastern, the
 * moment the operations manager opens the page.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARD_STATE_LABEL,
  boardLifecycle,
  clock,
  composeBoard,
  pairText,
  walkSlot,
  walkVerb,
  type BoardRow,
} from '../turnover-board.ts';
import type { Turnover } from '../operations.ts';
import type { CleaningDay, CleaningItem } from '../cleaning-days.ts';

const TODAY = '2026-10-18'; // Sunday
const NOW = Date.parse('2026-10-18T13:00:00Z'); // 9:00 AM EDT

function turnover(over: Partial<Turnover> & Pick<Turnover, 'propertyId' | 'checkIn'>): Turnover {
  return {
    reservationId: `res-${over.propertyId}-${over.checkIn}`,
    propertyName: over.propertyId.replace(/_/g, ' '),
    propertyTitle: null,
    guestName: 'Arriving Guest',
    channel: 'airbnb',
    checkOut: '2026-10-25',
    nights: 3,
    status: 'confirmed',
    isSameDayTurnover: false,
    previousCheckout: null,
    previousGuestName: 'Leaving Guest',
    previousStayCheckIn: null,
    checkInTime: '16:00',
    inspection: null,
    inspectionStatus: 'not_started',
    inspectionInProgress: false,
    inspectionStartedAt: null,
    inspectionViaLock: false,
    plan: null,
    cleaning: null,
    cleaningSession: null,
    openWorkSlipsCount: 0,
    prepSlips: [],
    lockBattery: null,
    lockMonitored: false,
    manuallyCompleted: false,
    completedAt: null,
    completedByEmail: null,
    ...over,
  };
}

function item(over: Partial<CleaningItem> & Pick<CleaningItem, 'propertyId'>): CleaningItem {
  return {
    propertyName: over.propertyId.replace(/_/g, ' '),
    guestName: 'Leaving Guest',
    checkIn: '2026-10-14',
    cleaningTime: '11:00',
    checkoutTime: '10:00',
    sameDayTurnover: false,
    nextCheckinTime: null,
    status: 'agree',
    ...over,
  };
}

function day(date: string, items: CleaningItem[], skipped: CleaningDay['skipped'] = []): CleaningDay {
  return { date, announced: true, items, booked: items.length, checkouts: items.length, attention: 0, skipped };
}

function board(turnovers: Turnover[], days: CleaningDay[] | null, rangeEnd = '2026-10-19') {
  return composeBoard({ turnovers, cleaningDays: days, departureSignals: {}, today: TODAY, rangeEnd, nowMs: NOW });
}

function rowsOf(b: ReturnType<typeof board>): BoardRow[] {
  return [...b.days.flatMap((d) => d.rows), ...b.done];
}

describe('the board clock', () => {
  test('times read twelve-hour without AM/PM', () => {
    assert.equal(clock('09:30'), '9:30');
    assert.equal(clock('10:00'), '10:00');
    assert.equal(clock('16:00'), '4:00');
    assert.equal(clock('12:00'), '12:00');
    assert.equal(clock('00:15'), '12:15');
  });

  test('the pair names the other day by weekday, and a far arrival by date', () => {
    assert.equal(pairText(TODAY, { date: TODAY, time: '10:00' }, { date: TODAY, time: '16:00' }), 'Out 10:00 · In 4:00');
    assert.equal(pairText(TODAY, { date: TODAY, time: '10:00' }, { date: '2026-10-22', time: '16:00' }), 'Out 10:00 · In Thu 4:00');
    assert.equal(pairText(TODAY, { date: '2026-10-17', time: null }, { date: TODAY, time: '15:00' }), 'Out Sat · In 3:00');
    assert.equal(pairText(TODAY, { date: TODAY, time: '11:00' }, { date: '2026-11-02', time: '16:00' }), 'Out 11:00 · In Nov 2');
    assert.equal(pairText(TODAY, { date: TODAY, time: '10:00' }, null), 'Out 10:00 · Vacant');
    assert.equal(pairText(TODAY, null, { date: TODAY, time: '16:00' }), 'In 4:00');
  });

  test('check-in is 4 PM in Gloucester, not 4 PM wherever the server runs', () => {
    const t = turnover({ propertyId: 'home_a', checkIn: TODAY, previousCheckout: TODAY, isSameDayTurnover: true });
    // 3:30 PM EDT: the guest is not due yet. A UTC parse of "T16:00" would
    // have called this overdue since noon.
    assert.equal(boardLifecycle(t, Date.parse('2026-10-18T19:30:00Z'), TODAY).overdue, false);
    assert.equal(boardLifecycle(t, Date.parse('2026-10-18T20:30:00Z'), TODAY).overdue, true);
  });
});

describe('one line per house per day', () => {
  test('a same-day turn: one row, the pair, the cleaner, Start walk', () => {
    const t = turnover({ propertyId: 'home_a', checkIn: TODAY, previousCheckout: TODAY, previousStayCheckIn: '2026-10-14', isSameDayTurnover: true });
    const b = board([t], [day(TODAY, [item({ propertyId: 'home_a', cleaningTime: '10:30', sameDayTurnover: true })])]);
    const rows = rowsOf(b);
    assert.equal(rows.length, 1, 'the schedule entry pairs with the turnover; no second row');
    const [r] = rows;
    assert.equal(r.day, TODAY);
    assert.equal(r.pair, 'Out 10:00 · In 4:00');
    assert.equal(r.sameDay, true);
    assert.equal(r.cleaner?.label, 'Cleaner booked 10:30');
    assert.equal(r.walk?.label, 'Not walked');
    assert.equal(r.verb, 'start');
    assert.equal(r.out?.guest, 'Leaving Guest', 'the departing guest is the subject of the clean');
    assert.equal(r.outAnchor, `out-home_a-${TODAY}`);
  });

  test('a house that empties today and fills Thursday sits under today, with Plan walk', () => {
    const t = turnover({ propertyId: 'home_b', checkIn: '2026-10-22', previousCheckout: TODAY });
    const b = board([t], [day(TODAY, [item({ propertyId: 'home_b' })])]);
    const [r] = rowsOf(b);
    assert.equal(r.day, TODAY);
    assert.equal(r.pair, 'Out 10:00 · In Thu 4:00');
    assert.equal(r.verb, 'plan');
  });

  test('cleaned yesterday, arriving today: Needs walk, counted on the strip', () => {
    const t = turnover({
      propertyId: 'home_c',
      checkIn: TODAY,
      previousCheckout: '2026-10-17',
      cleaning: { completedAt: '2026-10-17T18:40:00Z', source: 'quo', sourcePhone: null },
    });
    const b = board([t], []);
    const [r] = rowsOf(b);
    assert.equal(r.day, TODAY);
    assert.equal(r.pair, 'Out Sat · In 4:00');
    assert.equal(r.cleaner?.label, 'Cleaned');
    assert.equal(r.walk?.label, 'Needs walk');
    assert.deepEqual(b.counts.map((c) => [c.label, c.n]), [['Needs walk', 1]]);
  });

  test('an unconfirmed clean due tomorrow floats to today; one days away stays on its day', () => {
    const soon = turnover({ propertyId: 'home_d', checkIn: '2026-10-19', previousCheckout: '2026-10-17' });
    const later = turnover({ propertyId: 'home_e', checkIn: '2026-10-21', previousCheckout: '2026-10-16' });
    const b = board([soon, later], [], '2026-10-25');
    const byId = new Map(rowsOf(b).map((r) => [r.propertyId, r]));
    assert.equal(byId.get('home_d')?.day, TODAY, 'the clean is live: it belongs to today');
    assert.equal(byId.get('home_d')?.cleaner?.label, 'Clean not confirmed');
    assert.equal(byId.get('home_d')?.cleaner?.tone, 'warn');
    assert.equal(byId.get('home_e')?.day, '2026-10-21');
    assert.equal(byId.get('home_e')?.cleaner?.tone, 'mute', 'not due yet: said, not shouted');
  });

  test('rows outside the range are left off', () => {
    const t = turnover({ propertyId: 'home_e', checkIn: '2026-10-21', previousCheckout: '2026-10-16' });
    assert.equal(rowsOf(board([t], [])).length, 0);
  });

  test('a checkout with nobody behind it is a row of its own', () => {
    const b = board([], [day(TODAY, [item({ propertyId: 'home_f', status: 'no_appointment', cleaningTime: null })])]);
    const [r] = rowsOf(b);
    assert.equal(r.id, `out-home_f-${TODAY}`);
    assert.equal(r.pair, 'Out 10:00 · Vacant');
    assert.equal(r.cleaner?.label, 'No cleaner booked');
    assert.equal(r.verb, null);
    assert.equal(r.walk, null);
    assert.deepEqual(b.counts.map((c) => [c.key, c.n, c.firstId]), [['no_cleaner', 1, r.id]]);
  });

  test('an extension Helm knows about pairs by the stay, not the stale date', () => {
    const t = turnover({
      propertyId: 'home_g',
      checkIn: '2026-10-24',
      previousCheckout: TODAY,
      previousStayCheckIn: '2026-10-10',
    });
    const b = board([t], [day('2026-10-19', [item({ propertyId: 'home_g', checkIn: '2026-10-10', checkoutTime: '11:00' })])]);
    const rows = rowsOf(b);
    assert.equal(rows.length, 1, 'no orphan row for the moved checkout');
    assert.equal(rows[0].day, '2026-10-19');
    assert.equal(rows[0].pair, 'Out 11:00 · In Sat 4:00');
  });

  test('a vendor visit with no checkout is not a board row (it stays on the Cape Ann Elite list)', () => {
    const b = board([], [day(TODAY, [item({ propertyId: 'home_h', checkIn: null, checkoutTime: null, status: 'no_checkout' })])]);
    assert.equal(rowsOf(b).length, 0);
  });

  test('a checkout marked "no cleaning needed" says so and folds as done', () => {
    const b = board([], [day(TODAY, [], [{ propertyId: 'home_i', propertyName: 'home i', guestName: null, checkIn: '2026-10-12', checkoutTime: '10:00' }])]);
    const [r] = b.done;
    assert.equal(r.cleaner?.label, 'No cleaning needed');
  });
});

describe('the walk and its one verb', () => {
  const lc = (t: Turnover) => boardLifecycle(t, NOW, TODAY);

  test('walked rows fold as done and offer the summary', () => {
    const t = turnover({
      propertyId: 'home_a',
      checkIn: TODAY,
      inspectionStatus: 'complete',
      inspection: { id: 'insp-1', property_id: 'home_a', started_at: '2026-10-18T12:00:00Z', completed_at: '2026-10-18T12:40:00Z' },
    });
    const b = board([t], []);
    assert.equal(b.days.length, 0);
    assert.equal(b.done[0].walk?.label, 'Walked');
    assert.equal(b.done[0].verb, 'summary');
  });

  test('marked ready by hand: no verb on the line (Undo lives in the opened row)', () => {
    const t = turnover({ propertyId: 'home_a', checkIn: TODAY, manuallyCompleted: true });
    assert.equal(walkSlot(t, lc(t), TODAY).label, 'Marked ready');
    assert.equal(walkVerb(t, lc(t)), null);
  });

  test('a walk in progress is Resume', () => {
    const t = turnover({
      propertyId: 'home_a',
      checkIn: TODAY,
      inspectionInProgress: true,
      inspection: { id: 'insp-2', property_id: 'home_a', started_at: '2026-10-18T12:00:00Z', completed_at: null },
    });
    assert.equal(walkSlot(t, lc(t), TODAY).label, 'Walking');
    assert.equal(walkVerb(t, lc(t)), 'resume');
  });

  test('a live Field packet names who has it and holds back Start; a submitted one asks for review', () => {
    const claimed = turnover({ propertyId: 'home_a', checkIn: TODAY, fieldPacket: { packetId: 'p1', status: 'claimed', contractorName: 'Alex Synthetic' } });
    assert.equal(walkSlot(claimed, lc(claimed), TODAY).label, 'Field · Alex Synthetic');
    assert.equal(walkVerb(claimed, lc(claimed)), null);
    const submitted = turnover({ propertyId: 'home_a', checkIn: TODAY, fieldPacket: { packetId: 'p1', status: 'submitted', contractorName: null } });
    assert.equal(walkVerb(submitted, lc(submitted)), 'review');
    const draft = turnover({ propertyId: 'home_a', checkIn: TODAY, fieldPacket: { packetId: 'p1', status: 'draft', contractorName: null } });
    assert.equal(walkVerb(draft, lc(draft)), 'start', 'a draft packet is published to nobody');
  });

  test('a planned walk says its day and its person, and Start appears once the window is live', () => {
    const plan = { id: 'plan-1', planned_for_date: TODAY, notes: null, planned_by_email: 'office@example.test', assigned_to_email: 'delaney@example.test' };
    const today = turnover({ propertyId: 'home_a', checkIn: TODAY, plan });
    assert.equal(walkSlot(today, lc(today), TODAY, () => 'Delaney').label, 'Walk today · Delaney');
    assert.equal(walkVerb(today, lc(today)), 'start');
    const later = turnover({ propertyId: 'home_a', checkIn: '2026-10-22', plan: { ...plan, planned_for_date: '2026-10-22' } });
    assert.equal(walkSlot(later, lc(later), TODAY, () => 'Delaney').label, 'Walk Thu · Delaney');
    assert.equal(walkVerb(later, lc(later)), 'plan');
  });
});

describe('the strip counts what the rows print', () => {
  test('every count names words its first row shows', () => {
    const rows = [
      turnover({ propertyId: 'home_a', checkIn: TODAY, previousCheckout: TODAY, isSameDayTurnover: true }),
      turnover({ propertyId: 'home_b', checkIn: TODAY, previousCheckout: TODAY, isSameDayTurnover: true }),
      turnover({
        propertyId: 'home_c',
        checkIn: TODAY,
        previousCheckout: '2026-10-17',
        lockMonitored: true,
        cleaningSession: { enteredAt: '2026-10-18T12:30:00Z', finishedAt: null, entrySource: 'seam_lock', finishSource: null, finishEstimated: false },
      }),
    ];
    const b = board(rows, [
      day(TODAY, [
        item({ propertyId: 'home_a', status: 'late', cleaningTime: '16:30' }),
        item({ propertyId: 'home_b', status: 'no_appointment', cleaningTime: null }),
      ]),
    ]);
    assert.deepEqual(b.counts.map((c) => c.key), ['no_cleaner', 'cleaner_late', 'cleaning_now']);
    const byId = new Map(rowsOf(b).map((r) => [r.id, r]));
    for (const c of b.counts) {
      const first = byId.get(c.firstId)!;
      const shown = [first.cleaner?.label, first.walk?.label].filter(Boolean) as string[];
      assert.ok(shown.some((s) => s.startsWith(c.label)), `${c.label} is printed on ${first.propertyName}`);
      assert.equal(c.label, BOARD_STATE_LABEL[c.key]);
    }
  });

  test('done rows are never counted', () => {
    const t = turnover({ propertyId: 'home_a', checkIn: TODAY, manuallyCompleted: true, previousCheckout: TODAY });
    const b = board([t], [day(TODAY, [item({ propertyId: 'home_a', status: 'no_appointment', cleaningTime: null })])]);
    assert.equal(b.counts.length, 0);
  });
});
