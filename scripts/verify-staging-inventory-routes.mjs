// Local SQL + real scheduler/store/planner/transport with two fictional routes.
// Invoked by the native PostgreSQL runner; every provider response is simulated.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInventoryCycleRunner } from '../src/lib/channex-staging/booking-inventory-scheduler.ts';
import { bindInventoryRoute } from '../src/lib/channex-staging/inventory-route.ts';
import { parseBookingInventoryState } from '../src/lib/channex-staging/booking-inventory-consumer.ts';
import { replayInventoryJournal } from '../src/lib/channex-staging/inventory-journal.ts';
import { shiftIsoDay, todayInEastern } from '../src/lib/sca-quotes-types.ts';
export async function verifyStagingInventoryRoutes(db, check) {
  const query = (sql,args=[]) => db.query(sql,args);
  const sql = readFileSync(new URL('../docs/guesty-exit/staging-storage/inventory-routes.sql',import.meta.url),'utf8');
  await db.exec(sql);
  const start = shiftIsoDay(todayInEastern(new Date()),10), end = shiftIsoDay(start,3);
  const fixtures = [1,2].map(n => ({ property: `HELMTEST-route-${n}`, connection: `reviewed-route-${n}`, generation: n,
    propertyId: `${n}1111111-1111-4111-8111-111111111111`, roomTypeId: `${n}2222222-2222-4222-8222-222222222222`,
    ratePlanId: `${n}3333333-3333-4333-8333-333333333333`, title: `Fictional ${n} - Isolated Staging`,
    rateTitle: `TEST ONLY - Fictional ${n} - CLOSED`, task: `${n}4444444-4444-4444-8444-444444444444`, posted: [], counts: {} }));
  const state = async f => (await query('select helm_booking_inventory_read($1) s',[f.property])).rows[0].s;
  const readRoute = async (f, generation=f.generation) => (await query('select helm_staging_inventory_route_read($1,$2,$3) r',[f.property,f.connection,generation])).rows[0].r;
  const insert = f => query(`insert into helm_staging_inventory_routes(property_id,connection,generation,provider_property_id,room_type_id,rate_plan_id,property_title,rate_plan_title,adults,children,infants)
    values($1,$2,$3,$4,$5,$6,$7,$8,2,0,0)`,[f.property,f.connection,f.generation,f.propertyId,f.roomTypeId,f.ratePlanId,f.title,f.rateTitle]);
  for (const f of fixtures) {
    await query(`insert into properties(id,name,address,city,owner_last,owner_full,owner_greeting,management_fee_pct,calendar_authority)
      values($1,'Fictional','Fictional','Fictional','Fixture','Fixture','Fixture',0,'helm')`,[f.property]);
    await query('insert into helm_inventory_capture_scopes(property_id,enabled) values($1,true)',[f.property]);
    await query('insert into property_rate_plans(property_id,base_nightly_cents) values($1,0)',[f.property]);
    await query('insert into helm_booking_inventory_consumers(property_id,configuration) values($1,$2)',[f.property,
      {environment:'staging',topology:'single-unit',connection:f.connection,listing:f.roomTypeId,generation:f.generation,publishEnabled:false,
        timeZone:'America/New_York',start,end,requiredSources:['synthetic-canonical'],coverage:[{source:'synthetic-canonical',start,end,complete:true,observedAt:Date.now()-1000,freshUntil:Date.now()+1800000}]}]);
  }
  await check('mapping SQL: no mapping is inferred; wrong scope and publishing registration fail', async () => {
    assert.equal(await readRoute(fixtures[0]),null);
    await assert.rejects(() => insert({...fixtures[0],generation:9}),/Paused matching/);
    await query("update helm_booking_inventory_consumers set configuration=jsonb_set(configuration,'{publishEnabled}','true') where property_id=$1",[fixtures[0].property]);
    await assert.rejects(() => insert(fixtures[0]),/Paused matching/);
    await query("update helm_booking_inventory_consumers set configuration=jsonb_set(configuration,'{publishEnabled}','false') where property_id=$1",[fixtures[0].property]);
  });
  await check('mapping SQL: owner registers two distinct immutable destinations without enabling publishing', async () => {
    for (const f of fixtures) {
      if (f === fixtures[1]) {
        await assert.rejects(() => insert({ ...f, propertyId: fixtures[0].propertyId }), /unique constraint/);
        await assert.rejects(() => insert({ ...f, ratePlanId: fixtures[0].ratePlanId }), /unique constraint/);
      }
      await insert(f); const s = await state(f), r = await readRoute(f);
      assert.equal(s.configuration.publishEnabled,false); assert.equal(bindInventoryRoute(r,parseBookingInventoryState(s,f.property)).propertyId,f.propertyId);
    }
    for (const mutation of ["update helm_staging_inventory_routes set generation=generation+1", "delete from helm_staging_inventory_routes", "truncate helm_staging_inventory_routes"]) {
      await assert.rejects(() => query(mutation),/immutable/);
    }
  });
  await check('mapping SQL: browser cannot read routes; service cannot register or rewrite them', async () => {
    for (const role of ['anon','authenticated','service_role']) {
      await db.exec(`set role ${role}`);
      try {
        await assert.rejects(() => insert(fixtures[0]),/permission denied/);
        await assert.rejects(() => query('select * from helm_staging_inventory_routes'),/permission denied/);
        if (role === 'service_role') assert.equal((await readRoute(fixtures[0])).propertyId,fixtures[0].propertyId);
        else await assert.rejects(() => readRoute(fixtures[0]),/permission denied/);
      } finally { await db.exec('reset role'); }
    }
  });
  const rpcArgs = {
    helm_booking_inventory_read:['p_property'], helm_staging_inventory_route_read:['p_property','p_connection','p_generation'],
    helm_booking_inventory_plan_commit:['p_property','expected_capture','expected_configuration','expected_plan','expected_journal','expected_inputs','next_journal','fresh_until','desired_digest'],
    helm_booking_inventory_plan_refresh:['p_property','expected_capture','expected_configuration','expected_plan','expected_journal','expected_inputs','fresh_until','desired_digest'],
    helm_booking_inventory_journal_append:['p_property','expected_journal','next_journal'],
  };
  const fakeFetch = f => async (input,init) => {
    const u = new URL(String(input));
    if (u.origin === 'https://jgkblfozftcvymvwhhii.supabase.co') {
      const fn = u.pathname.split('/').at(-1), names = rpcArgs[fn], body = JSON.parse(init.body);
      assert.ok(names,`Unexpected RPC ${fn}`); assert.deepEqual(Object.keys(body).sort(),[...names].sort());
      assert.equal(body.p_property,f.property);
      await db.exec('set role service_role');
      try { return Response.json((await query(`select public.${fn}(${names.map((_,i)=>'$'+(i+1)).join(',')}) value`,names.map(k=>body[k]))).rows[0].value); }
      finally { await db.exec('reset role'); }
    }
    assert.equal(u.origin,'https://staging.channex.io');
    if (init.method === 'POST') {
      assert.equal(u.pathname,'/api/v1/availability'); const payload = JSON.parse(init.body);
      const job = replayInventoryJournal((await state(f)).journal).queue.list().at(-1);
      assert.equal(job.status,'submitting'); assert.equal(job.request.body,init.body); assert.equal(job.generation,f.generation);
      for (const v of payload.values) { assert.equal(v.property_id,f.propertyId); assert.equal(v.room_type_id,f.roomTypeId); f.counts[v.date]=v.availability; }
      f.posted.push(payload); f.dispatchedAt=job.dispatchedAt;
      return Response.json({data:[{type:'task',id:f.task}],meta:{message:'Success'}});
    }
    assert.equal(init.method,'GET'); const rel=id=>({data:{id}});
    if (u.pathname.includes('/properties/')) { assert.ok(u.pathname.endsWith(f.propertyId)); return Response.json({data:{id:f.propertyId,attributes:{title:f.title,currency:'USD',timezone:'America/New_York'}}}); }
    if (u.pathname.includes('/room_types/')) { assert.ok(u.pathname.endsWith(f.roomTypeId)); return Response.json({data:{id:f.roomTypeId,attributes:{count_of_rooms:1,occ_adults:2,occ_children:0,occ_infants:0},relationships:{property:rel(f.propertyId)}}}); }
    if (u.pathname.includes('/rate_plans/')) { assert.ok(u.pathname.endsWith(f.ratePlanId)); return Response.json({data:{id:f.ratePlanId,attributes:{title:f.rateTitle,currency:'USD',sell_mode:'per_room',stop_sell:Array(7).fill(true)},relationships:{property:rel(f.propertyId),room_type:rel(f.roomTypeId)}}}); }
    if (u.pathname.includes('/tasks/')) {
      assert.ok(u.pathname.endsWith(f.task)); const stamp = new Date(f.dispatchedAt).toISOString();
      return Response.json({data:{id:f.task,type:'task',attributes:{id:f.task,task:'Property.UpdateAvailability',success:true,errors:[],channel_events:[],received_at:stamp,executed_at:stamp,finished_at:stamp,payload:f.posted.at(-1)}}});
    }
    assert.equal(u.searchParams.get('filter[property_id]'),f.propertyId);
    if (u.pathname.endsWith('/channels')) return Response.json({data:[],meta:{total:0,page:1,limit:100}});
    if (u.pathname.endsWith('/availability')) return Response.json({data:{[f.roomTypeId]:f.counts}});
    assert.equal(u.pathname,'/api/v1/restrictions');
    return Response.json({data:{[f.ratePlanId]:Object.fromEntries(Object.keys(f.counts).map(d=>[d,{rate:100,min_stay_arrival:1,min_stay_through:1,max_stay:0,closed_to_arrival:false,closed_to_departure:false,stop_sell:true}]))}});
  };
  for (const f of fixtures) await check(`mapping pipeline: ${f.property} queues, publishes and verifies only its own saved destination`, async () => {
    for(let i=0;i<3;i++) f.counts[shiftIsoDay(start,i)] = 0;
    await query("select * from helm_create_booking($1,'manual','manual','block',$2,$3,'{\"hold_kind\":\"owner\"}','fixture',false)",[f.property,start,shiftIsoDay(start,1)]);
    await query("update helm_booking_inventory_consumers set configuration=jsonb_set(configuration,'{publishEnabled}','true') where property_id=$1",[f.property]);
    const env={CHANNEX_CALDERWOOD_INVENTORY_ENABLED:'true',CHANNEX_WORKER_MODE:'isolated-staging',CHANNEX_STAGING_DB_PROJECT_REF:'jgkblfozftcvymvwhhii',CHANNEX_STAGING_DB_URL:'https://jgkblfozftcvymvwhhii.supabase.co',
      CHANNEX_STAGING_API_KEY:'fictional',CHANNEX_STAGING_DB_SERVICE_KEY:'fictional',CHANNEX_INVENTORY_HELM_PROPERTY:f.property,CHANNEX_CALDERWOOD_INVENTORY_WINDOW:'configured-window'};
    const runner=createInventoryCycleRunner(env,fakeFetch(f));
    assert.equal((await runner(new AbortController().signal)).status,'submitted');
    assert.equal(f.posted.length,1); assert.equal(f.posted[0].values.length,2);
    await runner(new AbortController().signal);
    assert.equal(replayInventoryJournal((await state(f)).journal).queue.list().at(-1).status,'verified'); assert.equal(f.posted.length,1);
  });
  await check('mapping SQL: changed configuration generation makes old review unusable; reinstall preserves records', async () => {
    const f = fixtures[0], before = await readRoute(f);
    await db.exec(sql); assert.deepEqual(await readRoute(f),before);
    await query("update helm_booking_inventory_consumers set configuration=jsonb_set(configuration,'{generation}','9') where property_id=$1",[f.property]);
    assert.equal(await readRoute(f),null); assert.equal(await readRoute(f,9),null);
    assert.ok(await readRoute(fixtures[1]));
  });
}
