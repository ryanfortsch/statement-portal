import test from 'node:test';
import assert from 'node:assert/strict';
import { holdOccupiesDay, ownerHoldOccupiesDay, type HoldDay, type HoldDayRow } from '../field-stale-hold.ts';

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

// ── ownerHoldOccupiesDay: whose hold it is decides before the day rule ──

const row = (
  block_type: string | null,
  block_reason: string | null,
  block_note: string | null,
  block_start: string | null,
  block_ref_id: string | null = 'ref-a',
): HoldDayRow => ({ block_type, block_reason, block_note, block_start, block_ref_id });

test('an office-entered owner stay is type m with reason "Owner block": occupied when it began earlier (21 Horton 2026-10-08)', () => {
  assert.equal(ownerHoldOccupiesDay('2026-10-04', row('m', 'Owner block', 'Owner use', '2026-10-01'), null), true);
  // The note alone can say so too.
  assert.equal(ownerHoldOccupiesDay('2026-10-04', row('m', null, 'owner lock', '2026-10-01'), null), true);
  // And a portal-made block still counts with no reason or note at all.
  assert.equal(ownerHoldOccupiesDay('2026-10-04', row('o', null, null, '2026-10-01'), null), true);
});

test('an owner stay that begins on the visit day is still an arrival, whichever way it was filed', () => {
  assert.equal(ownerHoldOccupiesDay('2026-10-04', row('m', 'Owner block', 'Owner use', '2026-10-04'), null), false);
  assert.equal(ownerHoldOccupiesDay('2026-10-04', row('o', null, null, '2026-10-04'), null), false);
});

test('an office or manual hold that is NOT the owner reports nothing (19 Rackliffe onboarding, 2026-09-07)', () => {
  assert.equal(ownerHoldOccupiesDay('2026-10-04', row('m', 'Onboarding', null, '2026-10-01'), null), false);
  assert.equal(ownerHoldOccupiesDay('2026-10-04', row('m', 'Maintenance', 'Electrician', '2026-10-01'), null), false);
  assert.equal(ownerHoldOccupiesDay('2026-10-04', row('m', null, null, '2026-10-01'), null), false);
  // A Guesty rule artifact never counts even if it says "owner".
  assert.equal(ownerHoldOccupiesDay('2026-10-04', row('mr', 'Owner block', null, '2026-10-01'), null), false);
});

test('the night-before fallback only sees owner rows', () => {
  // Same owner hold both nights, no start date on the row: mid-stay.
  assert.equal(
    ownerHoldOccupiesDay('2026-10-04', row('m', 'Owner block', null, null, 'ref-a'), row('m', 'Owner block', null, null, 'ref-a')),
    true,
  );
  // The night before was a maintenance hold: as if nothing was there, so arrival.
  assert.equal(
    ownerHoldOccupiesDay('2026-10-04', row('m', 'Owner block', null, null, 'ref-a'), row('m', 'Maintenance', null, null, 'ref-a')),
    false,
  );
});
