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
  type GridHome,
  type GridStay,
  type GridCell,
} from '../visit-grid.ts';
import type { Turnover } from '../operations.ts';

const TODAY = '2026-10-18';
const DAYS = gridDays(TODAY, GRID_DAYS);
const ME = 'delaney@risingtidestr.com';
const DOTTI = 'dotti@risingtidestr.com';
const NAMES: Record<string, string> = { [ME]: 'Delaney', [DOTTI]: 'Dotti' };
const INITIALS: Record<string, string> = { [ME]: 'DJ', [DOTTI]: 'DM' };
const nameFor = (e: string) => NAMES[e] ?? e;
const initialsFor = (e: string) => INITIALS[e] ?? '??';

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
  home('17_beach', '17 Beach', []),
  home('84_thatcher', '84 Thatcher', [{ id: 'long', in: '2026-10-10', out: '2026-11-05' }]),
  home('73_rocky_neck', '73 Rocky Neck', [{ id: 'H', in: '2026-10-15', out: '2026-10-19' }]),
];

const STAYS: GridStay[] = [
  stay({ reservationId: 'B', propertyId: '21_horton', checkIn: '2026-10-21', checkOut: '2026-10-24', plan: { id: 'p1', date: '2026-10-20', assignee: ME, plannedBy: DOTTI } }),
  stay({ reservationId: 'C', propertyId: '3_south', checkIn: '2026-10-20', checkOut: '2026-10-23' }),
  stay({ reservationId: 'D', propertyId: '20_enon', checkIn: '2026-10-19', checkOut: '2026-10-22', field: { status: 'claimed', contractor: 'James Liddell', visitDate: '2026-10-18' } }),
  stay({ reservationId: 'E', propertyId: '30_woodward', checkIn: '2026-10-19', checkOut: '2026-10-25', walk: 'done', walkedOn: '2026-10-18', walkedBy: DOTTI }),
  stay({ reservationId: 'F', propertyId: '19_rackliffe', checkIn: '2026-10-20', checkOut: '2026-10-27', plan: { id: 'p2', date: '2026-10-16', assignee: DOTTI, plannedBy: DOTTI } }),
  stay({ reservationId: 'G', propertyId: '3_locust', checkIn: '2026-10-22', checkOut: '2026-10-25', plan: { id: 'p3', date: '2026-10-21', assignee: null, plannedBy: DOTTI } }),
];

function gridFor(myEmail: string) {
  return composeVisitGrid({ today: TODAY, days: DAYS, homes: HOMES, stays: STAYS, myEmail, nameFor, initialsFor });
}
function cell(myEmail: string, pid: string, date: string): GridCell {
  const row = gridFor(myEmail).rows.find((r) => r.propertyId === pid);
  assert.ok(row, `${pid} is on the grid`);
  const c = row.cells.find((x) => x.date === date);
  assert.ok(c, `${pid} has ${date}`);
  return c;
}

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
    assert.equal(gridFor(DOTTI).mine, 1, 'her one walk is the late one at 19 Rackliffe');
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
  test('a walked house marks the day it was walked and asks nothing more', () => {
    const c = cell(ME, '30_woodward', '2026-10-18');
    assert.deepEqual(c.badges.map((b) => [b.kind, b.initials]), [['walked', 'DM']]);
    assert.equal(c.tap.kind, 'none');
    assert.equal(cell(ME, '30_woodward', '2026-10-19').needs, false);
  });
  test('a planned day that passed carries its mark to today, late, and the day needs someone again', () => {
    const c = cell(ME, '19_rackliffe', TODAY);
    assert.deepEqual(c.badges.map((b) => [b.kind, b.initials, b.late]), [['plan', 'DM', true]]);
    assert.equal(c.needs, true);
    assert.equal(c.tap.kind, 'take');
    const hers = cell(DOTTI, '19_rackliffe', TODAY);
    assert.equal(hers.tap.kind, 'release', 'the holder lets a late plan go from today');
  });
  test('a plan with nobody named is a dashed question mark, and a tap takes it without asking', () => {
    const c = cell(ME, '3_locust', '2026-10-21');
    assert.deepEqual(c.badges.map((b) => [b.kind, b.initials]), [['unassigned', '?']]);
    assert.equal(c.tap.kind, 'claim');
    assert.equal(cell(ME, '3_locust', '2026-10-20').tap.kind, 'claim');
  });
});

describe('which homes are on the grid, and in what order', () => {
  test('a home with nothing happening in the window is left out', () => {
    const ids = gridFor(ME).rows.map((r) => r.propertyId);
    assert.ok(!ids.includes('17_beach'), 'vacant all window');
    assert.ok(!ids.includes('84_thatcher'), 'one guest all window');
    assert.ok(ids.includes('73_rocky_neck'), 'a checkout with nobody behind it still turns');
  });
  test('rows run in the order the week happens: next arrival first, a home with none last', () => {
    const ids = gridFor(ME).rows.map((r) => r.propertyId);
    assert.deepEqual(ids, ['20_enon', '30_woodward', '19_rackliffe', '3_south', '21_horton', '3_locust', '73_rocky_neck']);
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
  test('a claim keeps the note and the first planner, and names the tapper as the walker', () => {
    const claim = actions.slice(actions.indexOf('export async function claimWalk'), actions.indexOf('export async function releaseWalk'));
    assert.match(claim, /notes: prior\?\.notes \?\? null/);
    assert.match(claim, /planned_by_email: prior\?\.planned_by_email \|\| email/);
    assert.match(claim, /assigned_to_email: email/);
  });
});
