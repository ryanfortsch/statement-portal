// Local PostgreSQL behavior checks, called by verify-booking-inventory-events.mjs.
// Fictional records only; not a hosted migration or a multi-session lock test.
import assert from 'node:assert/strict';
export async function verifyAvailabilityInputCapture(db, check, captureSql) {
  const query = async (sql,args=[]) => (await db.query(sql,args)).rows;
  const version = async (p='input-home') => Number((await query('select version from helm_inventory_capture_scopes where property_id=$1',[p]))[0].version);
  const events = () => query("select * from helm_booking_inventory_events where property_id like 'input-%' order by property_id,version");
  await check('original candidate event constraints upgrade without rewriting booking history',async()=>{
    const before=await query('select * from helm_booking_inventory_events order by property_id,version');
    await db.exec(`alter table helm_booking_inventory_events drop constraint helm_booking_inventory_events_reason_check;
      alter table helm_booking_inventory_events add constraint helm_booking_inventory_events_reason_check
        check(reason in ('booking_insert','booking_update','booking_delete','capture_enabled','capture_disabled'));
      alter table helm_booking_inventory_events drop constraint helm_booking_inventory_events_check;
      alter table helm_booking_inventory_events add constraint helm_booking_inventory_events_check
        check((booking_id is null)=(reason in ('capture_enabled','capture_disabled')));`);
    await db.exec(captureSql);
    assert.deepEqual(await query('select * from helm_booking_inventory_events order by property_id,version'),before);
  });
  await db.exec(`insert into properties(id,name,address,city,owner_last,owner_full,owner_greeting,management_fee_pct)
    select id,'Fictional input home','Fictional address','Fictional city','Fixture','Fixture','Fixture',0
      from (values('input-home'),('input-other'),('input-disabled'),('input-unscoped')) fixtures(id);
    insert into helm_inventory_capture_scopes(property_id,enabled) values('input-home',true),('input-other',true),('input-disabled',false);`);
  await check('availability rule insert and every projected rule update advance capture',async()=>{
    let v=await version();
    await query("insert into property_rate_plans(property_id,base_nightly_cents) values('input-home',0)");assert.equal(await version(),++v);
    for(const sql of [
      "update property_rate_plans set advance_notice_hours=48 where property_id='input-home'",
      "update property_rate_plans set booking_window_days=180 where property_id='input-home'",
      "update property_rate_plans set turnover_buffer_days=1 where property_id='input-home'",
      "update property_rate_plans set checkin_time='17:00' where property_id='input-home'",
    ]){await db.exec(sql);assert.equal(await version(),++v);}
    assert.equal((await events()).filter(e=>e.property_id==='input-home').at(-1).reason,'availability_rules_update');
  });
  await check('PriceLabs prices, minimum stays, other quote fields and repeated writes do not enqueue',async()=>{
    const v=await version();
    await db.exec(`update property_rate_plans set base_nightly_cents=12345,min_nights_default=8,max_nights=40,
      checkout_time='12:00',house_rules='Fictional private note',updated_at=now() where property_id='input-home';
      update property_rate_plans set advance_notice_hours=advance_notice_hours where property_id='input-home';`);
    assert.equal(await version(),v);
  });
  await check('rule move and deletion invalidate old and new property scopes',async()=>{
    const a=await version(),b=await version('input-other');
    await db.exec("update property_rate_plans set property_id='input-other' where property_id='input-home'");
    assert.equal(await version(),a+1);assert.equal(await version('input-other'),b+1);
    await db.exec("delete from property_rate_plans where property_id='input-other'");
    assert.equal(await version('input-other'),b+2);
  });
  await check('date closures capture inserts, rekeys, closed flags, transfers and deletes',async()=>{
    let v=await version();const other=await version('input-other');
    await db.exec("insert into property_rate_days(property_id,date) values('input-home','2027-06-01')");assert.equal(await version(),++v);
    await db.exec("update property_rate_days set closed=true where property_id='input-home'");assert.equal(await version(),++v);
    await db.exec("update property_rate_days set date='2027-06-02' where property_id='input-home'");assert.equal(await version(),++v);
    await db.exec("update property_rate_days set property_id='input-other' where property_id='input-home'");
    assert.equal(await version(),++v);assert.equal(await version('input-other'),other+1);
    await db.exec("delete from property_rate_days where property_id='input-other'");assert.equal(await version('input-other'),other+2);
  });
  await check('price-only date upserts do not invalidate availability',async()=>{
    await db.exec("insert into property_rate_days(property_id,date,closed) values('input-home','2027-07-01',true)");
    const v=await version();
    await db.exec(`insert into property_rate_days(property_id,date,nightly_cents,min_nights,source) values('input-home','2027-07-01',32100,5,'pricelabs')
      on conflict(property_id,date) do update set nightly_cents=excluded.nightly_cents,min_nights=excluded.min_nights,source=excluded.source;
      update property_rate_days set closed=closed,cta=true,ctd=true,note='Fictional private note',updated_at=now() where property_id='input-home';`);
    assert.equal(await version(),v);
  });
  await check('rental seasons capture boundaries and removal but ignore notes and timestamps',async()=>{
    let v=await version();
    await db.exec("insert into property_rental_periods(property_id,start_month,start_day,end_month,end_day) values('input-home',5,1,10,31)");
    assert.equal(await version(),++v);
    for(const assignment of ['start_month=6','start_day=2','end_month=11','end_day=30']){
      await db.exec(`update property_rental_periods set ${assignment} where property_id='input-home'`);assert.equal(await version(),++v);
    }
    await db.exec("update property_rental_periods set note='Fictional private note',updated_at=now() where property_id='input-home'");assert.equal(await version(),v);
    const other=await version('input-other');
    await db.exec("update property_rental_periods set property_id='input-other' where property_id='input-home'");
    assert.equal(await version(),++v);assert.equal(await version('input-other'),other+1);
    await db.exec("delete from property_rental_periods where property_id='input-other'");assert.equal(await version('input-other'),other+2);
  });
  await check('authority changes invalidate a plan without capturing unrelated property edits',async()=>{
    const v=await version();
    await db.exec("update properties set calendar_authority='helm' where id='input-home'");assert.equal(await version(),v+1);
    await db.exec("update properties set calendar_authority='helm',name='Another Fictional Name' where id='input-home'");assert.equal(await version(),v+1);
    assert.equal((await events()).filter(e=>e.property_id==='input-home').at(-1).reason,'authority_update');
  });
  await check('disabled and absent scopes retain ordinary non-booking edits; enable checkpoints them',async()=>{
    for(const property of ['input-disabled','input-unscoped']){
      await query('insert into property_rate_plans(property_id,base_nightly_cents) values($1,0)',[property]);
      await query("insert into property_rate_days(property_id,date,closed) values($1,'2027-08-01',true)",[property]);
      await query('insert into property_rental_periods(property_id,start_month,start_day,end_month,end_day) values($1,5,1,10,31)',[property]);
      await query("update properties set calendar_authority='helm' where id=$1",[property]);
    }
    assert.equal(await version('input-disabled'),0);
    assert.equal((await events()).filter(e=>['input-disabled','input-unscoped'].includes(e.property_id)).length,0);
    await db.exec("update helm_inventory_capture_scopes set enabled=true where property_id='input-disabled'");
    assert.equal(await version('input-disabled'),1);
  });
  await check('failed non-booking capture rolls back the source edit and version together',async()=>{
    for(const [reason,statement,readSource] of [
      ['authority_update',"update properties set calendar_authority='guesty' where id='input-home'","select calendar_authority from properties where id='input-home'"],
      ['availability_rules_insert',"insert into property_rate_plans(property_id,base_nightly_cents) values('input-home',0)","select property_id from property_rate_plans where property_id='input-home'"],
      ['closed_date_update',"update property_rate_days set closed=false where property_id='input-home'","select date,closed from property_rate_days where property_id='input-home'"],
      ['rental_period_insert',"insert into property_rental_periods(property_id,start_month,start_day,end_month,end_day) values('input-home',1,1,12,31)","select id from property_rental_periods where property_id='input-home'"],
    ]){
      const v=await version(),before=await query(readSource),history=await events();
      await db.exec(`alter table helm_booking_inventory_events add constraint test_input_failure check(property_id<>'input-home' or reason<>'${reason}') not valid`);
      try{
        await assert.rejects(()=>db.exec(statement),/test_input_failure/);
        assert.equal(await version(),v);assert.deepEqual(await query(readSource),before);assert.deepEqual(await events(),history);
      }finally{await db.exec('alter table helm_booking_inventory_events drop constraint test_input_failure');}
    }
  });
  await check('failed multi-property closure batch rolls back all rows and all invalidations',async()=>{
    await db.exec("insert into property_rate_days(property_id,date,closed) values('input-other','2027-07-01',true)");
    const a=await version(),b=await version('input-other');
    await db.exec("alter table helm_booking_inventory_events add constraint test_input_batch_failure check(property_id<>'input-other' or reason<>'closed_date_update') not valid");
    try{
      await assert.rejects(()=>db.exec("update property_rate_days set closed=false where property_id in ('input-home','input-other')"),/test_input_batch_failure/);
      assert.equal(await version(),a);assert.equal(await version('input-other'),b);
      assert.ok((await query("select closed from property_rate_days where property_id in ('input-home','input-other')")).every(r=>r.closed));
    }finally{await db.exec('alter table helm_booking_inventory_events drop constraint test_input_batch_failure');}
  });
  await check('ordinary source capture holds no global configuration ShareLock',async()=>{
    await db.exec('begin');
    try{
      await db.exec("update property_rate_days set closed=false where property_id='input-home'");
      const locks=await query("select mode from pg_locks where relation='public.property_rate_days'::regclass and pid=pg_backend_pid() and granted");
      assert.ok(locks.some(r=>r.mode==='RowExclusiveLock'));assert.ok(!locks.some(r=>r.mode==='ShareLock'));
    }finally{await db.exec('rollback');}
  });
  await check('TRUNCATE cannot bypass enabled source capture',async()=>{
    for(const table of ['bookings','property_rate_plans','property_rate_days','property_rental_periods']){
      await assert.rejects(()=>db.exec(`truncate ${table} cascade`),/Cannot truncate inventory sources/);
    }
    const guards=await query("select tgrelid::regclass::text name from pg_trigger where tgname='helm_inventory_source_no_truncate' and tgenabled='O'");
    assert.deepEqual(guards.map(r=>r.name).sort(),['bookings','properties','property_rate_days','property_rate_plans','property_rental_periods'].sort());
  });
  await check('new capture functions are private and input events contain no source payload',async()=>{
    await db.exec('set role service_role');
    try{
      for(const fn of ['helm_capture_availability_input_change','helm_inventory_source_no_truncate']){
        await assert.rejects(()=>db.exec(`select ${fn}()`),/permission denied/);
      }
    }finally{await db.exec('reset role');}
    const all=await events();assert.ok(all.length>10);
    assert.ok(all.filter(e=>!e.reason.startsWith('booking_')).every(e=>e.booking_id===null));
    assert.doesNotMatch(JSON.stringify(all),/Fictional|nightly_cents|min_nights|checkin_time|32100/);
  });
  await check('reinstallation preserves input history and captures each change only once',async()=>{
    const before=await events(),v=await version();await db.exec(captureSql);assert.deepEqual(await events(),before);
    await db.exec("update property_rate_days set closed=false where property_id='input-home'");assert.equal(await version(),v+1);
  });
}
