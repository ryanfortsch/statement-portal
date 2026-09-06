/**
 * A checkout that is not a checkout: the same real guest checks back in
 * the same day at the same house. Fixture is the real one: Simon
 * Prudenzi's four one-night rows on 53 Rocky Neck Downstairs,
 * 2026-09-04 to 09-08.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isContinuation, chainStays, guestNameKey, guestNameScore, displayGuestName } from '../stay-continuation.ts';

type Arrival = { propertyId: string; checkIn: string; guestName: string | null };

function arrivalsLookup(arrivals: Arrival[]) {
  const byKey = new Map<string, Arrival>();
  for (const a of arrivals) byKey.set(`${a.propertyId}|${a.checkIn}`, a);
  return (propertyId: string, date: string) => byKey.get(`${propertyId}|${date}`)?.guestName;
}

describe('isContinuation', () => {
  // The chain: 09-04 -> 05, 05 -> 06, 06 -> 07, 07 -> 08. Arrivals are the
  // rows that start on each of those days.
  const prudenzi = arrivalsLookup([
    { propertyId: '53_rocky_neck_2', checkIn: '2026-09-04', guestName: 'Simon Prudenzi' },
    { propertyId: '53_rocky_neck_2', checkIn: '2026-09-05', guestName: 'Simon Prudenzi' },
    { propertyId: '53_rocky_neck_2', checkIn: '2026-09-06', guestName: 'Simon Prudenzi' },
    { propertyId: '53_rocky_neck_2', checkIn: '2026-09-07', guestName: 'Simon Prudenzi' },
    // He moves upstairs the day he leaves downstairs: a different house.
    { propertyId: '53_rocky_neck', checkIn: '2026-09-08', guestName: 'Simon Prudenzi' },
  ]);

  test('the intermediate nights of a nightly-booked stay are not checkouts', () => {
    for (const day of ['2026-09-05', '2026-09-06', '2026-09-07']) {
      assert.equal(
        isContinuation({ propertyId: '53_rocky_neck_2', guestName: 'Simon Prudenzi', effectiveCheckOut: day }, prudenzi),
        true,
        day,
      );
    }
  });

  test('the last night IS a checkout, even though the same guest arrives elsewhere that day', () => {
    assert.equal(
      isContinuation({ propertyId: '53_rocky_neck_2', guestName: 'Simon Prudenzi', effectiveCheckOut: '2026-09-08' }, prudenzi),
      false,
    );
  });

  test('a different real guest arriving that day is a turnover, not a continuation', () => {
    const lookup = arrivalsLookup([{ propertyId: '20_enon', checkIn: '2026-09-06', guestName: 'April Henkel' }]);
    assert.equal(
      isContinuation({ propertyId: '20_enon', guestName: 'Manmeet Singh', effectiveCheckOut: '2026-09-06' }, lookup),
      false,
    );
  });

  test('placeholder names never chain: two "Reservation" rows could be two guests', () => {
    const lookup = arrivalsLookup([{ propertyId: '17_beach_rd', checkIn: '2026-09-08', guestName: 'Reservation' }]);
    assert.equal(
      isContinuation({ propertyId: '17_beach_rd', guestName: 'Reservation', effectiveCheckOut: '2026-09-08' }, lookup),
      false,
    );
    const blank = arrivalsLookup([{ propertyId: '17_beach_rd', checkIn: '2026-09-08', guestName: '' }]);
    assert.equal(isContinuation({ propertyId: '17_beach_rd', guestName: '', effectiveCheckOut: '2026-09-08' }, blank), false);
    assert.equal(isContinuation({ propertyId: '17_beach_rd', guestName: null, effectiveCheckOut: '2026-09-08' }, blank), false);
  });

  test('the match is on the effective checkout day, so an extension moves the question with it', () => {
    const lookup = arrivalsLookup([{ propertyId: '84_thatcher', checkIn: '2026-09-10', guestName: 'Stacey Grillo' }]);
    // Base checkout 09-08, extended to 09-10, and she has a fresh row from 09-10: still her.
    assert.equal(
      isContinuation({ propertyId: '84_thatcher', guestName: 'Stacey Grillo', effectiveCheckOut: '2026-09-10' }, lookup),
      true,
    );
    // Same stay judged on its base day, when nobody arrives: a checkout.
    assert.equal(
      isContinuation({ propertyId: '84_thatcher', guestName: 'Stacey Grillo', effectiveCheckOut: '2026-09-08' }, lookup),
      false,
    );
  });

  test('name matching ignores case and stray whitespace, nothing more', () => {
    const lookup = arrivalsLookup([{ propertyId: '3_south_st', checkIn: '2026-09-07', guestName: '  nadeem ' }]);
    assert.equal(isContinuation({ propertyId: '3_south_st', guestName: 'Nadeem', effectiveCheckOut: '2026-09-07' }, lookup), true);
    assert.equal(isContinuation({ propertyId: '3_south_st', guestName: 'Nadeem K', effectiveCheckOut: '2026-09-07' }, lookup), false);
  });
});

describe('guest name helpers', () => {
  test('score: blank 0, placeholder 1, real 2', () => {
    assert.equal(guestNameScore(null), 0);
    assert.equal(guestNameScore('   '), 0);
    assert.equal(guestNameScore('Reservation'), 1);
    assert.equal(guestNameScore('Blocked - owner'), 1);
    assert.equal(guestNameScore('Airbnb (Not available)'), 1);
    assert.equal(guestNameScore('Linda Nelson'), 2);
  });

  test('display and key blank out placeholders', () => {
    assert.equal(displayGuestName('TBD'), '');
    assert.equal(displayGuestName('  Linda Nelson '), 'Linda Nelson');
    assert.equal(guestNameKey('Hold for owner'), '');
    assert.equal(guestNameKey('Linda   NELSON'), 'linda nelson');
  });
});

describe('chainStays', () => {
  type Row = { id: string; propertyId: string; guestName: string | null; checkIn: string; checkOut: string };
  const read = (r: Row) => r;
  const seg = (id: string, propertyId: string, guestName: string | null, checkIn: string, checkOut: string): Row => ({
    id,
    propertyId,
    guestName,
    checkIn,
    checkOut,
  });

  // The real rows, deliberately out of order.
  const prudenzi = [
    seg('c', '53_rocky_neck_2', 'Simon Prudenzi', '2026-09-06', '2026-09-07'),
    seg('a', '53_rocky_neck_2', 'Simon Prudenzi', '2026-09-04', '2026-09-05'),
    seg('d', '53_rocky_neck_2', 'Simon Prudenzi', '2026-09-07', '2026-09-08'),
    seg('b', '53_rocky_neck_2', 'Simon Prudenzi', '2026-09-05', '2026-09-06'),
    seg('up', '53_rocky_neck', 'Simon Prudenzi', '2026-09-08', '2026-09-09'),
  ];

  test('four nightly rows become one stay with the last checkout; the move upstairs stays separate', () => {
    const chains = chainStays(prudenzi, read);
    const stays = chains.map((c) => `${prudenzi[c.index].id}:${prudenzi[c.index].checkIn}->${c.checkOut} (+${c.merged.length})`);
    assert.deepEqual(stays, ['up:2026-09-08->2026-09-09 (+0)', 'a:2026-09-04->2026-09-08 (+3)']);
    const head = chains.find((c) => prudenzi[c.index].id === 'a')!;
    assert.deepEqual(head.merged.map((j) => prudenzi[j].id).sort(), ['b', 'c', 'd']);
  });

  test('a different real guest arriving on the checkout day is a turnover, not a chain', () => {
    const rows = [
      seg('x', '20_enon', 'Manmeet Singh', '2026-09-04', '2026-09-06'),
      seg('y', '20_enon', 'April Henkel', '2026-09-06', '2026-09-10'),
    ];
    const chains = chainStays(rows, read);
    assert.equal(chains.length, 2);
    assert.ok(chains.every((c) => c.merged.length === 0));
  });

  test('a gap night breaks the chain even for the same guest', () => {
    const rows = [
      seg('x', '3_south_st', 'Nadeem', '2026-09-05', '2026-09-06'),
      seg('y', '3_south_st', 'Nadeem', '2026-09-07', '2026-09-08'),
    ];
    assert.equal(chainStays(rows, read).length, 2);
  });

  test('placeholders never chain', () => {
    const rows = [
      seg('x', '17_beach_rd', 'Reservation', '2026-09-05', '2026-09-06'),
      seg('y', '17_beach_rd', 'Reservation', '2026-09-06', '2026-09-07'),
      seg('z', '17_beach_rd', null, '2026-09-07', '2026-09-08'),
    ];
    assert.equal(chainStays(rows, read).length, 3);
  });

  test('a placeholder twin inside a merged span is absorbed; a different real name overlapping is left visible', () => {
    const rows = [
      seg('a', '53_rocky_neck_2', 'Simon Prudenzi', '2026-09-04', '2026-09-05'),
      seg('b', '53_rocky_neck_2', 'Simon Prudenzi', '2026-09-05', '2026-09-06'),
      seg('twin', '53_rocky_neck_2', 'Reservation 9KX2M', '2026-09-05', '2026-09-06'),
      seg('odd', '53_rocky_neck_2', 'Someone Else', '2026-09-05', '2026-09-06'),
    ];
    const chains = chainStays(rows, read);
    const head = chains.find((c) => rows[c.index].id === 'a')!;
    assert.equal(head.checkOut, '2026-09-06');
    assert.deepEqual(head.merged.map((j) => rows[j].id).sort(), ['b', 'twin']);
    assert.ok(chains.some((c) => rows[c.index].id === 'odd'));
  });

  test('a chain never crosses houses', () => {
    const rows = [
      seg('a', '53_rocky_neck_2', 'Simon Prudenzi', '2026-09-07', '2026-09-08'),
      seg('b', '53_rocky_neck', 'Simon Prudenzi', '2026-09-08', '2026-09-09'),
    ];
    assert.equal(chainStays(rows, read).length, 2);
  });
});
