import test from 'node:test';
import assert from 'node:assert/strict';
import { holdOccupiesDay, type HoldDay } from '../field-stale-hold.ts';

const hold = (block_start: string | null, block_ref_id: string | null = 'ref-a', block_type = 'o'): HoldDay => ({
  block_type,
  block_start,
  block_ref_id,
});

test('no hold on the day: not occupied', () => {
  assert.equal(holdOccupiesDay('2026-09-08', null, null), false);
  assert.equal(holdOccupiesDay('2026-09-08', { block_type: null, block_start: null, block_ref_id: null }, null), false);
});

test('owner stay that BEGINS on the visit day is an arrival, not an occupied house (53 Rocky Neck 2026-09-08)', () => {
  assert.equal(holdOccupiesDay('2026-09-08', hold('2026-09-08'), null), false);
});

test('owner stay that began on the visit day, even when it runs on for more nights (19 Rackliffe 2026-09-07)', () => {
  assert.equal(holdOccupiesDay('2026-09-07', hold('2026-09-07'), null), false);
});

test('a hold that began earlier and still covers the day: occupied', () => {
  assert.equal(holdOccupiesDay('2026-09-08', hold('2026-09-07'), hold('2026-09-07')), true);
  assert.equal(holdOccupiesDay('2026-09-08', hold('2026-09-01', 'ref-m', 'm'), null), true);
});

test('row without a start date falls back to the night before', () => {
  // Same hold both nights: mid-hold.
  assert.equal(holdOccupiesDay('2026-09-08', hold(null, 'ref-a'), hold(null, 'ref-a')), true);
  // A different hold the night before means this one starts today: arrival.
  assert.equal(holdOccupiesDay('2026-09-08', hold(null, 'ref-b'), hold(null, 'ref-a')), false);
  // Nothing the night before: arrival.
  assert.equal(holdOccupiesDay('2026-09-08', hold(null, 'ref-a'), null), false);
  // Neither row can say which hold: assume it carried over.
  assert.equal(holdOccupiesDay('2026-09-08', hold(null, null), hold(null, null)), true);
});
