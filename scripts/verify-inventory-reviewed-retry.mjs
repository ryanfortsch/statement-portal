import { prepareSupportResolution } from '../src/lib/channex-staging/inventory-support-resolution.ts';
import { replayInventoryJournal } from '../src/lib/channex-staging/inventory-journal.ts';
// Native PostgreSQL only, fictional sources and mocked provider transport.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createReviewedRetryStore } from '../src/lib/channex-staging/inventory-reviewed-retry-store.ts';
import { sendReviewedRetryOnce, checkReviewedRetry } from '../src/lib/channex-staging/inventory-reviewed-retry.ts';
import { ChannexAvailabilityClient } from '../src/lib/channex-staging/availability-client.ts';
import { createAvailabilityRequest } from '../src/lib/channex-staging/availability-request.ts';
import { inventoryDigest } from '../src/lib/channex-staging/inventory-outbox.ts';
import { shiftIsoDay, todayInEastern } from '../src/lib/sca-quotes-types.ts';
export async function verifyInventoryReviewedRetry(db, check, race) {
  const {a,b,blocked,pidA,pidB}=race;
  const installation=readFileSync(new URL('../docs/guesty-exit/staging-storage/inventory-reviewed-retry.sql',import.meta.url),'utf8');
  try { await db.exec(installation); } catch(e) { throw Error(`${e.message} at ${e.position}: ${installation.slice(Number(e.position)-120,Number(e.position)+120)}`); }
  let index=0;
  const args={helm_inventory_retry_read:['p_property'],helm_inventory_retry_reserve:['p_property','expected','next_record'],
    helm_inventory_retry_update:['p_property','expected_revision','prior_record','next_record']};
  async function seed() {
    const n=++index, property=`HELMTEST-retry-${n}`, now=Date.now(),date=shiftIsoDay(todayInEastern(new Date()),15),end=shiftIsoDay(date,1);
    const uuid=x=>`a${String(n).padStart(6,'0')}${x}-1111-4111-8111-111111111111`;
    const route={environment:'staging',helmProperty:property,connection:property,generation:1,propertyId:uuid(1),roomTypeId:uuid(2),propertyTitle:'Fictional - Isolated Staging'};
    await db.query(`insert into properties(id,name,address,city,owner_last,owner_full,owner_greeting,management_fee_pct,calendar_authority)
      values($1,'Fictional','Fictional','Fictional','Fixture','Fixture','Fixture',0,'helm')`,[property]);
    await db.query('insert into helm_inventory_capture_scopes(property_id,enabled) values($1,true)',[property]);
    await db.query('insert into property_rate_plans(property_id,base_nightly_cents) values($1,0)',[property]);
    const days=[{date,available:1,stopSell:false}], request=createAvailabilityRequest([{property_id:route.propertyId,room_type_id:route.roomTypeId,date,availability:1}],now-60000);
    const intent={id:'original',environment:'staging',property,connection:property,generation:1,version:1,days};
    const journal={format:1,commands:[{kind:'enqueue',intent,now:now-60000},{kind:'claim',id:'original',now:now-60000,leaseMs:30000},
      {kind:'dispatch',id:'original',token:'original:1',now:now-60000,request,context:{environment:'staging',property,connection:property,generation:1,version:1,digest:inventoryDigest(days),authority:'helm',enabled:true,complete:true,freshUntil:now}},
      {kind:'expire',now}]};
    const configuration={environment:'staging',topology:'single-unit',connection:property,listing:route.roomTypeId,generation:1,publishEnabled:false,
      timeZone:'America/New_York',start:date,end,requiredSources:['fixture'],coverage:[{source:'fixture',start:date,end,complete:true,observedAt:now-1000,freshUntil:now+1800000}]};
    await db.query('insert into helm_booking_inventory_consumers(property_id,configuration,plan_version,journal_version,journal) values($1,$2,1,4,$3)',[property,configuration,journal]);
    await db.query(`insert into helm_staging_inventory_routes(property_id,connection,generation,provider_property_id,room_type_id,rate_plan_id,property_title,rate_plan_title,adults,children,infants)
      values($1,$1,1,$2,$3,$4,$5,'TEST ONLY - Fixture',2,0,0)`,[property,route.propertyId,route.roomTypeId,uuid(3),route.propertyTitle]);
    let posts=0,count=0,timeout=false,loseReserve=false,loseOutcome=false;
    const rpcFetch=c=>async(input,init)=>{
      const u=new URL(String(input));assert.equal(u.origin,'https://jgkblfozftcvymvwhhii.supabase.co');
      const fn=u.pathname.split('/').at(-1), names=args[fn], body=JSON.parse(init.body);assert.ok(names);
      let result; try { result=(await c.query(`select public.${fn}(${names.map((_,i)=>'$'+(i+1)).join(',')}) value`,names.map(k=>body[k]))).rows[0].value; } catch(e) { console.error('Synthetic RPC failed:',fn,e.message); throw e; }
      if((fn==='helm_inventory_retry_reserve'&&loseReserve)||(fn==='helm_inventory_retry_update'&&loseOutcome))throw Error('Synthetic lost committed reply');
      return Response.json(result);
    };
    const store=c=>createReviewedRetryStore('https://jgkblfozftcvymvwhhii.supabase.co','fictional',property,'original',rpcFetch(c));
    const client=new ChannexAvailabilityClient('fictional',route,async(input,init)=>{
      const u=new URL(String(input));assert.equal(u.origin,'https://staging.channex.io');
      if(init.method==='POST'){
        posts++;assert.equal(init.body,request.body);
        const raw=(await db.query('select helm_inventory_retry_read($1) v',[property])).rows[0].v;
        assert.equal(raw.records[0].outcome,'submitting');assert.deepEqual(raw.state.journal,journal);
        if(timeout)throw Error('synthetic timeout');count=1;
        return Response.json({data:[{type:'task',id:uuid(4)}],meta:{message:'Success'}});
      }
      if(u.pathname.includes('/properties/'))return Response.json({data:{id:route.propertyId,attributes:{title:route.propertyTitle,currency:'USD',timezone:'America/New_York'}}});
      if(u.pathname.includes('/room_types/'))return Response.json({data:{id:route.roomTypeId,attributes:{count_of_rooms:1},relationships:{property:{data:{id:route.propertyId}}}}});
      if(u.pathname.endsWith('/channels'))return Response.json({data:[],meta:{total:0,page:1,limit:100}});
      if(u.pathname.includes('/tasks/')){
        const ts=new Date().toISOString();return Response.json({data:{id:uuid(4),type:'task',attributes:{id:uuid(4),task:'Property.UpdateAvailability',success:true,errors:[],channel_events:[],received_at:ts,executed_at:ts,finished_at:ts,payload:JSON.parse(request.body)}}});
      }
      assert.equal(u.pathname,'/api/v1/availability');return Response.json({data:{[route.roomTypeId]:{[date]:count}}});
    });
    const review={originalId:'original',originalToken:'original:1',requestDigest:request.digest,reviewedBy:'fixture@example.invalid',reason:'Synthetic local review',reviewedAt:now,expiresAt:now+60000};
    const base=store(db), run=()=>sendReviewedRetryOnce(base,client,review);
    async function candidate(c){const s=store(c);let captured;await sendReviewedRetryOnce({...s,reserve:async(expected,record)=>{captured={expected,record};return false;}},client,review);return {s,...captured};}
    return {property,journal,store,base,run,client,review,candidate,posts:()=>posts,
      timeout:()=>{timeout=true;},loseReserve:()=>{loseReserve=true;},loseOutcome:()=>{loseOutcome=true;}};
  }
  await check('recovery SQL: real adapter reserves before mocked POST and preserves original audit',async()=>{
    const f=await seed();assert.equal((await f.run()).status,'submitted');const s=await f.base.read();
    assert.equal((await checkReviewedRetry(f.base,f.client,s.records[0].id)).status,'verified');
    const rows=(await db.query('select record from helm_inventory_retry_events where property_id=$1 order by revision',[f.property])).rows;
    assert.deepEqual(rows.map(r=>r.record.outcome),['submitting','submitted','verified']);
    assert.deepEqual((await f.base.read()).journal,f.journal);await assert.rejects(f.run(),/already has/);assert.equal(f.posts(),1);
  });
  await db.exec(readFileSync(new URL('../docs/guesty-exit/staging-storage/inventory-support-resolution.sql',import.meta.url),'utf8'));
  await check('support resolution SQL: append-only retirement keeps publisher paused and original receipt absent', async()=>{
    const f=await seed(); await f.run(); const first=await f.base.read();
    await checkReviewedRetry(f.base,f.client,first.records[0].id);
    const snapshot=await f.base.read();
    const prepared=prepareSupportResolution(snapshot,{originalId:'original',requestDigest:f.review.requestDigest,
      supportMessage:'1a194f5fa29b4351',reviewedBy:'fixture@example.invalid'});
    const call=(version=prepared.expectedVersion,rev=snapshot.revision,journal=prepared.journal)=>db.query(
      'select helm_inventory_support_resolution($1,$2,$3,$4) v',[f.property,version,rev,journal]);
    assert.equal((await call(prepared.expectedVersion+1)).rows[0].v,false);
    assert.equal((await call(prepared.expectedVersion,snapshot.revision-1)).rows[0].v,false);
    await db.query("update helm_booking_inventory_consumers set configuration=jsonb_set(configuration,'{publishEnabled}','true'::jsonb) where property_id=$1",[f.property]);
    assert.equal((await call()).rows[0].v,false);
    await db.query("update helm_booking_inventory_consumers set configuration=jsonb_set(configuration,'{publishEnabled}','false'::jsonb) where property_id=$1",[f.property]);
    const nullTime=structuredClone(prepared.journal); nullTime.commands.at(-1).now=null;
    await assert.rejects(call(prepared.expectedVersion,snapshot.revision,nullTime),/explicit support/);
    for(const role of ['anon','authenticated']) {
      await a.query(`set role ${role}`);
      try { await assert.rejects(a.query('select helm_inventory_support_resolution($1,$2,$3,$4)',[f.property,prepared.expectedVersion,snapshot.revision,prepared.journal]),/permission denied/); }
      finally { await a.query('reset role'); }
    }
    const wrong=structuredClone(prepared.journal); wrong.commands.at(-1).retryTask='11111111-1111-4111-8111-111111111111';
    await assert.rejects(call(prepared.expectedVersion,snapshot.revision,wrong),/matching recovery/);
    const rewrite=structuredClone(prepared.journal); rewrite.commands[0].now++;
    await assert.rejects(call(prepared.expectedVersion,snapshot.revision,rewrite),/rewrite/);
    assert.equal((await call()).rows[0].v,true);
    assert.equal((await call()).rows[0].v,false);
    const stored=(await db.query('select journal,configuration from helm_booking_inventory_consumers where property_id=$1',[f.property])).rows[0];
    assert.deepEqual(stored.journal.commands.slice(0,-1),f.journal.commands);
    const retired=replayInventoryJournal(stored.journal).queue.list()[0];
    assert.equal(retired.status,'superseded'); assert.equal(retired.task,undefined);
    assert.equal(stored.configuration.publishEnabled,false); assert.equal(f.posts(),1);
  });
  await check('recovery SQL: concurrent reservation waits and loses without a duplicate',async()=>{
    const f=await seed(),x=await f.candidate(a),y=await f.candidate(b);
    await a.query('begin');assert.equal(await x.s.reserve(x.expected,x.record,Date.now()),true);
    const pending=y.s.reserve(y.expected,y.record,Date.now());await blocked(pending,pidB,pidA);
    await a.query('commit');assert.equal(await pending,false);assert.equal((await f.base.read()).records.length,1);
  });
  await check('recovery SQL: canonical source change wins against waiting reservation',async()=>{
    const f=await seed(),x=await f.candidate(b);
    await a.query('begin');await a.query('update property_rate_plans set advance_notice_hours=advance_notice_hours+1 where property_id=$1',[f.property]);
    const pending=x.s.reserve(x.expected,x.record,Date.now());await blocked(pending,pidB,pidA);
    await a.query('commit');assert.equal(await pending,false);assert.equal((await f.base.read()).records.length,0);
  });
  await check('recovery SQL: publisher re-enable wins against waiting reservation',async()=>{
    const f=await seed(),x=await f.candidate(b);
    await a.query('begin');await a.query("update helm_booking_inventory_consumers set configuration=jsonb_set(configuration,'{publishEnabled}','true') where property_id=$1",[f.property]);
    const pending=x.s.reserve(x.expected,x.record,Date.now());await blocked(pending,pidB,pidA);
    await a.query('commit');assert.equal(await pending,false);assert.equal(f.posts(),0);
  });
  await check('recovery SQL: lost committed reserve reply survives restart without sending',async()=>{
    const f=await seed();f.loseReserve();await assert.rejects(f.run());assert.equal(f.posts(),0);
    await assert.rejects(sendReviewedRetryOnce(f.store(db),f.client,f.review),/already has/);
    assert.equal((await f.base.read()).records[0].outcome,'submitting');
  });
  await check('recovery SQL: timeout remains separately uncertain and cannot retry again',async()=>{
    const f=await seed();f.timeout();assert.equal((await f.run()).status,'uncertain');
    await assert.rejects(f.run(),/already has/);assert.equal(f.posts(),1);assert.deepEqual((await f.base.read()).journal,f.journal);
  });
  await check('recovery SQL: lost outcome response is recoverable read-only',async()=>{
    const f=await seed();f.loseOutcome();await assert.rejects(f.run());
    assert.equal((await f.base.read()).records[0].outcome,'submitted');await assert.rejects(f.run(),/already has/);assert.equal(f.posts(),1);
  });
  await check('recovery SQL: malformed reservation and tampered adapter snapshot cannot reserve',async()=>{
    const f=await seed(),x=await f.candidate(db);
    const raw=(await db.query('select helm_inventory_retry_read($1) v',[f.property])).rows[0].v;
    const malformed=structuredClone(x.record);delete malformed.job.leaseUntil;
    await assert.rejects(db.query('select helm_inventory_retry_reserve($1,$2,$3)',[f.property,raw,malformed]),/Incomplete recovery/);
    x.expected.current.available=0;
    await assert.rejects(x.s.reserve(x.expected,x.record,Date.now()),/snapshot.*changed/);
    assert.equal((await f.base.read()).records.length,0);
  });
  await check('recovery SQL: outcome CAS refuses stale revision and request rewrite',async()=>{
    const f=await seed();await f.run();const s=await f.base.read(),prior=s.records[0],next=structuredClone(prior);
    next.outcome='verified';next.job.status='verified';next.job.request.body='{}';
    await assert.rejects(db.query('select helm_inventory_retry_update($1,$2,$3,$4)',[f.property,s.revision,prior,next]),/rewrite/);
    next.job.request=prior.job.request;
    assert.equal((await db.query('select helm_inventory_retry_update($1,$2,$3,$4) v',[f.property,s.revision-1,prior,next])).rows[0].v,false);
    assert.equal((await f.base.read()).records[0].outcome,'submitted');
  });
  await check('recovery SQL: reinstall leaves all recovery audit rows unchanged',async()=>{
    const before=(await db.query('select * from helm_inventory_retry_events order by property_id,revision')).rows;
    await db.exec(installation);
    assert.deepEqual((await db.query('select * from helm_inventory_retry_events order by property_id,revision')).rows,before);
  });
  await check('recovery SQL: service can use RPCs but cannot rewrite history; browsers cannot read',async()=>{
    const f=await seed();
    for(const role of ['anon','authenticated','service_role']){
      await a.query(`set role ${role}`);
      try{
        await assert.rejects(a.query('select * from helm_inventory_retry_events'),/permission denied/);
        await assert.rejects(a.query('delete from helm_inventory_retry_events'),/permission denied/);
        if(role==='service_role')assert.ok((await f.store(a).read()).current.workerPaused);
        else await assert.rejects(a.query('select helm_inventory_retry_read($1)',[f.property]),/permission denied/);
      }finally{await a.query('reset role');}
    }
    await assert.rejects(db.query('update helm_inventory_retry_events set retry_id=retry_id'),/append only/);
    await assert.rejects(db.query('truncate helm_inventory_retry_events'),/append only/);
  });
}
