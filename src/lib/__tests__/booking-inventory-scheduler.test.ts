import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALDERWOOD_INVENTORY_PILOT as p, inventoryPollingEnabled, createInventoryCycleRunner, runInventoryScheduler } from '../channex-staging/booking-inventory-scheduler.ts';
import { rollingInventoryWindow } from '../channex-staging/booking-inventory-window.ts';
import { calendarDates } from '../calderwood-readonly/calendar-window.ts';
import { CALDERWOOD_STAGING as m } from '../calderwood-readonly/channex.ts';
const env = { CHANNEX_CALDERWOOD_INVENTORY_ENABLED: 'true', CHANNEX_WORKER_MODE: 'isolated-staging',
  CHANNEX_STAGING_DB_PROJECT_REF: 'jgkblfozftcvymvwhhii', CHANNEX_STAGING_DB_URL: 'https://jgkblfozftcvymvwhhii.supabase.co',
  CHANNEX_STAGING_API_KEY: 'fake-key', CHANNEX_STAGING_DB_SERVICE_KEY: 'fake-key' };
const reviewed = { ...m, environment: 'staging', helmProperty: p.property, connection: p.connection, generation: 1,
  propertyTitle: '65 Calderwood - Isolated Staging', ratePlanTitle: 'TEST ONLY - Calderwood - CLOSED - $100 placeholder',
  adults: 6, children: 0, infants: 0, reviewedAt: '2026-10-22T12:00:00Z' };
function state() {
  const now=Date.now();
  return { property:p.property,captureEnabled:true,captureVersion:1,configurationVersion:1,
    configuration:{environment:'staging',topology:'single-unit',connection:String(p.connection),listing:m.roomTypeId,generation:1,
      publishEnabled:true,timeZone:'America/New_York',start:String(p.start),end:String(p.end),requiredSources:[String(p.source)],
      coverage:[{source:String(p.source),start:String(p.start),end:String(p.end),complete:true,observedAt:now-1000,freshUntil:now+1800000}]},
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
test('hosted inventory refuses unreviewed window, source and authority before provider IO',async()=>{
  for(const change of [(s:ReturnType<typeof state>)=>{s.configuration.end='2027-04-14';},
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

test('rolling mode requires a reviewed year and never expands the three-night fixture itself',async()=>{
  assert.throws(()=>createInventoryCycleRunner({...env,CHANNEX_CALDERWOOD_INVENTORY_WINDOW:'guess'}),/Unknown/);
  let calls=0;const s=state();
  const runner=createInventoryCycleRunner({...env,CHANNEX_CALDERWOOD_INVENTORY_WINDOW:'rolling-year'},async(input)=>{
    calls++;if(String(input).endsWith('/helm_staging_inventory_route_read'))return Response.json(reviewed);assert.match(String(input),/helm_booking_inventory_read$/);return Response.json(s);
  });
  assert.deepEqual(await runner(new AbortController().signal),{phase:'window',status:'needs-review'});
  assert.equal(calls,4);
});
test('rolling worker refuses a full-year provider response missing even one inventory date before enqueue or POST',async()=>{
  const s=state(),w=rollingInventoryWindow(Date.now());Object.assign(s.configuration,w);
  Object.assign(s.configuration.coverage[0],w);
  const dates=calendarDates({from:w.start,to:w.end}),calls:string[]=[];
  const runner=createInventoryCycleRunner({...env,CHANNEX_CALDERWOOD_INVENTORY_WINDOW:'rolling-year'},async(input,init)=>{
    const u=new URL(String(input));calls.push(u.pathname);
    if(u.pathname.endsWith('/helm_staging_inventory_route_read'))return Response.json(reviewed);
    if(u.hostname.endsWith('supabase.co')) {
      assert.match(u.pathname,/helm_booking_inventory_read$/);return Response.json(s);
    }
    assert.equal(init?.method,'GET');
    const rel=(id:string)=>({data:{id}});
    if(u.pathname.includes('/properties/'))return Response.json({data:{id:m.propertyId,attributes:{title:'65 Calderwood - Isolated Staging',currency:'USD',timezone:'America/New_York'}}});
    if(u.pathname.includes('/room_types/'))return Response.json({data:{id:m.roomTypeId,attributes:{count_of_rooms:1,occ_adults:6,occ_children:0,occ_infants:0},relationships:{property:rel(m.propertyId)}}});
    if(u.pathname.includes('/rate_plans/'))return Response.json({data:{id:m.ratePlanId,attributes:{title:'TEST ONLY - Calderwood - CLOSED - $100 placeholder',currency:'USD',sell_mode:'per_room',stop_sell:Array(7).fill(true)},relationships:{property:rel(m.propertyId),room_type:rel(m.roomTypeId)}}});
    if(u.pathname.endsWith('/channels'))return Response.json({data:[],meta:{total:0,page:1}});
    assert.equal(u.searchParams.get('filter[date][gte]'),w.start);
    assert.equal(u.searchParams.get('filter[date][lte]'),dates.at(-1));
    if(u.pathname.endsWith('/availability'))return Response.json({data:{[m.roomTypeId]:Object.fromEntries(dates.slice(0,-1).map(d=>[d,0]))}});
    assert.ok(u.pathname.endsWith('/restrictions'));
    return Response.json({data:{[m.ratePlanId]:Object.fromEntries(dates.map(d=>[d,{rate:100,min_stay_arrival:1,min_stay_through:1,max_stay:0,closed_to_arrival:false,closed_to_departure:false,stop_sell:true}]))}});
  });
  await assert.rejects(()=>runner(new AbortController().signal),/Complete stopped/);
  assert.equal(calls.filter(p=>p.endsWith('/availability')).length,1);
  assert.equal(calls.filter(p=>p.endsWith('/restrictions')).length,1);
});


test('automatic source coverage requires importer polling and a separately reviewed source route',async()=>{
  const flagged={...env,CHANNEX_CALDERWOOD_SOURCE_COVERAGE_ENABLED:'true'};
  assert.throws(()=>createInventoryCycleRunner(flagged),/Canonical polling required/);
  let calls=0;
  const runner=createInventoryCycleRunner({...flagged,CHANNEX_CANONICAL_POLLING_ENABLED:'true'},async()=>{calls++;return Response.json(state());});
  await assert.rejects(()=>runner(new AbortController().signal),/configuration changed/);assert.equal(calls,1);
});
test('worker certifies a complete source while paused without publishing inventory or sending messages',async()=>{
  for(const saved of [false,true]) {
    const s=state();s.configuration.requiredSources=['channex-staging-bookings'];s.configuration.coverage=[];s.configuration.publishEnabled=false;
    const calls:{path:string;method:string}[]=[];
    const source=()=>({property:p.property,captureEnabled:true,importEnabled:true,authority:'helm',captureVersion:s.captureVersion,
      configurationVersion:s.configurationVersion,connection:p.connection,listing:m.roomTypeId,generation:1,
      requiredSources:s.configuration.requiredSources,bindings:[],unmappedRemoteRows:0});
    const runner=createInventoryCycleRunner({...env,CHANNEX_CALDERWOOD_SOURCE_COVERAGE_ENABLED:'true',CHANNEX_CANONICAL_POLLING_ENABLED:'true'},async(input,init)=>{
      const u=new URL(String(input));calls.push({path:u.pathname,method:init?.method??'GET'});
      if(u.pathname.endsWith('/helm_booking_inventory_read'))return Response.json(s);
      if(u.pathname.endsWith('/helm_staging_inventory_route_read'))return Response.json(reviewed);
      if(u.pathname.endsWith('/helm_pilot_source_read'))return Response.json(source());
      if(u.pathname.endsWith('/helm_pilot_source_certify')){
        const args=JSON.parse(String(init?.body));assert.deepEqual(args.p_bookings,[]);assert.deepEqual(args.p_expected,source());
        if(saved){s.configurationVersion++;s.configuration.coverage=[{source:'channex-staging-bookings',start:args.p_start,end:args.p_end,
          complete:true,observedAt:args.p_observed_at,freshUntil:args.p_observed_at+900000}];}
        return Response.json(saved);
      }
      assert.equal(init?.method,'GET');const rel=(id:string)=>({data:{id}});
      if(u.pathname.includes('/properties/'))return Response.json({data:{id:m.propertyId,attributes:{title:'65 Calderwood - Isolated Staging',currency:'USD',timezone:'America/New_York'}}});
      if(u.pathname.includes('/room_types/'))return Response.json({data:{id:m.roomTypeId,attributes:{count_of_rooms:1,occ_adults:6,occ_children:0,occ_infants:0},relationships:{property:rel(m.propertyId)}}});
      if(u.pathname.includes('/rate_plans/'))return Response.json({data:{id:m.ratePlanId,attributes:{title:'TEST ONLY - Calderwood - CLOSED - $100 placeholder',currency:'USD',sell_mode:'per_room',stop_sell:Array(7).fill(true)},relationships:{property:rel(m.propertyId),room_type:rel(m.roomTypeId)}}});
      if(u.pathname.endsWith('/channels'))return Response.json({data:[],meta:{total:0,page:1}});
      if(u.pathname.endsWith('/bookings')||u.pathname.endsWith('/booking_revisions/feed'))return Response.json({data:[],meta:{total:0,page:1,limit:100}});
      if(u.pathname.endsWith('/availability'))return Response.json({data:{[m.roomTypeId]:{'2027-01-01':0}}});
      assert.ok(u.pathname.endsWith('/restrictions'));return Response.json({data:{[m.ratePlanId]:{'2027-01-01':{rate:100,min_stay_arrival:1,min_stay_through:1,max_stay:0,closed_to_arrival:false,closed_to_departure:false,stop_sell:true}}}});
    });
    assert.deepEqual(await runner(new AbortController().signal),saved?{phase:'plan',status:'blocked'}:{phase:'source',status:'superseded'});
    assert.equal(calls.filter(c=>c.path.endsWith('/bookings')).length,2);
    assert.equal(calls.filter(c=>c.path.endsWith('/helm_pilot_source_certify')).length,1);
    assert.ok(calls.every(c=>c.method==='GET'||c.path.includes('/rpc/helm_')));
    if(saved) {calls.length=0;await runner(new AbortController().signal);assert.deepEqual(calls.map(c=>c.path),['/rest/v1/rpc/helm_booking_inventory_read']);}
  }
});


test('full-sync runner requires both exact pins and a configured window', () => {
  const pins = { CHANNEX_INVENTORY_FULL_SYNC_ID: 'projection-' + 'a'.repeat(64), CHANNEX_INVENTORY_FULL_SYNC_DIGEST: 'b'.repeat(64) };
  assert.throws(() => createInventoryCycleRunner({ ...env, ...pins }), /configured-window/);
  const configured = { ...env, CHANNEX_CALDERWOOD_INVENTORY_WINDOW: 'configured-window' };
  assert.doesNotThrow(() => createInventoryCycleRunner({ ...configured, ...pins }));
  for (const value of [{ CHANNEX_INVENTORY_FULL_SYNC_ID: pins.CHANNEX_INVENTORY_FULL_SYNC_ID },
    { CHANNEX_INVENTORY_FULL_SYNC_DIGEST: pins.CHANNEX_INVENTORY_FULL_SYNC_DIGEST },
    { ...pins, CHANNEX_INVENTORY_FULL_SYNC_ID: '' }, { ...pins, CHANNEX_INVENTORY_FULL_SYNC_DIGEST: 'wrong' }]) {
    assert.throws(() => createInventoryCycleRunner({ ...configured, ...value }), /configured-window/);
  }
});
