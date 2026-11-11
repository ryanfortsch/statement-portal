/** Actual planner + RPC adapter + transport orchestration; synthetic loopback
 * PostgreSQL and a fake provider only. No environment files or live API calls. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { prepareInventory } from '../src/lib/channex-inventory/planner.ts';
import { createInventoryDeliveryStore } from '../src/lib/channex-inventory/delivery-store.ts';
import { deliverInventoryOnce, recoverInventoryOnce, createUnmappedInventoryTransport } from '../src/lib/channex-inventory/delivery.ts';
import { CALDERWOOD_PRODUCTION as m } from '../src/lib/channex-production-preflight.ts';
import { PRODUCTION_DB_URL } from '../src/lib/channex-production-runtime.ts';
if (process.env.PGHOST !== '127.0.0.1' || process.env.PGDATABASE !== 'helm_synthetic_channex') throw Error('Synthetic loopback database required');
const psql = process.env.CHANNEX_TEST_PSQL || 'psql';
function sql(query: string) {
  const r = spawnSync(psql, ['-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8' });
  if (r.status) throw Error(r.stderr); return r.stdout.trim();
}
const str = (v: string) => "'" + v.replaceAll("'", "''") + "'";
const json = (v: unknown) => str(JSON.stringify(v)) + '::jsonb';
assert.equal(sql('select current_database();'), 'helm_synthetic_channex');
sql('select channex_synthetic_inventory_setup();');
const { state, plan } = prepareInventory(JSON.parse(sql('select helm_channex_inventory_read();')), Date.now());
assert.ok(plan);
sql(`select helm_channex_inventory_plan_commit(${json({ captureVersion: state.captureVersion, configurationVersion: state.configurationVersion,
  headVersion: state.headVersion, inputToken: state.inputToken })}, ${json(plan)});`);
sql('update helm_airbnb_bookings.delivery_scope set enabled=true;');
const rpcFetch: typeof fetch = async (url, init) => {
  const name = String(url).split('/').at(-1), p = JSON.parse(String(init?.body));
  assert.ok(String(url).startsWith(PRODUCTION_DB_URL + '/rest/v1/rpc/'));
  const args = name === 'helm_channex_delivery_claim' ? `${str(p.p_token)}::uuid` : name === 'helm_channex_delivery_recover'
    ? `${str(p.p_previous_token)}::uuid,${str(p.p_token)}::uuid` : name === 'helm_channex_delivery_begin'
    ? `${str(p.p_token)}::uuid,${str(p.p_digest)}` : name === 'helm_channex_delivery_record'
    ? `${str(p.p_token)}::uuid,${str(p.p_digest)},${json(p.p_outcome)}` : null;
  assert.ok(args);
  const result = JSON.parse(sql(`set role service_role; select to_jsonb(public.${name}(${args}));`));
  if (name === 'helm_channex_delivery_recover' && loseRecoveryResponse) { loseRecoveryResponse = false; throw Error('Synthetic lost recovery response'); }
  if (name === 'helm_channex_delivery_record' && loseRecordResponse) { loseRecordResponse = false; throw Error('Synthetic lost outcome response'); }
  return Response.json(result);
};
const relation = (id: string) => ({ data: { id } });
const reads = [
  { data: { id: m.propertyId, attributes: { title: m.propertyTitle, currency: 'USD', timezone: 'America/New_York', property_type: 'holiday_home' } } },
  { data: { id: m.roomTypeId, attributes: { title: m.roomTitle, count_of_rooms: 1, occ_adults: 6, occ_children: 0, occ_infants: 0 }, relationships: { property: relation(m.propertyId) } } },
  { data: { id: m.ratePlanId, attributes: { title: m.rateTitle, currency: 'USD', sell_mode: 'per_room', rate_mode: 'manual', stop_sell: Array(7).fill(true) }, relationships: { property: relation(m.propertyId), room_type: relation(m.roomTypeId) } } },
  { data: [], meta: { total: 0, page: 1 } },
];
let readCount = 0, sendCount = 0;
let token = randomUUID(), taskId = randomUUID();
let loseRecordResponse = false, loseRecoveryResponse = false, timeoutNext = false;
const provider: typeof fetch = async (_url, init) => {
  if (init?.method === 'GET') return Response.json(reads[readCount++ % 4]);
  sendCount++;
  assert.equal(sql(`select state from helm_airbnb_bookings.delivery_attempts where token=${str(token)}::uuid;`), 'submitting');
  assert.equal(init?.body, sql(`select request_body from helm_airbnb_bookings.delivery_attempts where token=${str(token)}::uuid;`));
  if (timeoutNext) { timeoutNext = false; throw Error('Synthetic availability timeout'); }
  return Response.json({ data: [{ id: taskId, type: 'task' }], meta: { message: 'Success', warnings: [] } });
};
try {
  const store = createInventoryDeliveryStore(PRODUCTION_DB_URL, 'synthetic-only', rpcFetch);
  const transport = createUnmappedInventoryTransport('synthetic-only', provider);
  const result = await deliverInventoryOnce(store, transport, token);
  assert.equal(result.status, 'accepted'); assert.equal(sendCount, 1);
  assert.equal(sql(`select task_id::text from helm_airbnb_bookings.delivery_attempts where token=${str(token)}::uuid;`), taskId);
  assert.equal((await deliverInventoryOnce(store, transport, token)).status, 'already-accepted');
  assert.equal((await deliverInventoryOnce(store, transport, randomUUID())).status, 'already-accepted');
  assert.equal(sendCount, 1); assert.equal(readCount, 4);
  const priorToken = token, priorBytes = sql(`select request_body from helm_airbnb_bookings.delivery_attempts where token=${str(token)}::uuid;`);
  const availableDate = plan.days.find(d => d.available === 1)!.date;
  sql(`insert into property_rate_days(property_id,date,closed) values('65_calderwood',${str(availableDate)},true)
    on conflict(property_id,date) do update set closed=true;`);
  assert.equal((await deliverInventoryOnce(store, transport, randomUUID())).status, 'stale');
  const next = prepareInventory(JSON.parse(sql('select helm_channex_inventory_read();')), Date.now());
  assert.ok(next.plan); assert.notEqual(next.plan.digest, plan.digest);
  sql(`select helm_channex_inventory_plan_commit(${json({ captureVersion: next.state.captureVersion, configurationVersion: next.state.configurationVersion,
    headVersion: next.state.headVersion, inputToken: next.state.inputToken })}, ${json(next.plan)});`);
  assert.equal((await deliverInventoryOnce(store, transport, priorToken)).status, 'blocked');
  assert.equal((await deliverInventoryOnce(store, transport, randomUUID())).status, 'blocked'); // pacing
  sql("update helm_airbnb_bookings.delivery_scope set next_attempt_at='-infinity';");
  token = randomUUID(); taskId = randomUUID(); loseRecordResponse = true;
  await assert.rejects(deliverInventoryOnce(store, transport, token), /checkpoint uncertain/);
  assert.equal(sql(`select state from helm_airbnb_bookings.delivery_attempts where token=${str(token)}::uuid;`), 'accepted');
  assert.notEqual(sql(`select request_body from helm_airbnb_bookings.delivery_attempts where token=${str(token)}::uuid;`), priorBytes);
  assert.equal((await deliverInventoryOnce(store, transport, token)).status, 'already-accepted');
  assert.equal((await deliverInventoryOnce(store, transport, randomUUID())).status, 'already-accepted');
  assert.equal(sql('select count(*) from helm_airbnb_bookings.delivery_attempts;'), '2');
  assert.equal(sendCount, 2); assert.equal(readCount, 8);
  function freshPlan() {
    const next = prepareInventory(JSON.parse(sql('select helm_channex_inventory_read();')), Date.now()); assert.ok(next.plan);
    sql(`select helm_channex_inventory_plan_commit(${json({ captureVersion: next.state.captureVersion, configurationVersion: next.state.configurationVersion,
      headVersion: next.state.headVersion, inputToken: next.state.inputToken })}, ${json(next.plan)});`);
    return next.plan;
  }
  sql(`update property_rate_days set closed=false where property_id='65_calderwood' and date=${str(availableDate)};`);
  freshPlan(); sql("update helm_airbnb_bookings.delivery_scope set next_attempt_at='-infinity';");
  token=randomUUID(); timeoutNext=true;
  assert.equal((await deliverInventoryOnce(store, transport, token)).status,'uncertain');
  const timedOut=token, timedOutBytes=sql(`select request_body from helm_airbnb_bookings.delivery_attempts where token=${str(token)}::uuid;`);
  token=randomUUID();
  assert.equal((await recoverInventoryOnce(store, transport, timedOut, token)).status,'blocked');
  assert.equal(sendCount,3); assert.equal(readCount,12);
  sql(`update helm_airbnb_bookings.delivery_attempts set expires_at=0,started_at=clock_timestamp()-interval '2 minutes' where token=${str(timedOut)}::uuid;
    update helm_airbnb_bookings.delivery_scope set next_attempt_at='-infinity';
    update property_rate_days set closed=true where property_id='65_calderwood' and date=${str(availableDate)};`);
  assert.equal((await recoverInventoryOnce(store, transport, timedOut, token)).status,'stale');
  freshPlan(); loseRecoveryResponse=true;
  await assert.rejects(recoverInventoryOnce(store,transport,timedOut,token),/checkpoint uncertain/);
  assert.equal(sendCount,3); assert.equal(readCount,12); // lost claim grants no IO
  taskId=randomUUID();
  assert.equal((await recoverInventoryOnce(store,transport,timedOut,token)).status,'accepted');
  const replacement=token;
  const replacementBytes=sql(`select request_body from helm_airbnb_bookings.delivery_attempts where token=${str(token)}::uuid;`);
  assert.notEqual(replacementBytes,timedOutBytes);
  assert.equal(sql(`select request_body from helm_airbnb_bookings.delivery_attempts where token=${str(timedOut)}::uuid;`),timedOutBytes);
  assert.equal((await recoverInventoryOnce(store,transport,timedOut,token)).status,'already-accepted');
  assert.equal(sendCount,4); assert.equal(readCount,16);
  // Old request's authentic response arrives AFTER the replacement acceptance.
  await store.record(timedOut,sql(`select request_digest from helm_airbnb_bookings.delivery_attempts where token=${str(timedOut)}::uuid;`),{kind:'accepted',taskId:randomUUID()});
  assert.equal((await deliverInventoryOnce(store,transport,replacement)).status,'blocked');
  freshPlan(); sql("update helm_airbnb_bookings.delivery_scope set next_attempt_at='-infinity';");
  token=randomUUID(); taskId=randomUUID();
  assert.equal((await deliverInventoryOnce(store,transport,token)).status,'accepted');
  assert.equal(sql(`select request_body from helm_airbnb_bookings.delivery_attempts where token=${str(token)}::uuid;`),replacementBytes);
  assert.equal(sendCount,5); assert.equal(readCount,20);
  assert.equal(sql('select consecutive_recoveries from helm_airbnb_bookings.delivery_scope;'),'0');
} finally {
  sql("delete from helm_airbnb_bookings.delivery_attempts; update helm_airbnb_bookings.delivery_scope set enabled=false,next_attempt_at='-infinity';");
}
console.log('PASS: real SQL claim, exact stored bytes, service RPC adapter, one-use barrier, latest-plan acceptance, real timeout recovery, lost responses, late-receipt reassertion and duplicate suppression');
