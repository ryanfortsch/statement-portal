// Local integration extension, invoked by verify-booking-inventory-events.mjs.
// Uses real candidate RPCs and the TypeScript planner/worker with fictional data.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { consumeBookingInventory, bookingInventoryDispatchContext } from '../src/lib/channex-staging/booking-inventory-consumer.ts';
import { prepareInventoryDispatch } from '../src/lib/channex-staging/inventory-worker.ts';
import { replayInventoryJournal, recordInventoryCommand } from '../src/lib/channex-staging/inventory-journal.ts';
import { shiftIsoDay, todayInEastern } from '../src/lib/sca-quotes-types.ts';
export async function verifyBookingInventoryConsumer(db, check, rateSchema) {
  const query = async (sql,args=[]) => (await db.query(sql,args)).rows;
  await db.exec(rateSchema);
  await db.exec('create table property_rental_periods(property_id text,start_month int,start_day int,end_month int,end_day int)');
  const sql = readFileSync(new URL('../docs/guesty-exit/staging-storage/booking-inventory-planning.sql',import.meta.url),'utf8');
  await db.exec(sql);
  const read = async () => (await query("select helm_booking_inventory_read('home') as state"))[0].state;
  const stamp=Date.now(),start=shiftIsoDay(todayInEastern(new Date(stamp)),10),end=shiftIsoDay(start,8);
  const config={environment:'staging',topology:'single-unit',connection:'fixture',listing:'room',generation:1,publishEnabled:false,
    timeZone:'America/New_York',start,end,requiredSources:['canonical','channels'],coverage:['canonical','channels'].map(source=>
      ({source,start,end,complete:true,observedAt:stamp-1000,freshUntil:stamp+1800000}))};
  const append=async(v,j)=>(await query('select helm_booking_inventory_journal_append($1,$2,$3) ok',['home',v,j]))[0].ok;
  const store={property:'home',read,commit:async(e,j,f,d)=>(await query('select helm_booking_inventory_plan_commit($1,$2,$3,$4,$5,$6,$7,$8,$9) ok',
    ['home',e.captureVersion,e.configurationVersion,e.planVersion,e.journalVersion,e.inputs,j,f,d]))[0].ok,
    journal:{read:async()=>{const s=await read();return {version:s.journalVersion,journal:s.journal};},append}};
  const run=()=>consumeBookingInventory(store,Date.now);
  const jobs=async()=>replayInventoryJournal((await read()).journal).queue.list();
  const create=async(from,to)=>(await query("select * from helm_create_booking('home','manual','manual','block',$1,$2,'{\"hold_kind\":\"owner\"}','fixture',false)",[from,to]))[0];
  await check('consumer read does not initialize an absent route',async()=>{assert.equal(await read(),null);});
  await query("insert into property_rate_plans(property_id,base_nightly_cents,min_nights_default) values('home',99999,9)");
  await query('insert into helm_booking_inventory_consumers(property_id,configuration) values($1,$2)',['home',config]);
  await check('canonical SQL snapshot excludes guest and PriceLabs fields',async()=>{
    const s=await read();assert.equal(s.inputs.authority,'guesty');
    assert.doesNotMatch(JSON.stringify(s.inputs),/guest_name|guest_email|nightly|min_nights|gross_amount|house_rules/);
    assert.equal(s.inputs.plan.advance_notice_hours,24);
  });
  await check('real SQL planning atomically records queue and capture checkpoint once',async()=>{
    await db.exec('set role service_role');
    assert.equal((await run()).status,'queued');assert.equal((await run()).status,'unchanged');
    await db.exec('reset role');
    const s=await read();assert.equal(s.plannedCaptureVersion,s.captureVersion);assert.equal(s.planVersion,1);assert.equal(s.journalVersion,1);
    assert.ok((await jobs())[0].days.every(d=>d.available===1));
  });
  let hold;
  await check('canonical create and move reach the real durable inventory queue',async()=>{
    hold=await create(shiftIsoDay(start,1),shiftIsoDay(start,3));assert.equal((await run()).status,'queued');
    assert.deepEqual((await jobs()).at(-1).days.map(d=>d.available),[1,0,0,1,1,1,1,1]);
    await query("select helm_move_booking($1,$2,$3,'block','fixture',false)",[hold.id,shiftIsoDay(start,3),shiftIsoDay(start,5)]);
    assert.equal((await run()).status,'queued');assert.deepEqual((await jobs()).at(-1).days.map(d=>d.available),[1,1,1,0,0,1,1,1]);
  });
  await check('a booking committed during calculation prevents stale queue and checkpoint writes',async()=>{
    await create(shiftIsoDay(start,5),shiftIsoDay(start,6));
    const before=await read(),commit=store.commit;
    store.commit=async(...args)=>{await create(shiftIsoDay(start,6),shiftIsoDay(start,7));return commit(...args);};
    try{assert.equal((await run()).status,'superseded');}finally{store.commit=commit;}
    const after=await read();assert.equal(after.planVersion,before.planVersion);assert.equal(after.journalVersion,before.journalVersion);
    assert.equal(after.plannedCaptureVersion,before.plannedCaptureVersion);assert.ok(after.captureVersion>before.captureVersion);
    assert.equal((await run()).status,'queued');
  });
  await check('rate-day or mapping-configuration changes before commit reject a stale plan',async()=>{
    for(const mutate of [
      ()=>query("insert into property_rate_days(property_id,date,closed) values('home',$1,true)",[start]),
      ()=>query("update helm_booking_inventory_consumers set configuration=jsonb_set(configuration,'{publishEnabled}','true') where property_id='home'")
    ]){
      await create(start,shiftIsoDay(start,1));const before=await read(),commit=store.commit;
      store.commit=async(...args)=>{await mutate();return commit(...args);};
      try{assert.equal((await run()).status,'superseded');}finally{store.commit=commit;}
      const after=await read();assert.equal(after.journalVersion,before.journalVersion);assert.equal(after.planVersion,before.planVersion);
      assert.equal((await run()).status,'queued');
    }
  });
  await check('lost SQL response after commit recovers by reread without repeating the enqueue',async()=>{
    await query("select helm_cancel_booking($1,'fixture','fixture')",[hold.id]);const commit=store.commit;
    store.commit=async(...args)=>{await commit(...args);throw new Error('response lost after commit');};
    try{await assert.rejects(run,/response lost/);}finally{store.commit=commit;}
    const before=await read();assert.equal((await run()).status,'unchanged');assert.equal((await read()).journalVersion,before.journalVersion);
  });
  await check('checkpoint failure rolls back the already appended queue command',async()=>{
    await create(start,shiftIsoDay(start,1));const before=await read();
    await db.exec(`alter table helm_booking_inventory_consumers add constraint test_plan_failure check(plan_version<=${before.planVersion})`);
    try{await assert.rejects(run,/test_plan_failure/);}finally{await db.exec('alter table helm_booking_inventory_consumers drop constraint test_plan_failure');}
    const after=await read();assert.equal(after.journalVersion,before.journalVersion);assert.deepEqual(after.journal,before.journal);
    assert.equal(after.plannedCaptureVersion,before.plannedCaptureVersion);assert.equal((await run()).status,'queued');
  });
  await check('SQL refuses a price field, missing availability and history rewrite',async()=>{
    const s=await read(),base=replayInventoryJournal(s.journal).journal;
    const command=structuredClone(base.commands.at(-1));command.intent.version=s.planVersion+1;command.intent.id+='-next';
    const expected={captureVersion:s.captureVersion,configurationVersion:s.configurationVersion,planVersion:s.planVersion,journalVersion:s.journalVersion,inputs:s.inputs};
    for(const invalid of [d=>{d.price=123;},d=>{delete d.available;delete d.stopSell;}]){
      const c=structuredClone(command);invalid(c.intent.days[0]);
      await assert.rejects(()=>store.commit(expected,{...base,commands:[...base.commands,c]},Date.now()+10000,s.lastDigest),/availability-only/);
    }
    const rewritten=structuredClone(base);rewritten.commands[0].now++;rewritten.commands.push(command);
    await assert.rejects(()=>store.commit(expected,rewritten,Date.now()+10000,s.lastDigest),/history rewrite/);
  });
  await check('Guesty authority cannot cross the SQL submitting barrier',async()=>{
    const s=await read(),j=replayInventoryJournal(s.journal).journal,job=(await jobs()).at(-1);
    const context={environment:'staging',property:'home',connection:'fixture',generation:1,version:s.planVersion,
      digest:s.lastDigest,enabled:true,complete:true,authority:'helm',freshUntil:s.plannedFreshUntil};
    assert.equal(await append(s.journalVersion,{...j,commands:[...j.commands,{kind:'dispatch',id:job.id,token:'forged',context,now:Date.now()}]}),false);
    assert.equal((await read()).journalVersion,s.journalVersion);
  });
  await check('a booking arriving after context refresh prevents the SQL submitting transition',async()=>{
    await query("update properties set calendar_authority='helm' where id='home'");
    await create(start,shiftIsoDay(start,1));assert.equal((await run()).status,'queued');
    const job=(await jobs()).at(-1);
    const prepared=await prepareInventoryDispatch(store.journal,job.id,Date.now,5000,async j=>{
      const context=await bookingInventoryDispatchContext(store,j,Date.now);
      await create(start,shiftIsoDay(start,1));return context;
    });
    assert.equal(prepared,null);assert.equal((await jobs()).at(-1).status,'leased');
    // Simulate lease timeout without sleeping or touching an external provider.
    await recordInventoryCommand(store.journal,{kind:'expire',now:Date.now()+6000});
  });
  await check('current Helm authority reaches the existing durable worker submitting barrier',async()=>{
    // Fictional local property only. No production cutover or provider call.
    await query("update properties set calendar_authority='helm' where id='home'");
    await create(start,shiftIsoDay(start,1));assert.equal((await run()).status,'queued');
    const job=(await jobs()).at(-1);
    const prepared=await prepareInventoryDispatch(store.journal,job.id,Date.now,5000,j=>bookingInventoryDispatchContext(store,j,Date.now));
    assert.equal(prepared.status,'submitting');assert.equal((await jobs()).at(-1).status,'submitting');
  });
  await check('interrupted dispatch blocks newer work instead of blindly resending',async()=>{
    await recordInventoryCommand(store.journal,{kind:'expire',now:Date.now()+6000});
    assert.equal((await jobs()).at(-1).status,'uncertain');
    await create(start,shiftIsoDay(start,1));assert.equal((await run()).status,'queued');
    const job=(await jobs()).at(-1);
    assert.equal(await prepareInventoryDispatch(store.journal,job.id,Date.now,5000,j=>bookingInventoryDispatchContext(store,j,Date.now)),null);
    assert.deepEqual((await jobs()).slice(-2).map(j=>j.status),['uncertain','pending']);
  });
  await check('consumer role restrictions and idempotent installation preserve pending work',async()=>{
    const before=await read();await db.exec(sql);assert.deepEqual(await read(),before);
    await db.exec('set role service_role');
    await assert.rejects(()=>query("update helm_booking_inventory_consumers set journal='{}'"),/permission denied/);
    await assert.rejects(()=>query("select helm_booking_inventory_inputs('home')"),/permission denied/);
    await db.exec('reset role; set role anon');await assert.rejects(read,/permission denied/);await db.exec('reset role');
  });
}
