/** Real SQL + actual intake/client/store path. Synthetic loopback database only. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { runProductionBookingTick } from '../src/lib/channex-bookings/runtime.ts';
import { intakeEnv, intakeHarness, intakeId, intakeRow } from '../src/lib/__tests__/fixtures/channex-booking-intake.ts';
if (process.env.PGHOST !== '127.0.0.1' || process.env.PGDATABASE !== 'helm_synthetic_channex') throw Error('Synthetic loopback database required');
globalThis.fetch = async () => { throw Error('Real network disabled'); };
const sql = (input: string) => {
  const r = spawnSync(process.env.CHANNEX_TEST_PSQL || 'psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8' });
  if (r.status) throw Error('Synthetic SQL failed: ' + r.stderr);
  return r.stdout.trim();
};
const quote = (value: unknown) => "'" + String(value).replaceAll("'", "''") + "'";
const rpc = async (name: string, args: Record<string, unknown>, signal: AbortSignal) => {
  signal.throwIfAborted();
  let expression: string;
  if (name === 'helm_channex_storage_status') expression = 'public.helm_channex_storage_status()';
  else if (name === 'helm_airbnb_revision_commit') expression = `public.helm_airbnb_revision_commit(${quote(JSON.stringify(args.p_revision))}::jsonb)`;
  else { assert.equal(name, 'helm_airbnb_revision_receipt'); expression = `public.helm_airbnb_revision_receipt(${quote(args.p_id)}::uuid)`; }
  return { data: JSON.parse(sql('set role service_role; select ' + expression + ';')), error: null };
};
// Fixture-only controls; no activation helper is added to production.
sql("update helm_airbnb_bookings.scope set enabled=true; update properties set calendar_authority='helm' where id='65_calderwood'; update helm_inventory_capture_scopes set enabled=true where property_id='65_calderwood';");
const h = intakeHarness();
let loseCommit = true;
const deps = { fetcher: h.fetcher, rpc: async (...args: Parameters<typeof rpc>) => {
  const r = await rpc(...args);
  if (args[0] === 'helm_airbnb_revision_commit' && loseCommit) { loseCommit = false; throw Error('Synthetic lost commit response'); }
  return r;
} };
const before = Number(sql('select count(*) from bookings;'));
const lost = await runProductionBookingTick(intakeEnv, deps);
assert.equal(lost.state, 'incomplete'); assert.equal(lost.partialEffectsPossible, true); assert.equal(h.acked.size, 0);
const receiptBefore = sql(`set role service_role; select helm_airbnb_revision_receipt('${intakeId(1)}');`);
assert.equal((await runProductionBookingTick(intakeEnv, deps)).ok, true);
assert.equal(sql(`set role service_role; select helm_airbnb_revision_receipt('${intakeId(1)}');`), receiptBefore);
assert.equal(Number(sql('select count(*) from bookings;')), before + 1);
const saved = JSON.parse(receiptBefore), canonical = saved.canonicalBookingId;
assert.equal(saved.revision.guestDetails.mail, 'synthetic@example.invalid');
assert.equal(sql(`select guest_email is null from bookings where id='${canonical}';`), 't');

const modification = intakeRow(2, 'modified');
modification.attributes.booking_id = intakeId(101); modification.attributes.ota_reservation_code = 'INTAKESYNTHETIC1';
const cancellation = structuredClone(modification); cancellation.id = intakeId(3);
cancellation.attributes.status = 'cancelled'; cancellation.attributes.inserted_at = '2026-11-13T12:00:00.000003Z';
const lifecycle = intakeHarness([cancellation, modification]);
sql(`insert into automation_sends(booking_id,status) values('${canonical}','scheduled');`);
assert.equal((await runProductionBookingTick(intakeEnv, { ...lifecycle, rpc })).ok, true);
assert.equal(sql(`select status||':'||check_in||':'||check_out from bookings where id='${canonical}';`), 'cancelled:2035-02-05:2035-02-06');
assert.equal(sql(`select status from automation_sends where booking_id='${canonical}';`), 'cancelled');
assert.equal(Number(sql('select count(*) from bookings;')), before + 1);

const stale = intakeRow(4, 'modified'); stale.attributes.booking_id = intakeId(101);
stale.attributes.ota_reservation_code = 'INTAKESYNTHETIC1'; stale.attributes.inserted_at = '2026-11-13T12:00:00.000002Z';
const staleResult = await runProductionBookingTick(intakeEnv, { ...intakeHarness([stale]), rpc });
assert.equal(staleResult.state, 'page_processed');
assert.equal(staleResult.staleReceipts, 1);
assert.equal(sql(`select status from bookings where id='${canonical}';`), 'cancelled');

const existing = intakeRow(5); existing.attributes.ota_reservation_code = 'EXISTINGSYNTHETIC';
sql("insert into bookings(property_id,channel,source,status,check_in,check_out,external_confirmation_code) values('65_calderwood','airbnb','ical_import','confirmed','2030-01-01','2030-01-02','EXISTINGSYNTHETIC');");
const blocked = intakeHarness([existing]);
assert.equal((await runProductionBookingTick(intakeEnv, { ...blocked, rpc })).ok, false);
assert.equal(blocked.acked.size, 0);
assert.equal(sql(`select count(*) from helm_airbnb_bookings.receipts where revision_id='${existing.id}';`), '0');

sql('update helm_airbnb_bookings.scope set enabled=false;');
const stopped = intakeHarness([intakeRow(6)]);
assert.equal((await runProductionBookingTick(intakeEnv, { ...stopped, rpc })).ok, false);
assert.deepEqual(stopped.events, []);
sql('update helm_airbnb_bookings.scope set enabled=true;');
console.log('PASS: booking intake real SQL lifecycle, immutable replay, pre-ACK contact retention, cancellation, stale revisions, existing-stay refusal, and disabled gate');
