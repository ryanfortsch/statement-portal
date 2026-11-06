/** Cross-language production planner + real Postgres, synthetic loopback only. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { prepareInventory } from '../src/lib/channex-inventory/planner.ts';
if (process.env.PGHOST !== '127.0.0.1' || process.env.PGDATABASE !== 'helm_synthetic_channex') throw Error('Synthetic loopback database required');
const psql = process.env.CHANNEX_TEST_PSQL || 'psql';
function sql(query: string): string {
  const r = spawnSync(psql, ['-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8' });
  if (r.status) throw Error(r.stderr);
  return r.stdout.trim();
}
const literal = (v: unknown) => "'" + JSON.stringify(v).replaceAll("'", "''") + "'::jsonb";
function read() { return JSON.parse(sql('select helm_channex_inventory_read();')); }
function prepare() { return prepareInventory(read(), Date.now()); }
function save({ state, plan }: ReturnType<typeof prepare>) {
  const { captureVersion, configurationVersion, headVersion, inputToken } = state;
  return JSON.parse(sql(`select helm_channex_inventory_plan_commit(${literal({ captureVersion, configurationVersion, headVersion, inputToken })},${literal(plan)});`));
}
assert.equal(sql('select current_database();'), 'helm_synthetic_channex');
sql('select channex_synthetic_inventory_setup();');
const first = prepare(); assert.ok(first.plan); assert.equal(first.state.inputs.plan!.checkin_time, '16:00');
assert.equal(first.plan.days.length, 500);
assert.equal(save(first).status, 'stored');
assert.equal(save(first).status, 'unchanged');
// A new read refreshes the same durable identity; it never duplicates history.
const second = prepare(); assert.equal(second.plan!.id, first.plan.id);
assert.equal(save(second).status, 'refreshed');
assert.equal(sql('select count(*) from helm_airbnb_bookings.inventory_plans;'), '1');
const before = prepare();
sql("select helm_create_booking('65_calderwood','direct','manual','block','2030-01-01','2030-01-03','{\"hold_kind\":\"owner\"}');");
assert.equal(save(before).status, 'superseded');
assert.equal(save(prepare()).status, 'stored');
console.log('PASS: real TypeScript snapshot, 500-day projection, SQL digest/identity agreement, durable retry and stale-plan rejection');
