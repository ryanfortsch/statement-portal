// Local PostgreSQL only. The hosted installation remains disabled.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { rollingInventoryWindow, advanceInventoryWindow } from '../src/lib/channex-staging/booking-inventory-window.ts';
import { consumeBookingInventory, bookingInventoryDispatchContext } from '../src/lib/channex-staging/booking-inventory-consumer.ts';
import { replayInventoryJournal } from '../src/lib/channex-staging/inventory-journal.ts';
import { shiftIsoDay } from '../src/lib/sca-quotes-types.ts';
export async function verifyBookingInventoryWindow(db,check) {
  const sql=readFileSync(new URL('../docs/guesty-exit/staging-storage/booking-inventory-window.sql',import.meta.url),'utf8');
  await db.exec(sql);
  const query=async(s,a=[])=>(await db.query(s,a)).rows;
  const property='HELMTEST-calderwood',stamp=Date.now(),target=rollingInventoryWindow(stamp);
  const config={environment:'staging',topology:'single-unit',connection:'calderwood-hosted-inventory',
    listing:'f795ae2c-f47d-4751-86ff-e883b6d30800',generation:1,publishEnabled:true,timeZone:'America/New_York',
    start:shiftIsoDay(target.start,-1),end:shiftIsoDay(target.end,-1),requiredSources:['synthetic-canonical'],
    coverage:[{source:'synthetic-canonical',start:shiftIsoDay(target.start,-2),end:shiftIsoDay(target.end,1),
      complete:true,observedAt:stamp-1000,freshUntil:stamp+1800000}]};
  await query("insert into properties(id,name,address,city,owner_last,owner_full,owner_greeting,management_fee_pct,calendar_authority) values($1,'Fictional','Fictional','Fictional','Fixture','Fixture','Fixture',0,'helm')",[property]);
  await query("insert into property_rate_plans(property_id,base_nightly_cents,min_nights_default,booking_window_days) values($1,10000,1,365)",[property]);
  await query('insert into helm_inventory_capture_scopes(property_id,enabled) values($1,true)',[property]);
  await query('insert into helm_booking_inventory_consumers(property_id,configuration) values($1,$2)',[property,config]);
  const read=async()=>(await query('select helm_booking_inventory_read($1) state',[property]))[0].state;
  const advance=async(e,start,end,j)=>(await query('select helm_booking_inventory_window_advance($1,$2,$3,$4,$5,$6,$7,$8,$9) ok',
    [property,e.captureVersion,e.configurationVersion,e.planVersion,e.journalVersion,e.inputs,start,end,j]))[0].ok;
  const store={property,read,advanceWindow:advance,
    commit:async(e,j,f,d)=>(await query('select helm_booking_inventory_plan_commit($1,$2,$3,$4,$5,$6,$7,$8,$9) ok',
      [property,e.captureVersion,e.configurationVersion,e.planVersion,e.journalVersion,e.inputs,j,f,d]))[0].ok,
    journal:{read:async()=>{const s=await read();return {version:s.journalVersion,journal:s.journal};},
      append:async(v,j)=>(await query('select helm_booking_inventory_journal_append($1,$2,$3) ok',[property,v,j]))[0].ok}};
  const run=async()=>advanceInventoryWindow(store,await read(),Date.now());
  const transaction=async(fn)=>{await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}};
  const resetConfig=async(c)=>query('update helm_booking_inventory_consumers set configuration=$2 where property_id=$1',[property,c]);
  await check('year rollover permission is service-only and cannot initialize or edit another property',async()=>{
    for(const role of ['anon','authenticated','service_role']) {
      const x=(await query("select has_function_privilege($1,'public.helm_booking_inventory_window_advance(text,bigint,bigint,bigint,bigint,jsonb,date,date,jsonb)','EXECUTE') ok",[role]))[0].ok;
      assert.equal(x,role==='service_role');
    }
    assert.equal((await query("select helm_booking_inventory_window_advance('other',1,1,0,0,'{}',current_date,current_date+366,'{}') ok"))[0].ok,false);
  });
  await check('SQL refuses missing, expired, incomplete, extended or short coverage before any window mutation',async()=>{
    for(const mutate of [
      c=>{c.coverage=[];},c=>{c.coverage[0].complete=false;},c=>{c.coverage[0].freshUntil=Date.now()-1;},
      c=>{c.coverage[0].end=c.end;},c=>{c.coverage[0].freshUntil=stamp+7200000;},
      c=>{c.publishEnabled=false;},c=>{c.requiredSources=['unknown'];}
    ]) await transaction(async()=>{
      const c=structuredClone(config);mutate(c);await resetConfig(c);
      const s=await read(),j={...s.journal,commands:[...s.journal.commands,{kind:'retire-pending',property,connection:c.connection,generation:1}]};
      assert.equal(await advance({captureVersion:s.captureVersion,configurationVersion:s.configurationVersion,planVersion:s.planVersion,
        journalVersion:s.journalVersion,inputs:s.inputs},target.start,target.end,j),false);
      assert.deepEqual(await read(),s);
    });
  });
  await check('booking or policy races invalidate the rollover CAS even when dates remain unchanged',async()=>{
    for(const mutate of [
      ()=>query("insert into property_rate_days(property_id,date,closed) values($1,$2,true)",[property,target.start]),
      ()=>query("update property_rate_plans set advance_notice_hours=25 where property_id=$1",[property]),
      ()=>resetConfig({...config,publishEnabled:false})
    ]) await transaction(async()=>{
      const before=await read();await mutate();
      assert.equal((await advanceInventoryWindow(store,before,Date.now())).status,'superseded');
      assert.equal((await read()).configuration.start,config.start);assert.equal((await read()).journalVersion,0);
    });
  });
  await check('partial commit failure rolls back both window and retired pending work',async()=>{
    await transaction(async()=>{
      assert.equal((await consumeBookingInventory(store,Date.now)).status,'queued');
      const before=await read();
      await db.exec(`alter table helm_booking_inventory_consumers add constraint reject_window_fixture check(property_id<>'${property}' or configuration_version<=${before.configurationVersion})`);
      await assert.rejects(run,/reject_window_fixture/);
      // PostgreSQL aborts the failed transaction: its rollback is the assertion
      // boundary; the next check confirms durable state stayed at its baseline.
    });
    assert.equal((await read()).journalVersion,0);assert.equal((await read()).configuration.start,config.start);
  });
  await check('whole-year rollover retires old pending work and reads the previously unseen edge closure',async()=>{
    // This last date is outside the OLD rate-day query.
    await query('insert into property_rate_days(property_id,date,closed) values($1,$2,true)',[property,shiftIsoDay(target.end,-1)]);
    assert.equal((await consumeBookingInventory(store,Date.now)).status,'queued');
    const before=await read(),oldJob=replayInventoryJournal(before.journal).queue.list().at(-1);
    assert.equal(before.inputs.rateDays.length,0);
    await db.exec('set role service_role');
    try{assert.equal((await run()).status,'advanced');}finally{await db.exec('reset role');}
    const after=await read();
    assert.equal(after.configurationVersion,before.configurationVersion+1);
    assert.equal(after.journalVersion,before.journalVersion+1);
    assert.deepEqual(after.configuration.coverage,before.configuration.coverage);
    assert.equal(replayInventoryJournal(after.journal).queue.list()[0].status,'superseded');
    assert.equal(after.inputs.rateDays[0].date,shiftIsoDay(target.end,-1));
    assert.equal((await bookingInventoryDispatchContext(store,oldJob,Date.now)).complete,false);
    assert.equal((await consumeBookingInventory(store,Date.now)).status,'queued');
    const job=replayInventoryJournal((await read()).journal).queue.list().at(-1);
    assert.equal(job.days.length,366);assert.equal(job.days.at(-1).available,0);
    assert.equal(job.days[100].available,1);
    assert.equal((await run()).status,'current');
  });
  await check('candidate reinstallation preserves the full-year cursor, history and coverage',async()=>{
    const before=await read();await db.exec(sql);assert.deepEqual(await read(),before);
  });
}
