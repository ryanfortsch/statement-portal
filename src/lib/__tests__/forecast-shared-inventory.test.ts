/**
 * A unit of a home already in the forecast never takes the portfolio
 * average on top of the whole house (17 Beach, split 2026-09-28).
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { annualBasisFor, paceAnnualFor, sharedInventoryMap } from '../forecast-shared-inventory.ts';

const LINKS = [
  { group_key: '17_beach', role: 'whole', property_id: '17_beach_rd', active: true },
  { group_key: '17_beach', role: 'unit', property_id: '17_beach_front', active: true },
  { group_key: '17_beach', role: 'unit', property_id: '17_beach_back', active: true },
];

describe('sharedInventoryMap', () => {
  test('both 17 Beach units point at the whole house', () => {
    const m = sharedInventoryMap(LINKS, new Set(['17_beach_rd', '17_beach_front', '17_beach_back', '21_horton']));
    assert.equal(m.get('17_beach_front'), '17_beach_rd');
    assert.equal(m.get('17_beach_back'), '17_beach_rd');
    assert.equal(m.has('17_beach_rd'), false, 'the whole house is nobody\'s unit');
    assert.equal(m.has('21_horton'), false);
  });

  test('a unit whose whole house has left the fleet is a home of its own', () => {
    const m = sharedInventoryMap(LINKS, new Set(['17_beach_front', '17_beach_back']));
    assert.equal(m.size, 0);
  });

  test('inactive links and units not in the fleet are ignored', () => {
    const m = sharedInventoryMap(
      [...LINKS, { group_key: '17_beach', role: 'unit', property_id: '17_beach_attic', active: false }],
      new Set(['17_beach_rd', '17_beach_front', '17_beach_attic']),
    );
    assert.equal(m.get('17_beach_front'), '17_beach_rd');
    assert.equal(m.has('17_beach_attic'), false, 'inactive link');
    assert.equal(m.has('17_beach_back'), false, 'not an active home');
  });
});

describe('the annual gross a unit projects from', () => {
  test('its own pace when it has bookings, nothing when it has none', () => {
    assert.equal(paceAnnualFor(52000, 118000, true), 52000);
    assert.equal(paceAnnualFor(0, 118000, true), 0);
    assert.equal(paceAnnualFor(0, 118000, false), 118000, 'an independent new home still takes the portfolio average');
  });

  test('the basis names it', () => {
    assert.equal(annualBasisFor({ floorAnnual: 0, paceAnnual: 0, ownAnnual: 0, sharesInventory: true }), 'unit');
    assert.equal(annualBasisFor({ floorAnnual: 0, paceAnnual: 118000, ownAnnual: 0, sharesInventory: false }), 'portfolio');
    assert.equal(annualBasisFor({ floorAnnual: 0, paceAnnual: 52000, ownAnnual: 52000, sharesInventory: true }), 'pacing');
    assert.equal(annualBasisFor({ floorAnnual: 90000, paceAnnual: 52000, ownAnnual: 52000, sharesInventory: true }), 'statements', 'a unit with closed statements floors like any home');
  });
});
