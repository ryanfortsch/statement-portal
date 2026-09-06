/**
 * Retiring guesty_listings rows Guesty no longer returns, timidly.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decideListingRetirement } from '../listing-retirement.ts';

const row = (listing_id: string, property_id = '17_beach_rd', nickname: string | null = null) => ({
  listing_id,
  property_id,
  nickname,
});

// The real table on 2026-09-06: 22 live rows plus the one Guesty dropped in June.
const live = Array.from({ length: 22 }, (_, i) => `live${i}`);
const table = [...live.map((id) => row(id)), row('69694a32b8072e0014c851f1', '17_beach_rd', 'Back Unit - 17 Beach')];

describe('decideListingRetirement', () => {
  test('a complete pull retires the one row Guesty stopped returning', () => {
    const d = decideListingRetirement(table, live, { pullComplete: true });
    assert.equal(d.reason, 'ok');
    assert.deepEqual(d.retire.map((r) => r.listing_id), ['69694a32b8072e0014c851f1']);
    assert.equal(d.held.length, 0);
  });

  test('nothing stale is a quiet no-op', () => {
    const d = decideListingRetirement(live.map((id) => row(id)), live, { pullComplete: true });
    assert.equal(d.reason, 'nothing_stale');
    assert.equal(d.retire.length, 0);
  });

  test('an incomplete pull retires nothing, whatever it looks like', () => {
    const d = decideListingRetirement(table, live, { pullComplete: false });
    assert.equal(d.reason, 'incomplete_pull');
    assert.equal(d.retire.length, 0);
    assert.equal(d.held.length, 1);
  });

  test('a pull that returns almost nothing is not the fleet and retires nothing', () => {
    const d = decideListingRetirement(table, ['live0', 'live1'], { pullComplete: true });
    assert.equal(d.reason, 'implausible_fleet');
    assert.equal(d.retire.length, 0);
    assert.equal(d.held.length, 21);
  });

  test('more than a quarter of the table stale is held for a human, not deleted', () => {
    const d = decideListingRetirement(table, live.slice(0, 14), { pullComplete: true });
    assert.equal(d.reason, 'too_many_stale');
    assert.equal(d.retire.length, 0);
    assert.equal(d.held.length, 9);
  });

  test('the cap is at least three rows even for a small table', () => {
    const small = [row('a'), row('b'), row('c'), row('d'), row('e'), row('f'), row('g'), row('h')];
    const d = decideListingRetirement(small, ['a', 'b', 'c', 'd', 'e'], { pullComplete: true });
    assert.equal(d.reason, 'ok');
    assert.deepEqual(d.retire.map((r) => r.listing_id), ['f', 'g', 'h']);
  });
});
