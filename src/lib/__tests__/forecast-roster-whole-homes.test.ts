/**
 * The cost roster counts whole homes only.
 *
 * Dotti, 2026-11-07, on why January 2027 marketing read $1,910: the count
 * Cooper's line and the supplies rate scale on included the four unit
 * listings (17 Beach's front unit and guest house, 36 Granite's north unit,
 * the Middle Road unit) as four more homes. Both rates were calibrated on
 * whole homes, and a unit sells its whole house's nights. "Whole homes only."
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rosterFromRegistry, type RosterSource } from '../forecast-roster.ts';

const whole = (id: string, name: string): RosterSource => ({
  id, name, isRtOwned: false, activatedAt: null, projectedMgmtFee: 30000,
});
const unit = (id: string, name: string, of: string): RosterSource => ({
  id, name, isRtOwned: false, activatedAt: '2026-09-28', projectedMgmtFee: 0, sharesInventoryWith: of,
});

describe('the cost roster', () => {
  test('drops a unit of a home already on it', () => {
    const r = rosterFromRegistry(
      [
        whole('17_beach_rd', '17 Beach'),
        unit('17_beach_front', 'Front Unit', '17_beach_rd'),
        unit('17_beach_guest', 'Guest House', '17_beach_rd'),
        whole('36_granite', '36 Granite'),
        unit('36_granite_north', 'North Unit', '36_granite'),
      ],
      2027,
      {},
      25000,
    );
    assert.deepEqual(r.map((p) => p.id).sort(), ['17_beach_rd', '36_granite']);
  });

  test('a whole home with the field absent or null still counts', () => {
    const plain = whole('21_horton', '21 Horton');
    const explicit: RosterSource = { ...whole('3_south_st', '3 South'), sharesInventoryWith: null };
    const r = rosterFromRegistry([plain, explicit], 2027, {}, 25000);
    assert.equal(r.length, 2);
  });

  test('the client passes the unit flag through from the smart feed', () => {
    const ui = readFileSync(join(process.cwd(), 'src/app/forecast/ForecastClient.tsx'), 'utf8');
    assert.ok(ui.includes('sharesInventoryWith: p.property.sharesInventoryWith,'), 'buildRoster must hand the unit marker to rosterFromRegistry');
  });
});
