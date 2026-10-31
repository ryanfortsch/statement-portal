/**
 * The week grid on Turnovers: who is going where. Synthetic homes and
 * guests; the clock is Sunday 2026-10-18, the morning the operations
 * manager opens the page on her phone.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  composeVisitGrid,
  deadlineChip,
  etDay,
  gridDays,
  initialsOfName,
  toGridStay,
  GRID_DAYS,
  PREP_DAYS,
  type GridHome,
  type GridStay,
  type GridCell,
} from '../visit-grid.ts';
import type { Turnover } from '../operations.ts';

const TODAY = '2026-10-18';
const DAYS = gridDays(TODAY, GRID_DAYS);
const ME = 'delaney@risingtidestr.com';
const ME_FIELD = 'delaneyjordan@outlook.com';
const DOTTI = 'dotti@risingtidestr.com';
const NAMES: Record<string, string> = { [ME]: 'Delaney', [ME_FIELD]: 'Delaney', [DOTTI]: 'Dotti' };
const INITIALS: Record<string, string> = { [ME]: 'DJ', [ME_FIELD]: 'DJ', [DOTTI]: 'DM' };
const nameFor = (e: string) => NAMES[e] ?? e;
const initialsFor = (e: string) => INITIALS[e] ?? '??';
const identityFor = (e: string) => (e === ME_FIELD ? ME : e);

type Occ = { id: string; in: string; out: string; kind?: 'guest' | 'block' };

/** A home's half-day cells over a wide window, from its stays and holds. */
function home(id: string, name: string, occ: Occ[]): GridHome {
  const cells = gridDays('2026-10-10', 30).map((date) => {
    const pm = occ.find((o) => o.in <= date && date < o.out) ?? null;
    const am = occ.find((o) => o.in < date && date <= o.out) ?? null;
    const to = (o: Occ | null) => (o ? { stayId: o.id, kind: o.kind ?? ('guest' as const) } : null);
    return { date, am: to(am), pm: to(pm) };
  });
  return { id, name, cells };
}

function stay(over: Partial<GridStay> & Pick<GridStay, 'reservationId' | 'propertyId' | 'checkIn'>): GridStay {
  return {
    checkOut: '2026-11-01',
    guest: 'Synthetic Guest',
    channel: null,
    plan: null,
    walk: 'open',
    walkedOn: null,
    walkedBy: null,
    field: null,
    ...over,
  };
}

const HOMES: GridHome[] = [
  home('21_horton', '21 Horton', [
    { id: 'A', in: '2026-10-16', out: '2026-10-19' },
    { id: 'B', in: '2026-10-21', out: '2026-10-24' },
    { id: 'blk', in: '2026-10-26', out: '2026-10-28', kind: 'block' },
  ]),
  home('3_south', '3 South', [{ id: 'C', in: '2026-10-20', out: '2026-10-23' }]),
  home('20_enon', '20 Enon', [{ id: 'D', in: '2026-10-19', out: '2026-10-22' }]),
  home('30_woodward', '30 Woodward', [{ id: 'E', in: '2026-10-19', out: '2026-10-25' }]),
  home('19_rackliffe', '19 Rackliffe', [{ id: 'F', in: '2026-10-20', out: '2026-10-27' }]),
  home('3_locust', '3 Locust', [{ id: 'G', in: '2026-10-22', out: '2026-10-25' }]),
  home('7_sumac', '7 Sumac', [{ id: 'I', in: '2026-10-30', out: '2026-11-03' }]),
  home('16_waterman', '16 Waterman', [{ id: 'J', in: '2026-10-18', out: '2026-10-20' }, { id: 'K', in: '2026-10-21', out: '2026-10-24' }]),
  home('36_granite', '36 Granite', [{ id: 'L', in: '2026-10-20', out: '2026-10-23' }]),
  home('17_beach', '17 Beach', []),
  home('84_thatcher', '84 Thatcher', [{ id: 'long', in: '2026-10-10', out: '2026-11-05' }]),
  home('73_rocky_neck', '73 Rocky Neck', [{ id: 'H', in: '2026-10-15', out: '2026-10-19' }]),
  home('4_middle', '4 Middle Road', [{ id: 'M', in: '2026-11-02', out: '2026-11-06' }]),
  home('47_atlantic', '47 Atlantic', [{ id: 'N', in: '2026-11-10', out: '2026-11-14' }]),
];

const STAYS: GridStay[] = [
  stay({ reservationId: 'B', propertyId: '21_horton', checkIn: '2026-10-21', checkOut: '2026-10-24', plan: { id: 'p1', date: '2026-10-20', assignee: ME, plannedBy: DOTTI, hasNotes: false } }),
  stay({ reservationId: 'C', propertyId: '3_south', checkIn: '2026-10-20', checkOut: '2026-10-23', channel: 'vrbo' }),
  stay({ reservationId: 'D', propertyId: '20_enon', checkIn: '2026-10-19', checkOut: '2026-10-22', field: { status: 'claimed', contractor: 'James Liddell', visitDate: '2026-10-18' } }),
  stay({ reservationId: 'E', propertyId: '30_woodward', checkIn: '2026-10-19', checkOut: '2026-10-25', walk: 'done', walkedOn: '2026-10-18', walkedBy: DOTTI, field: { status: 'approved', contractor: 'Dotti Maguire', visitDate: '2026-10-18' } }),
  stay({ reservationId: 'F', propertyId: '19_rackliffe', checkIn: '2026-10-20', checkOut: '2026-10-27', plan: { id: 'p2', date: '2026-10-16', assignee: DOTTI, plannedBy: DOTTI, hasNotes: false } }),
  stay({ reservationId: 'G', propertyId: '3_locust', checkIn: '2026-10-22', checkOut: '2026-10-25', plan: { id: 'p3', date: '2026-10-21', assignee: null, plannedBy: DOTTI, hasNotes: false } }),
  stay({ reservationId: 'I', propertyId: '7_sumac', checkIn: '2026-10-30', checkOut: '2026-11-03' }),
  stay({ reservationId: 'J', propertyId: '16_waterman', checkIn: '2026-10-18', checkOut: '2026-10-20', walk: 'done', walkedOn: '2026-10-18', walkedBy: ME }),
  stay({ reservationId: 'K', propertyId: '16_waterman', checkIn: '2026-10-21', checkOut: '2026-10-24', plan: { id: 'p4', date: '2026-10-16', assignee: DOTTI, plannedBy: DOTTI, hasNotes: true } }),
  stay({ reservationId: 'L', propertyId: '36_granite', checkIn: '2026-10-20', checkOut: '2026-10-23', field: { status: 'published', contractor: null, visitDate: '2026-10-19' } }),
  stay({ reservationId: 'M', propertyId: '4_middle', checkIn: '2026-11-02', checkOut: '2026-11-06' }),
  stay({ reservationId: 'N', propertyId: '47_atlantic', checkIn: '2026-11-10', checkOut: '2026-11-14' }),
];

function gridFor(myEmail: string, stays: GridStay[] = STAYS) {
  return composeVisitGrid({ today: TODAY, days: DAYS, homes: HOMES, stays, myEmail, nameFor, initialsFor, identityFor });
}
function cell(myEmail: string, pid: string, date: string): GridCell {
  const row = gridFor(myEmail).rows.find((r) => r.propertyId === pid);
  assert.ok(row, `${pid} is on the grid`);
  const c = row.cells.find((x) => x.date === date);
  assert.ok(c, `${pid} has ${date}`);
  return c;
}

describe('the channel rides the arrival day', () => {
  test('the arriving stay\'s channel sits on its arrival cell and nowhere else', () => {
    assert.equal(cell(ME, '3_south', '2026-10-20').channel, 'vrbo', 'the arrival day carries it');
    assert.equal(cell(ME, '3_south', '2026-10-19').channel, null, 'not the prep day before');
    assert.equal(cell(ME, '3_south', '2026-10-21').channel, null, 'not the nights in house');
    assert.equal(cell(ME, '21_horton', '2026-10-21').channel, null, 'a stay with no channel on file shows no dot');
  });
});

describe('what the house is doing that day', () => {
  test('a guest in the house all day is occupied, and nothing can be tapped', () => {
    const c = cell(ME, '21_horton', '2026-10-18');
    assert.equal(c.state, 'occupied');
    assert.equal(c.tap.kind, 'none');
    assert.equal(c.needs, false);
    assert.equal(c.continues, true, 'the bar runs through from Saturday night');
  });
  test('the checkout day is open with the morning guest leaving', () => {
    const c = cell(ME, '21_horton', '2026-10-19');
    assert.equal(c.state, 'open');
    assert.equal(c.am, 'guest');
    assert.equal(c.pm, null);
    assert.equal(c.leaving, true);
    assert.equal(c.arriving, false);
  });
  test('the arrival day is open with the night guest arriving', () => {
    const c = cell(ME, '21_horton', '2026-10-21');
    assert.equal(c.state, 'open');
    assert.equal(c.arriving, true);
    assert.equal(c.pm, 'guest');
  });
  test("an owner's hold is blocked on its full days and open the day it starts", () => {
    assert.equal(cell(ME, '21_horton', '2026-10-27').state, 'blocked');
    const starts = cell(ME, '21_horton', '2026-10-26');
    assert.equal(starts.state, 'open');
    assert.equal(starts.pm, 'block');
    assert.equal(starts.arriving, false, 'a hold is not a guest deadline');
    assert.equal(starts.hold, 'edge');
    assert.equal(cell(ME, '21_horton', '2026-10-27').hold, 'edge', 'the owner leaves inside the window: the hold keeps its weight');
    assert.equal(cell(ME, '21_horton', '2026-10-25').hold, null);
  });
  test("a hold that runs past the last day shown is a whisper; one that ends in view is not", () => {
    const homes = [
      home('79_main', '79 Main', [{ id: 'own', in: '2026-10-01', out: '2026-12-01', kind: 'block' }]),
      home('36_granite', '36 Granite', [{ id: 'L', in: '2026-10-20', out: '2026-10-23' }, { id: 'own2', in: '2026-10-23', out: '2026-12-01', kind: 'block' }]),
      home('3_locust', '3 Locust', [{ id: 'G', in: '2026-10-19', out: '2026-10-21' }, { id: 'own3', in: '2026-10-21', out: '2026-10-24', kind: 'block' }]),
    ];
    const grid = composeVisitGrid({ today: TODAY, days: DAYS, homes, stays: [], myEmail: ME, nameFor, initialsFor });
    const row = (id: string) => grid.rows.find((r) => r.propertyId === id)!;
    assert.ok(row('79_main').cells.every((c) => c.state === 'blocked' && c.hold === 'long'), "the owner's for the foreseeable: every cell a whisper");
    const granite = row('36_granite');
    assert.equal(granite.cells.find((c) => c.date === '2026-10-23')!.hold, 'long', 'a hold that starts in the window but never ends in it is still a whisper');
    assert.equal(granite.cells.find((c) => c.date === '2026-10-22')!.hold, null, 'the guest before it is a guest');
    const locust = row('3_locust');
    assert.ok(['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24'].every((d) => locust.cells.find((c) => c.date === d)!.hold === 'edge'), 'the owner leaves on the 24th: the clean after is in view, full weight');
  });
});

describe("a split home's units ride under their house", () => {
  // 17 Beach: the house has nothing on, the Guest House has a guest, the
  // Front Unit nothing. 4 Middle: the house has a guest coming, the North
  // Unit sits in its winter hand block, the Road Unit has a guest leaving.
  const homes = [
    home('21_horton', '21 Horton', [{ id: 'B', in: '2026-10-21', out: '2026-10-24' }]),
    home('17_beach', '17 Beach', []),
    home('17_beach_front', '17 Beach Front Unit', []),
    home('17_beach_back', '17 Beach Guest House', [{ id: 'U', in: '2026-10-22', out: '2026-10-25' }]),
    home('4_middle', '4 Middle Road', [{ id: 'M', in: '2026-11-02', out: '2026-11-06' }]),
    home('4_middle_north', '4 Middle North Unit', [{ id: 'hold', in: '2026-10-01', out: '2027-01-05', kind: 'block' }]),
    home('4_middle_unit', '4 Middle Road Unit', [{ id: 'V', in: '2026-10-16', out: '2026-10-19' }]),
    home('x_unit', 'X Unit', []),
  ];
  const parentOf = { '17_beach_front': '17_beach', '17_beach_back': '17_beach', '4_middle_north': '4_middle', '4_middle_unit': '4_middle', x_unit: 'x_house' };
  const stays = [
    stay({ reservationId: 'B', propertyId: '21_horton', checkIn: '2026-10-21', checkOut: '2026-10-24' }),
    stay({ reservationId: 'U', propertyId: '17_beach_back', checkIn: '2026-10-22', checkOut: '2026-10-25' }),
    stay({ reservationId: 'M', propertyId: '4_middle', checkIn: '2026-11-02', checkOut: '2026-11-06' }),
  ];
  const grid = composeVisitGrid({ today: TODAY, days: DAYS, homes, stays, myEmail: ME, nameFor, initialsFor, parentOf });
  const row = (id: string) => grid.rows.find((r) => r.propertyId === id);
  test('a unit with a guest in the window is a row under its house, and pulls the house up to its arrival', () => {
    assert.deepEqual(grid.rows.map((r) => r.propertyId), ['21_horton', '17_beach', '17_beach_back', '4_middle', '4_middle_unit', 'x_unit']);
    assert.equal(row('17_beach_back')!.unitOf, '17_beach');
    assert.equal(row('17_beach')!.unitOf, null);
    assert.equal(row('17_beach')!.quiet, false, 'the house reads as working because its unit is');
    assert.equal(row('17_beach_back')!.quiet, false);
    assert.equal(row('4_middle_unit')!.unitOf, '4_middle', 'a guest leaving is still a guest in the window');
  });
  test('a unit with nothing booked folds into its house as a count; a hold alone never opens a unit row', () => {
    assert.equal(row('17_beach_front'), undefined);
    assert.deepEqual(row('17_beach')!.foldedUnits, ['17 Beach Front Unit']);
    assert.equal(row('4_middle_north'), undefined, 'the winter hand block is not a booking');
    assert.deepEqual(row('4_middle')!.foldedUnits, ['4 Middle North Unit']);
    assert.deepEqual(row('21_horton')!.foldedUnits, []);
  });
  test('a unit whose house is not on the grid stays a row of its own', () => {
    assert.equal(row('x_unit')!.unitOf, null);
    assert.equal(row('x_unit')!.quiet, true);
  });
  test('the units still answer a tap: the Guest House asks for its prep days', () => {
    const back = row('17_beach_back')!;
    assert.deepEqual(back.cells.filter((c) => c.needs).map((c) => c.date), ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22']);
    assert.equal(back.cells.find((c) => c.date === '2026-10-20')!.tap.kind, 'claim');
  });
});

describe('who is going, and what a tap does', () => {
  test('an open day before an unplanned arrival needs someone; a tap claims it', () => {
    for (const d of ['2026-10-18', '2026-10-19', '2026-10-20']) {
      const c = cell(ME, '3_south', d);
      assert.equal(c.needs, true, d);
      assert.equal(c.tap.kind, 'claim', d);
    }
    const row = gridFor(ME).rows.find((r) => r.propertyId === '3_south')!;
    assert.equal(row.nextNeed, '2026-10-20');
    assert.equal(deadlineChip(row.nextNeed, TODAY), '2d');
  });
  test('my own plan: my mark on its day, a tap there lets go, a tap elsewhere moves it', () => {
    const mark = cell(ME, '21_horton', '2026-10-20');
    assert.deepEqual(mark.badges.map((b) => [b.kind, b.initials, b.mine]), [['plan', 'DJ', true]]);
    assert.equal(mark.tap.kind, 'release');
    if (mark.tap.kind === 'release') assert.equal(mark.tap.keep, true, 'Dotti planned it: letting go keeps her plan, nobody named');
    const own = STAYS.map((s) => (s.reservationId === 'B' ? { ...s, plan: { ...s.plan!, plannedBy: ME } } : s));
    const ownTap = gridFor(ME, own).rows.find((r) => r.propertyId === '21_horton')!.cells.find((c) => c.date === '2026-10-20')!.tap;
    assert.equal(ownTap.kind === 'release' && ownTap.keep, false, 'my own tap with no note is simply undone');
    const noted = own.map((s) => (s.reservationId === 'B' ? { ...s, plan: { ...s.plan!, hasNotes: true } } : s));
    const notedTap = gridFor(ME, noted).rows.find((r) => r.propertyId === '21_horton')!.cells.find((c) => c.date === '2026-10-20')!.tap;
    assert.equal(notedTap.kind === 'release' && notedTap.keep, true, 'a note keeps the plan');
    assert.equal(mark.needs, false, 'a planned walk is covered');
    assert.equal(cell(ME, '21_horton', '2026-10-19').tap.kind, 'move');
    assert.equal(cell(ME, '21_horton', '2026-10-21').tap.kind, 'move');
    assert.equal(gridFor(ME).mine, 1);
  });
  test("someone else's plan asks before it changes hands", () => {
    const sameDay = cell(DOTTI, '21_horton', '2026-10-20');
    assert.equal(sameDay.tap.kind, 'take');
    if (sameDay.tap.kind === 'take') {
      assert.equal(sameDay.tap.holder, ME);
      assert.equal(sameDay.tap.holderDay, '2026-10-20');
      assert.equal(sameDay.tap.planId, 'p1');
    }
    assert.equal(cell(DOTTI, '21_horton', '2026-10-19').tap.kind, 'take');
    assert.equal(cell(DOTTI, '21_horton', '2026-10-20').badges[0].mine, false);
    assert.equal(gridFor(DOTTI).mine, 2, 'her two walks are the late ones at 19 Rackliffe and 16 Waterman');
  });
  test('after the last checkout with nobody arriving there is nothing to tap', () => {
    const c = cell(ME, '21_horton', '2026-10-24');
    assert.equal(c.leaving, true);
    assert.equal(c.tap.kind, 'none');
    assert.equal(c.needs, false);
  });
  test('a Field packet covers the walk: the contractor marks the visit day, nothing is tappable', () => {
    const c = cell(ME, '20_enon', '2026-10-18');
    assert.deepEqual(c.badges.map((b) => [b.kind, b.initials]), [['field', 'JL']]);
    assert.equal(c.tap.kind, 'none');
    assert.equal(c.needs, false);
  });
  test('a walked house marks the day it was walked and asks nothing more; its packet is history', () => {
    const c = cell(ME, '30_woodward', '2026-10-18');
    assert.deepEqual(c.badges.map((b) => [b.kind, b.initials]), [['walked', 'DM']], 'one mark, not the packet beside the walk');
    assert.equal(c.tap.kind, 'none');
    assert.equal(cell(ME, '30_woodward', '2026-10-19').needs, false);
  });
  test('a walk made under a Field address is still mine, in my initials', () => {
    const stays = STAYS.map((s) => (s.reservationId === 'E' ? { ...s, walkedBy: ME_FIELD } : s));
    const row = gridFor(ME, stays).rows.find((r) => r.propertyId === '30_woodward')!;
    const c = row.cells.find((x) => x.date === '2026-10-18')!;
    assert.deepEqual(c.badges.map((b) => [b.kind, b.initials, b.mine]), [['walked', 'DJ', true]]);
  });
  test('green is the prep window: the arrival day and the three before it', () => {
    assert.equal(PREP_DAYS, 3);
    for (const d of ['2026-10-18', '2026-10-22', '2026-10-26']) {
      const c = cell(ME, '7_sumac', d);
      assert.equal(c.tap.kind, 'claim', `${d} can still be tapped`);
      assert.equal(c.needs, false, `${d} is too early to ask for`);
    }
    for (const d of ['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']) {
      assert.equal(cell(ME, '7_sumac', d).needs, true, d);
    }
  });
  test('a planned day that passed carries its mark to today, late, and the day needs someone again', () => {
    const c = cell(ME, '19_rackliffe', TODAY);
    assert.deepEqual(c.badges.map((b) => [b.kind, b.initials, b.late]), [['plan', 'DM', true]]);
    assert.equal(c.needs, true);
    assert.equal(c.tap.kind, 'take');
    const hers = cell(DOTTI, '19_rackliffe', TODAY);
    assert.equal(hers.tap.kind, 'release', 'the holder lets a late plan go from today');
    const row = gridFor(ME).rows.find((r) => r.propertyId === '19_rackliffe')!;
    assert.equal(row.nextNeed, '2026-10-20', 'the deadline chip counts a slipped plan');
  });
  test('a plan with nobody named is a dashed question mark on a day that still needs someone; a tap takes it', () => {
    const c = cell(ME, '3_locust', '2026-10-21');
    assert.deepEqual(c.badges.map((b) => [b.kind, b.initials]), [['unassigned', '?']]);
    assert.equal(c.needs, true, 'nobody named = still needs someone');
    assert.equal(c.tap.kind, 'claim');
    assert.equal(cell(ME, '3_locust', '2026-10-20').tap.kind, 'claim');
  });
  test('a late mark carried onto a day whose own arrival is walked still answers the tap', () => {
    const c = cell(DOTTI, '16_waterman', TODAY);
    assert.deepEqual(c.badges.map((b) => [b.kind, b.initials, b.late]), [['walked', 'DJ', false], ['plan', 'DM', true]], 'today\'s own walk first, then the carried mark');
    assert.equal(c.tap.kind, 'release', 'the holder lets her late plan go from today');
    if (c.tap.kind === 'release') assert.equal(c.tap.keep, true, 'it carries a note, so the plan stays, nobody named');
    const other = cell(ME, '16_waterman', TODAY);
    assert.equal(other.tap.kind, 'take');
    if (other.tap.kind === 'take') assert.equal(other.tap.holderDay, '2026-10-16');
  });
  test('a packet out to the Field roster with no taker: the day asks, but a tap would walk it twice', () => {
    const c = cell(ME, '36_granite', '2026-10-19');
    assert.equal(c.fieldOpen, true);
    assert.equal(c.needs, true);
    assert.equal(c.tap.kind, 'none');
    assert.deepEqual(c.badges.map((b) => [b.kind, b.initials]), [['field', 'F']]);
    assert.equal(cell(ME, '36_granite', '2026-10-18').needs, true);
  });
});

describe('which homes are on the grid, and in what order', () => {
  test('every home is on the grid, the ones with nothing coming last (Dotti, 2026-10-31)', () => {
    const rows = gridFor(ME).rows;
    const ids = rows.map((r) => r.propertyId);
    assert.equal(ids.length, HOMES.length, 'the whole fleet is accounted for');
    assert.deepEqual(ids.slice(-3), ['17_beach', '73_rocky_neck', '84_thatcher'], 'vacant, a checkout with nobody behind it, one guest all window: last, by name');
    assert.equal(cell(ME, '4_middle', '2026-10-31').needs, true, 'an arrival just past the window still asks for its prep days');
    const quiet = rows.find((r) => r.propertyId === '73_rocky_neck')!;
    assert.ok(quiet.cells.every((c) => !c.needs && c.tap.kind === 'none'), 'a quiet home asks for nothing and takes no tap');
    assert.equal(quiet.nextNeed, null);
    assert.deepEqual(rows.filter((r) => r.quiet).map((r) => r.propertyId), ['47_atlantic', '17_beach', '73_rocky_neck', '84_thatcher'], 'quiet = nothing in the window: an arrival ten days past it with no prep day in view is quiet too, and sorts first among the quiet');
    assert.equal(rows.findIndex((r) => r.quiet), rows.length - 4, 'and every quiet row is below every working one');
    assert.equal(rows.find((r) => r.propertyId === '4_middle')!.quiet, false, 'an arrival two days past the window asks for its prep days, so it is working');
    assert.ok(rows.every((r) => r.unitOf === null && r.foldedUnits.length === 0), 'no split homes here: plain rows');
  });
  test('rows run in the order the week happens: next arrival first', () => {
    const ids = gridFor(ME).rows.map((r) => r.propertyId);
    assert.deepEqual(ids, ['16_waterman', '20_enon', '30_woodward', '19_rackliffe', '3_south', '36_granite', '21_horton', '3_locust', '7_sumac', '4_middle', '47_atlantic', '17_beach', '73_rocky_neck', '84_thatcher']);
  });
  test('a quiet home never sits above a working one, whatever its next arrival (one divider)', () => {
    // 225 Washington's guest leaves tomorrow and the next arrives in three
    // weeks: the page sends that stay, the window has nothing in it. It
    // goes under the divider, ahead of homes with no arrival at all.
    const homes = [
      ...HOMES,
      home('225_washington', '225 Washington', [{ id: 'W1', in: '2026-10-15', out: '2026-10-19' }, { id: 'W2', in: '2026-11-08', out: '2026-11-12' }]),
    ];
    const stays = [...STAYS, stay({ reservationId: 'W2', propertyId: '225_washington', checkIn: '2026-11-08', checkOut: '2026-11-12' })];
    const rows = composeVisitGrid({ today: TODAY, days: DAYS, homes, stays, myEmail: ME, nameFor, initialsFor }).rows;
    assert.deepEqual(rows.filter((r) => r.quiet).map((r) => r.propertyId), ['225_washington', '47_atlantic', '17_beach', '73_rocky_neck', '84_thatcher']);
    assert.equal(rows.findIndex((r) => r.quiet), rows.length - 5);
  });
});

describe('words and days', () => {
  test('gridDays runs today forward', () => {
    assert.equal(DAYS.length, 14);
    assert.equal(DAYS[0], TODAY);
    assert.equal(DAYS[13], '2026-10-31');
  });
  test('deadlineChip speaks only inside two days', () => {
    assert.equal(deadlineChip('2026-10-18', TODAY), 'today');
    assert.equal(deadlineChip('2026-10-19', TODAY), '1d');
    assert.equal(deadlineChip('2026-10-21', TODAY), null);
    assert.equal(deadlineChip(null, TODAY), null);
  });
  test('initials and Eastern days', () => {
    assert.equal(initialsOfName('James Liddell'), 'JL');
    assert.equal(initialsOfName('Rosa'), 'R');
    assert.equal(initialsOfName(null), null);
    assert.equal(etDay('2026-10-19T02:30:00Z'), '2026-10-18', '10:30 PM Eastern is still Sunday');
    assert.equal(etDay(null), null);
  });
});

describe('from the page\'s facts', () => {
  const base: Turnover = {
    reservationId: 'B',
    propertyId: '21_horton',
    propertyName: '21 Horton',
    propertyTitle: null,
    guestName: 'Arriving Guest',
    channel: 'airbnb',
    checkIn: '2026-10-21',
    checkOut: '2026-10-24',
    nights: 3,
    status: 'confirmed',
    isSameDayTurnover: false,
    previousCheckout: '2026-10-19',
    previousGuestName: null,
    previousStayCheckIn: null,
    checkInTime: '16:00',
    inspection: null,
    inspectionStatus: 'not_started',
    inspectionInProgress: false,
    inspectionStartedAt: null,
    inspectionViaLock: false,
    plan: { id: 'p1', planned_for_date: '2026-10-20', notes: null, planned_by_email: DOTTI, assigned_to_email: ME },
    cleaning: null,
    cleaningSession: null,
    openWorkSlipsCount: 0,
    prepSlips: [],
    lockBattery: null,
    lockMonitored: false,
    manuallyCompleted: false,
    completedAt: null,
    completedByEmail: null,
  };
  test('a turnover becomes a grid stay with its plan, walk and packet', () => {
    const s = toGridStay({ ...base, fieldPacket: { packetId: 'pk', status: 'claimed', contractorName: 'James Liddell', visitDate: '2026-10-20' } });
    assert.equal(s.plan?.assignee, ME);
    assert.equal(s.plan?.hasNotes, false);
    assert.equal(s.channel, 'airbnb', 'the channel comes along for the dot');
    assert.equal(toGridStay({ ...base, plan: { ...base.plan!, notes: 'key under the mat' } }).plan?.hasNotes, true);
    assert.equal(s.walk, 'open');
    assert.deepEqual(s.field, { status: 'claimed', contractor: 'James Liddell', visitDate: '2026-10-20' });
    const draft = toGridStay({ ...base, fieldPacket: { packetId: 'pk', status: 'draft', contractorName: null } });
    assert.equal(draft.field, null, 'a draft packet is nobody\'s yet');
  });
  test('a finished walk carries its Eastern day and the walker', () => {
    const s = toGridStay({
      ...base,
      inspectionStatus: 'complete',
      inspection: { id: 'i1', property_id: '21_horton', started_at: '2026-10-18T14:00:00Z', completed_at: '2026-10-18T15:00:00Z', inspector_email: ME },
    });
    assert.equal(s.walk, 'done');
    assert.equal(s.walkedOn, '2026-10-18');
    assert.equal(s.walkedBy, ME);
    const ready = toGridStay({ ...base, manuallyCompleted: true, completedAt: '2026-10-19T01:00:00Z', completedByEmail: DOTTI });
    assert.equal(ready.walkedOn, '2026-10-18', 'marked ready at 9 PM Eastern is Sunday');
    assert.equal(ready.walkedBy, DOTTI);
  });
});

describe('one record behind every tap', () => {
  const actions = readFileSync(new URL('../../app/turnovers/plan-actions.ts', import.meta.url), 'utf8');
  const grid = readFileSync(new URL('../../app/turnovers/VisitGrid.tsx', import.meta.url), 'utf8');
  test('the grid writes only through plan-actions, which writes only inspection_plans', () => {
    assert.match(grid, /import \{ claimWalk, releaseWalk \} from '\.\/plan-actions'/);
    assert.ok(!/supabase|\.from\(/.test(grid), 'the component never reaches the database itself');
    assert.match(actions, /export async function claimWalk/);
    assert.match(actions, /export async function releaseWalk/);
    const tables = [...actions.matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(tables)], ['inspection_plans']);
  });
  test('a release keeps a plan that is not the tapper\'s own note-less tap; Remove deletes', () => {
    const release = actions.slice(actions.indexOf('export async function releaseWalk'));
    assert.match(release, /const keep = !opts\.remove && !\(mine && !plan\.notes\?\.trim\(\)\)/);
    assert.match(release, /update\(\{ assigned_to_email: null \}\)/);
    assert.match(release, /if \(readErr\) return \{ ok: false/);
  });
  test('a claim keeps the note and the first planner, and names the tapper as the walker unless the dispatcher names a teammate', () => {
    const claim = actions.slice(actions.indexOf('export async function claimWalk'), actions.indexOf('export async function releaseWalk'));
    assert.match(claim, /notes: prior\?\.notes \?\? null/);
    assert.match(claim, /planned_by_email: prior\?\.planned_by_email \|\| email/);
    assert.match(claim, /let assignee = email;/, 'the tapper by default');
    assert.match(claim, /assigned_to_email: assignee/);
    assert.match(claim, /if \(!\(await sessionDispatches\(\)\)\) return \{ ok: false, error: WALK_FOR_OTHERS \};/, 'a teammate only by the dispatcher');
    assert.match(claim, /if \(readErr\) return \{ ok: false/, 'a failed read never becomes a blank write');
  });
});

describe('the renderer draws what the model says', () => {
  const grid = readFileSync(new URL('../../app/turnovers/VisitGrid.tsx', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../../app/turnovers/page.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8');
  test('the page hands the grid the one unit map the properties list reads', () => {
    assert.match(page, /import \{ loadUnitParents \} from '@\/lib\/unit-homes-server'/);
    assert.match(page, /parentOf=\{Object\.fromEntries\(unitParents\)\}/);
    const props = readFileSync(new URL('../../app/properties/page.tsx', import.meta.url), 'utf8');
    assert.match(props, /loadUnitParents\(\)/, 'the properties list reads the same loader');
    assert.ok(!/from\('listing_links'\)/.test(props), 'and no longer its own copy');
  });
  test('the divider sits before the first quiet row, a unit row is marked, a folded count is a chip', () => {
    assert.match(grid, /const divider = row\.quiet && i > 0 && !grid\.rows\[i - 1\]\.quiet;/);
    assert.match(grid, /No arrivals in the next two weeks/);
    assert.match(grid, /data-unit=\{unit \|\| undefined\}/);
    assert.match(grid, /className="rt-vg-units"/);
    assert.match(css, /\.rt-vg-name\[data-unit\]/);
    assert.match(css, /\.rt-vg-divider \{\n  grid-column: 1 \/ -1;/);
  });
  test('a long hold is a whisper: the bar carries data-long and the stylesheet fades it', () => {
    assert.match(grid, /data-long=\{cell\.hold === 'long' \|\| undefined\}/, 'the full-day bar');
    assert.match(grid, /data-long=\{\(cell\.pm === 'block' && cell\.hold === 'long'\) \|\| undefined\}/, 'the half-day bar');
    assert.match(css, /\.rt-vg-bar\[data-block\]\[data-long\] \{\n  background: repeating-linear-gradient\(45deg, rgba\(30, 46, 52, 0\.07\)/);
  });
});
