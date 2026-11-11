import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { runInventoryCycle, type InventoryCycleStore } from '../channex-inventory/cycle.ts';
import { createInventoryDeliveryStore } from '../channex-inventory/delivery-store.ts';
import { type InventoryPlanningStore, type InventoryState } from '../channex-inventory/planner.ts';
import { PRODUCTION_DB_URL } from '../channex-production-runtime.ts';
import { CALDERWOOD_PRODUCTION as m } from '../channex-production-preflight.ts';
import { shiftIsoDay } from '../sca-quotes-types.ts';
const now=Date.parse('2026-11-11T15:00:00Z');
function snapshot(): InventoryState {
  const start='2026-11-11',end=shiftIsoDay(start,500);
  return {propertyId:m.helmPropertyId,remotePropertyId:m.propertyId,roomTypeId:m.roomTypeId,ratePlanId:m.ratePlanId,generation:1,
    environment:'production',timeZone:'America/New_York',planningEnabled:true,importEnabled:true,captureEnabled:true,captureVersion:1,
    configurationVersion:1,headVersion:0,observedAt:now,inputToken:'a'.repeat(64),start,end,requiredSources:['canonical-calendar','channex-bookings'],
    coverage:['canonical-calendar','channex-bookings'].map(source=>({source:source as 'canonical-calendar'|'channex-bookings',start,end,complete:true,observedAt:now,freshUntil:now+60000})),
    inputs:{authority:'helm',plan:{advance_notice_hours:0,booking_window_days:365,turnover_buffer_days:0,checkin_time:'16:00'},bookings:[],rateDays:[],periods:[]}};
}
const never=async():Promise<never>=>{throw Error('Unexpected IO');};
const noDelivery:InventoryCycleStore={selectNext:never,claim:never,begin:never,record:never};
const noTransport={prepare:never};
test('disabled, incomplete and superseded planning never selects or sends',async()=>{
  for(const input of [{status:'disabled'}, {...snapshot(),coverage:[]}]) {
    const planning:InventoryPlanningStore={read:async()=>input,commit:never};
    assert.ok(['disabled','blocked'].includes((await runInventoryCycle(planning,noDelivery,noTransport,randomUUID(),()=>now)).status));
  }
  assert.deepEqual(await runInventoryCycle({read:async()=>snapshot(),commit:async()=>({status:'superseded',version:1})},noDelivery,noTransport,randomUUID(),()=>now),{status:'superseded'});
});
test('every cycle replans before selection; a lost save cannot grant IO',async()=>{
  let reads=0,commits=0,selections=0;
  const planning:InventoryPlanningStore={read:async()=>{reads++;return snapshot();},commit:async(_expected,plan)=>{commits++;assert.equal(plan.days.length,500);return {status:'stored',version:1};}};
  const delivery={...noDelivery,selectNext:async()=>{selections++;assert.equal(commits,selections);return {status:'already-accepted' as const};}};
  await runInventoryCycle(planning,delivery,noTransport,randomUUID(),()=>now);
  await runInventoryCycle(planning,delivery,noTransport,randomUUID(),()=>now);
  assert.equal(reads,2);assert.equal(commits,2);
  await assert.rejects(runInventoryCycle({...planning,commit:async()=>{throw Error('lost save');}},noDelivery,noTransport,randomUUID(),()=>now),/lost save/);
});
test('selected durable token is revalidated before provider preparation',async()=>{
  const saved=randomUUID(),newToken=randomUUID();let claims=0;
  const planning:InventoryPlanningStore={read:async()=>snapshot(),commit:async()=>({status:'refreshed',version:1})};
  const delivery:InventoryCycleStore={...noDelivery,selectNext:async(token)=>{assert.equal(token,newToken);return {status:'selected',token:saved};},
    claim:async(token)=>{claims++;assert.equal(token,saved);return {status:'stale'};}};
  assert.deepEqual(await runInventoryCycle(planning,delivery,noTransport,newToken,()=>now),{status:'stale'});assert.equal(claims,1);
});
test('selection adapter validates shape and sanitizes lost responses',async()=>{
  const token=randomUUID();
  const db=createInventoryDeliveryStore(PRODUCTION_DB_URL,'synthetic',async(url,init)=>{
    assert.ok(String(url).endsWith('/helm_channex_delivery_cycle_claim'));assert.deepEqual(JSON.parse(String(init?.body)),{p_token:token});
    return Response.json({status:'selected',token});
  });assert.deepEqual(await db.selectNext(token),{status:'selected',token});
  const bad=createInventoryDeliveryStore(PRODUCTION_DB_URL,'synthetic',async()=>Response.json({status:'selected',token,extra:'private'}));
  await assert.rejects(bad.selectNext(token));
  const lost=createInventoryDeliveryStore(PRODUCTION_DB_URL,'synthetic',async()=>{throw Error('PRIVATE_SENTINEL');});
  await assert.rejects(lost.selectNext(token),/^Error: Availability delivery checkpoint uncertain; do not resend$/);
});
