// Local PostgreSQL fixture only. No hosted database or provider connections.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { consumeBookingInventory } from '../src/lib/channex-staging/booking-inventory-consumer.ts';
import { shiftIsoDay, todayInEastern } from '../src/lib/sca-quotes-types.ts';
export async function verifyBookingInventoryRefresh(db, check) {
  const query=async(sql,args=[])=>(await db.query(sql,args)).rows;
  const sql=readFileSync(new URL('../docs/guesty-exit/staging-storage/booking-inventory-refresh.sql',import.meta.url),'utf8');
  await db.exec(sql);
  const property='refresh-home',stamp=Date.now(),start=shiftIsoDay(todayInEastern(new Date(stamp)),10),end=shiftIsoDay(start,7);
  const configuration={environment:'staging',topology:'single-unit',connection:'fictional-refresh',listing:'fictional-room',generation:1,
    publishEnabled:false,timeZone:'America/New_York',start,end,requiredSources:['canonical','channels'],coverage:['canonical','channels'].map(source=>
      ({source,start,end,complete:true,observedAt:stamp-1000,freshUntil:stamp+1800000}))};
  await query("insert into properties(id,name,address,city,owner_last,owner_full,owner_greeting,management_fee_pct,calendar_authority) values($1,'Fictional','Fictional','Fictional','Fixture','Fixture','Fixture',0,'helm')",[property]);
  await query('insert into property_rate_plans(property_id,base_nightly_cents,min_nights_default) values($1,10000,1)',[property]);
  await query('insert into helm_inventory_capture_scopes(property_id,enabled) values($1,true)',[property]);
  await query('insert into helm_booking_inventory_consumers(property_id,configuration) values($1,$2)',[property,configuration]);
  const read=async()=>(await query('select helm_booking_inventory_read($1) state',[property]))[0].state;
  const expected=s=>({captureVersion:s.captureVersion,configurationVersion:s.configurationVersion,planVersion:s.planVersion,journalVersion:s.journalVersion,inputs:s.inputs});
  const refresh=async(e,f,d)=>(await query('select helm_booking_inventory_plan_refresh($1,$2,$3,$4,$5,$6,$7,$8) ok',
    [property,e.captureVersion,e.configurationVersion,e.planVersion,e.journalVersion,e.inputs,f,d]))[0].ok;
  const store={property,read,refreshPlan:refresh,
    commit:async(e,j,f,d)=>(await query('select helm_booking_inventory_plan_commit($1,$2,$3,$4,$5,$6,$7,$8,$9) ok',
      [property,e.captureVersion,e.configurationVersion,e.planVersion,e.journalVersion,e.inputs,j,f,d]))[0].ok,
    journal:{read:async()=>{const s=await read();return {version:s.journalVersion,journal:s.journal};},append:async()=>{throw Error('No delivery in refresh fixture');}}};
  const run=()=>consumeBookingInventory(store,Date.now);
  const expire=()=>query('update helm_booking_inventory_consumers set planned_fresh_until=1 where property_id=$1',[property]);
  const transaction=async(fn)=>{await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}};
  const baseline=async()=>{await expire();return read();};
  await check('refresh RPC cannot initialize a plan and is service-only',async()=>{
    const s=await read();assert.equal(await refresh(expected(s),Date.now()+10000,'a'.repeat(64)),false);
    for(const role of ['anon','authenticated','service_role']) {
      const ok=(await query("select has_function_privilege($1,'public.helm_booking_inventory_plan_refresh(text,bigint,bigint,bigint,bigint,jsonb,bigint,text)','EXECUTE') ok",[role]))[0].ok;
      assert.equal(ok,role==='service_role');
    }
    assert.equal((await run()).status,'queued');
  });
  await check('real RPC refresh changes only plan deadline, retaining history, versions and source evidence',async()=>{
    const before=await baseline();await db.exec('set role service_role');
    try{assert.equal((await run()).status,'refreshed');}finally{await db.exec('reset role');}
    const after=await read();assert.ok(after.plannedFreshUntil>Date.now());
    assert.deepEqual({...after,plannedFreshUntil:before.plannedFreshUntil},before);
    assert.equal((await run()).status,'unchanged');
  });
  await check('refresh cannot change the digest, extend beyond a minute or regress a deadline',async()=>{
    const s=await baseline(),e=expected(s);
    for(const [deadline,digest] of [[Date.now()-1,s.lastDigest],[Date.now()+61000,s.lastDigest],[Date.now()+10000,'a'.repeat(64)],
      [Date.now()+10000,null],[null,s.lastDigest]]) {
      assert.equal(await refresh(e,deadline,digest),false);assert.deepEqual(await read(),s);
    }
    assert.equal(await refresh(e,Date.now()+10000,s.lastDigest),true);
    const after=await read();assert.equal(await refresh(e,after.plannedFreshUntil,s.lastDigest),false);
    assert.deepEqual(await read(),after);
  });
  await check('capture/configuration/input/journal races prevent stale refresh, including input round trips',async()=>{
    for(const mutate of [
      ()=>query("update property_rate_plans set advance_notice_hours=25 where property_id=$1",[property]),
      async()=>{await query("update property_rate_plans set advance_notice_hours=25 where property_id=$1",[property]);await query("update property_rate_plans set advance_notice_hours=24 where property_id=$1",[property]);},
      ()=>query("update helm_booking_inventory_consumers set configuration=jsonb_set(configuration,'{publishEnabled}','true') where property_id=$1",[property]),
      ()=>query('update helm_booking_inventory_consumers set journal_version=journal_version+1 where property_id=$1',[property])
    ]) await transaction(async()=>{
      const s=await baseline();await mutate();const after=await read();
      assert.equal(await refresh(expected(s),Date.now()+10000,s.lastDigest),false);assert.deepEqual(await read(),after);
    });
    const s=await baseline(),e=expected(s);e.inputs={...e.inputs,bookings:[{id:'fabricated'}]};
    assert.equal(await refresh(e,Date.now()+10000,s.lastDigest),false);assert.deepEqual(await read(),s);
  });
  await check('SQL independently rejects missing, duplicate, unknown, expired or overextended source coverage',async()=>{
    for(const mutate of [
      c=>{c.coverage=[];},c=>{c.coverage[0].complete=false;},c=>{c.coverage[0].observedAt=Date.now()+10000;},
      c=>{c.coverage[0].freshUntil=Date.now()+1000;},c=>{c.coverage[0].freshUntil=stamp+7200000;},
      c=>{c.coverage[0].end=start;},c=>{delete c.coverage[0].observedAt;},c=>{c.coverage[0].source='unknown';},
      c=>{c.coverage[0].source=c.coverage[1].source;},c=>{c.requiredSources=['canonical','canonical'];},
      c=>{c.requiredSources=[];},c=>{c.environment='production';},c=>{c.topology='linked';}
    ]) await transaction(async()=>{
      const c=structuredClone(configuration);mutate(c);
      await query('update helm_booking_inventory_consumers set configuration=$2 where property_id=$1',[property,c]);
      // Deliberately align checkpoints to exercise the SQL evidence guard itself.
      await query('update helm_booking_inventory_consumers set planned_configuration_version=configuration_version where property_id=$1',[property]);
      const s=await baseline();assert.equal(await refresh(expected(s),Date.now()+10000,s.lastDigest),false);assert.deepEqual(await read(),s);
    });
  });
  await check('lost RPC reply recovers without enqueue or journal rewrite',async()=>{
    const before=await baseline();store.refreshPlan=async(...args)=>{assert.equal(await refresh(...args),true);throw Error('Lost reply');};
    try{await assert.rejects(run,/Lost reply/);}finally{store.refreshPlan=refresh;}
    assert.equal((await run()).status,'unchanged');const after=await read();
    assert.deepEqual(after.journal,before.journal);assert.equal(after.planVersion,before.planVersion);
  });
  await check('failed refresh update rolls back and reinstall preserves the refreshed state',async()=>{
    const before=await baseline();
    await db.exec(`alter table helm_booking_inventory_consumers add constraint refuse_refresh_fixture check(property_id<>'${property}' or planned_fresh_until<=1)`);
    try{await assert.rejects(run,/refuse_refresh_fixture/);}finally{await db.exec('alter table helm_booking_inventory_consumers drop constraint refuse_refresh_fixture');}
    assert.deepEqual(await read(),before);assert.equal((await run()).status,'refreshed');
    const after=await read();await db.exec(sql);assert.deepEqual(await read(),after);
  });
}
