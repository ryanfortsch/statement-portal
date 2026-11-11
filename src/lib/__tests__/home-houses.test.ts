import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropCarryOnStays } from '../home-houses.ts';

test('the same guest out and back in at one house today prints neither row', () => {
  const out = [{ propertyId: 'rn', guestName: 'Sam Example' }, { propertyId: 'h', guestName: 'Alex Example' }];
  const inn = [{ propertyId: 'rn', guestName: 'sam example ' }, { propertyId: 'e', guestName: 'Pat Example' }];
  const r = dropCarryOnStays(out, inn);
  assert.deepEqual(r.out.map((s) => s.propertyId), ['h']);
  assert.deepEqual(r.in.map((s) => s.propertyId), ['e']);
});

test('a different guest, another house, or no name keeps both rows', () => {
  const out = [{ propertyId: 'rn', guestName: 'Sam Example' }, { propertyId: 'x', guestName: null }, { propertyId: 'y', guestName: 'Lee Example' }];
  const inn = [{ propertyId: 'rn', guestName: 'Jo Example' }, { propertyId: 'x', guestName: null }, { propertyId: 'z', guestName: 'Lee Example' }];
  const r = dropCarryOnStays(out, inn);
  assert.equal(r.out.length, 3);
  assert.equal(r.in.length, 3);
});

import { todayExtras } from '../home-houses.ts';

const stay = (propertyId: string, guestName: string | null = null) => ({ propertyId, propertyName: propertyId.toUpperCase(), guestName });

test('the strip prints a checkout once: a route home adds nothing, an off-route one says why', () => {
  const r = todayExtras({
    routeHomes: new Set(['a']),
    skippedHomes: new Set(['b']),
    sameDayHomes: new Set(),
    checkouts: [stay('a', 'Ann'), stay('b', 'Bo'), stay('c', 'Cy')],
    checkins: [],
    walks: [],
  });
  assert.deepEqual(r.rows.map((x) => [x.kind, x.propertyId, x.kind === 'out' ? x.reason : null]), [
    ['out', 'b', 'no_cleaning'],
    ['out', 'c', 'other_cleaner'],
  ]);
});

test('arrivals print unless the route already says same day; a carry-on stay prints nothing', () => {
  const r = todayExtras({
    routeHomes: new Set(['a']),
    skippedHomes: new Set(),
    sameDayHomes: new Set(['a']),
    checkouts: [stay('a', 'Ann'), stay('k', 'Kim')],
    checkins: [stay('a', 'Ned'), stay('d', 'Dee'), stay('k', 'kim')],
    walks: [],
  });
  assert.deepEqual(r.rows.map((x) => `${x.kind}:${x.propertyId}`), ['in:d']);
});

test('a home walked with no stay today gets a row; any walked home gets the tick', () => {
  const r = todayExtras({
    routeHomes: new Set(['a']),
    skippedHomes: new Set(),
    sameDayHomes: new Set(),
    checkouts: [stay('a', 'Ann')],
    checkins: [],
    walks: [{ id: 'w1', propertyId: 'a', propertyName: 'A' }, { id: 'w2', propertyId: 'z', propertyName: 'Z' }],
  });
  assert.deepEqual(r.rows.map((x) => `${x.kind}:${x.propertyId}`), ['walked:z']);
  assert.ok(r.walked.has('a') && r.walked.has('z'));
});
