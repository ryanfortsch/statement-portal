import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALDERWOOD_INVENTORY_PILOT as p, inventoryPollingEnabled, createInventoryCycleRunner, runInventoryScheduler } from '../channex-staging/booking-inventory-scheduler.ts';
import { CALDERWOOD_STAGING as m } from '../calderwood-readonly/channex.ts';
const env = { CHANNEX_CALDERWOOD_INVENTORY_ENABLED: 'true', CHANNEX_WORKER_MODE: 'isolated-staging',
  CHANNEX_STAGING_DB_PROJECT_REF: 'jgkblfozftcvymvwhhii', CHANNEX_STAGING_DB_URL: 'https://jgkblfozftcvymvwhhii.supabase.co',
  CHANNEX_STAGING_API_KEY: 'fake-key', CHANNEX_STAGING_DB_SERVICE_KEY: 'fake-key' };
function state() {
  const now=Date.now();
  return { property:p.property,captureEnabled:true,captureVersion:1,configurationVersion:1,
    configuration:{environment:'staging',topology:'single-unit',connection:String(p.connection),listing:m.roomTypeId,generation:1,
      publishEnabled:true,timeZone:'America/New_York',start:String(p.start),end:String(p.end),requiredSources:[String(p.source)],
      coverage:[{source:p.source,start:String(p.start),end:String(p.end),complete:true,observedAt:now-1000,freshUntil:now+1800000}]},
    plannedCaptureVersion:0,plannedConfigurationVersion:0,planVersion:0,journalVersion:0,journal:{format:1,commands:[]},
    lastDigest:null,plannedFreshUntil:0,inputsMatchPlan:false,
    inputs:{authority:'helm',plan:{advance_notice_hours:24,booking_window_days:365,turnover_buffer_days:0,checkin_time:'16:00'},bookings:[],rateDays:[],periods:[]} };
}
test('hosted inventory requires the explicit flag, isolated database and credentials',()=>{
  assert.equal(inventoryPollingEnabled(env),true);
  for(const key of Object.keys(env))assert.throws(()=>createInventoryCycleRunner({...env,[key]:''}));
  assert.throws(()=>createInventoryCycleRunner({...env,VERCEL_ENV:'preview'}));
  assert.throws(()=>createInventoryCycleRunner({...env,CHANNEX_STAGING_DB_URL:'https://other.supabase.co'}));
});
test('expired or disabled coverage stops before any provider call or database write',async()=>{
  for(const change of [(s:ReturnType<typeof state>)=>{s.configuration.publishEnabled=false;},
    (s:ReturnType<typeof state>)=>{s.configuration.coverage[0].freshUntil=Date.now()-1;},
    (s:ReturnType<typeof state>)=>{s.configuration.coverage[0].complete=false;}]){
    const s=state();change(s);let calls=0;
    const runner=createInventoryCycleRunner(env,async(input)=>{calls++;assert.equal(String(input),env.CHANNEX_STAGING_DB_URL+'/rest/v1/rpc/helm_booking_inventory_read');return Response.json(s);});
    assert.deepEqual(await runner(new AbortController().signal),{phase:'plan',status:'blocked'});assert.equal(calls,1);
  }
});
test('hosted inventory refuses expanded windows, routes and authority before provider IO',async()=>{
  for(const change of [(s:ReturnType<typeof state>)=>{s.configuration.end='2027-04-14';},
    (s:ReturnType<typeof state>)=>{s.configuration.connection='another';},
    (s:ReturnType<typeof state>)=>{s.configuration.generation=2;},
    (s:ReturnType<typeof state>)=>{s.configuration.requiredSources=['made-up'];},
    (s:ReturnType<typeof state>)=>{s.inputs.authority='guesty';}]){
    const s=state();change(s);let calls=0;
    const runner=createInventoryCycleRunner(env,async()=>{calls++;return Response.json(s);});
    await assert.rejects(runner(new AbortController().signal),/configuration changed/);assert.equal(calls,1);
  }
});
test('inventory loop is sequential, follows submitted tasks quickly and backs off failures without private logs',async()=>{
  const controller=new AbortController(),delays:number[]=[],logs:unknown[]=[];let calls=0,active=0;
  const result=await runInventoryScheduler({signal:controller.signal,cycle:async()=>{
    assert.equal(++active,1);await Promise.resolve();active--;calls++;
    if(calls===1)return {phase:'deliver',status:'submitted'};
    if(calls===2)return {phase:'reconcile',status:'pending'};
    if(calls===3)return {phase:'plan',status:'unchanged'};
    if(calls===4)throw Error('SECRET');
    if(calls===5)return {phase:'reconcile',status:'failed'};
    return {phase:'plan',status:'blocked'};
  },log:e=>logs.push(e),wait:async ms=>{delays.push(ms);if(delays.length===6)controller.abort();}});
  assert.deepEqual(delays,[10000,10000,60000,60000,120000,60000]);
  assert.equal(result.failed,false);assert.equal(result.canSendMessages,false);assert.doesNotMatch(JSON.stringify(logs),/SECRET/);
});
test('shutdown cancels active database transport and once mode does not sleep',async()=>{
  const controller=new AbortController();let calls=0;
  const runner=createInventoryCycleRunner(env,async(_input,init)=>{calls++;controller.abort();init?.signal?.throwIfAborted();throw Error('unreachable');});
  await assert.rejects(runner(controller.signal));await assert.rejects(runner(controller.signal));assert.equal(calls,1);
  const once=await runInventoryScheduler({signal:new AbortController().signal,once:true,cycle:async()=>{throw Error('secret');},
    log:()=>{throw Error('logger down');},wait:async()=>assert.fail('no sleep')});
  assert.deepEqual(once,{cycles:1,failed:true,canSendMessages:false});
});
