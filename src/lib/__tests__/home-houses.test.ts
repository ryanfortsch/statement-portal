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
