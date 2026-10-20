import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nestUnits, parentOfUnits } from '../unit-homes.ts';

const links = [
  { group_key: '17_beach', role: 'whole', property_id: '17_beach_rd' },
  { group_key: '17_beach', role: 'unit', property_id: '17_beach_front' },
  { group_key: '17_beach', role: 'unit', property_id: '17_beach_back' },
  { group_key: '4_middle', role: 'whole', property_id: '4_middle' },
  { group_key: '4_middle', role: 'unit', property_id: '4_middle_main' },
];

test('units sit under their house, in list order, and leave the top level', () => {
  const homes = ['17_beach_back', '17_beach_front', '17_beach_rd', '20_enon', '4_middle', '4_middle_main'].map((id) => ({ id }));
  const nested = nestUnits(homes, parentOfUnits(links));
  assert.deepEqual(nested.map((n) => [n.home.id, n.units.map((u) => u.id)]), [
    ['17_beach_rd', ['17_beach_back', '17_beach_front']],
    ['20_enon', []],
    ['4_middle', ['4_middle_main']],
  ]);
});

test('a unit whose house is not listed stays a row of its own', () => {
  const nested = nestUnits([{ id: '17_beach_front' }], parentOfUnits(links));
  assert.deepEqual(nested.map((n) => n.home.id), ['17_beach_front']);
});
