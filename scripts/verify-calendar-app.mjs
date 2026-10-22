// Local PostgreSQL (PGlite) only. Uses the exact incremental SQL artifact,
// actual application column contracts, canonical RPCs and inventory planner.
// No browser claim, credentials, hosted DB, environment file or provider IO.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildCanonicalPilotInstall } from './build-canonical-pilot-install.mjs';
import { calendarAppQueries, buildCalendarAppPreflight } from './calendar-app-preflight.mjs';
import { consumeBookingInventory } from '../src/lib/channex-staging/booking-inventory-consumer.ts';
import { replayInventoryJournal } from '../src/lib/channex-staging/inventory-journal.ts';
import { buildHelmCalendarDays } from '../src/lib/helm-calendar-mirror.ts';
import { shapeRatePlan } from '../src/lib/property-rates.ts';
import { shiftIsoDay, todayInEastern } from '../src/lib/sca-quotes-types.ts';

if (process.argv.length !== 3) throw Error('Pass the installed PGlite module path');
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite(), p = 'HELMTEST-calderwood';
const patch = readFileSync(new URL('../docs/guesty-exit/staging-storage/calendar-app.sql', import.meta.url), 'utf8');
let passed = 0;
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const check = async (name, run) => { await run(); passed++; console.log('PASS ' + name); };
const rejectedPatch = async pattern => { await assert.rejects(db.exec(patch), pattern); await db.exec('rollback'); };
const asService = async fn => { await db.exec('set role service_role'); try { return await fn(); } finally { await db.exec('reset role'); } };
const now = Date.now(), start = shiftIsoDay(todayInEastern(new Date(now)), 15), end = shiftIsoDay(start, 8);
const configuration = { environment: 'staging', topology: 'single-unit', connection: 'local-calendar-test',
  listing: '22222222-2222-4222-8222-222222222222', generation: 1, publishEnabled: false,
  timeZone: 'America/New_York', start, end, requiredSources: ['local-fixture'],
  coverage: [{ source: 'local-fixture', start, end, complete: true, observedAt: now, freshUntil: now + 1800000 }] };
const read = async () => (await q('select helm_booking_inventory_read($1) state', [p]))[0].state;
const store = { property: p, read,
  commit: async (e,j,f,d) => (await q('select helm_booking_inventory_plan_commit($1,$2,$3,$4,$5,$6,$7,$8,$9) ok',
    [p,e.captureVersion,e.configurationVersion,e.planVersion,e.journalVersion,e.inputs,j,f,d]))[0].ok,
  journal: { read: async () => { const s=await read(); return {version:s.journalVersion,journal:s.journal}; },
    append: async () => { throw Error('Dispatch is outside this local test'); } } };
const planned = async () => {
  assert.equal((await consumeBookingInventory(store, Date.now)).status, 'queued');
  return replayInventoryJournal((await read()).journal).queue.list().at(-1);
};
const counts = async job => job.days.map(d => d.available);
const create = (ci,co) => asService(async () => (await q(`select * from helm_create_booking(
  $1,'block','manual','block',$2,$3,'{"hold_kind":"owner","notes":"Fictional calendar hold"}','local-test',false)`,[p,ci,co]))[0]);
try {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec('create schema helm_cleaner_rehearsal; create table helm_cleaner_rehearsal.delivery(id int);');
  const install = buildCanonicalPilotInstall();
  assert.equal(install.digest, '79762c13691b7285d76bcac51f4c45e30a41f29f6fd90e1bc02812fb324fa441', 'Review upgrade baseline if initial installer changes');
  await db.exec(install.sql);
  await q(`insert into properties(id,name,address,city,owner_last,owner_full,owner_greeting,management_fee_pct,calendar_authority)
    values($1,'Fictional calendar home','Fictional','Fictional','Fixture','Fixture','Fixture',0,'helm')`,[p]);
  await q('insert into helm_inventory_capture_scopes(property_id,enabled) values($1,true)',[p]);
  await q('insert into helm_booking_inventory_consumers(property_id,configuration) values($1,$2)',[p,configuration]);
  await q('insert into property_rate_plans(property_id,base_nightly_cents) values($1,12345)',[p]);
  await check('old isolated schema reproduces the ordinary calendar missing-column failure', async () => {
    await assert.rejects(q(calendarAppQueries()[0][1]), /does not exist/);
  });
  await check('upgrade refuses a wrong installation identity', async () => {
    await db.exec("update helm_pilot_installation.manifest set project_ref='wrong'");
    await rejectedPatch(/Reviewed isolated installation/);
    await db.exec("update helm_pilot_installation.manifest set project_ref='jgkblfozftcvymvwhhii'");
  });
  await check('upgrade refuses an unrelated property without adding any columns', async () => {
    await db.exec("insert into properties(id,name,address,city,owner_last,owner_full,owner_greeting,management_fee_pct) values('unrelated','Fictional','Fictional','Fictional','Fixture','Fixture','Fixture',0)");
    await rejectedPatch(/Paused fictional-only/);
    assert.equal((await q("select count(*)::int n from information_schema.columns where table_name='properties' and column_name='kind'"))[0].n,0);
    await db.exec("delete from properties where id='unrelated'");
  });
  for (const [name,enable,disable] of [
    ['property messages', "update properties set automations_enabled=true", "update properties set automations_enabled=false"],
    ['publisher', "update helm_booking_inventory_consumers set configuration=jsonb_set(configuration,'{publishEnabled}','true')", "update helm_booking_inventory_consumers set configuration=jsonb_set(configuration,'{publishEnabled}','false')"],
    ['channel connection', "insert into channel_listings(property_id,channel) values('HELMTEST-calderwood','airbnb')", 'delete from channel_listings'],
    ['message rule', "insert into message_automations(key,property_id,trigger,body,enabled) values('local-test','HELMTEST-calderwood','pre_arrival','Fictional',true)", "delete from message_automations where key='local-test'"],
  ]) await check('upgrade refuses active ' + name, async () => {
    await db.exec(enable); await rejectedPatch(/Paused fictional-only/); await db.exec(disable);
  });
  const before = await read(), ratesBefore = await q('select * from property_rate_plans');
  await check('upgrade is repeatable and preserves source, queue, pricing and installation receipt', async () => {
    await db.exec(patch); await db.exec(patch);
    assert.deepEqual(await read(), before);
    assert.deepEqual(await q('select * from property_rate_plans'), ratesBefore);
    assert.equal((await q('select bundle_digest from helm_pilot_installation.manifest'))[0].bundle_digest, install.digest);
  });
  await check('ordinary calendar reads all 13 contracts as the app service role', async () => {
    await db.exec(buildCalendarAppPreflight());
    await asService(async () => {
      const rows = await q(calendarAppQueries()[0][1]);
      assert.equal(rows.length,1); assert.equal(rows[0].id,p); assert.equal(rows[0].kind,'managed');
      for (const [,sql] of calendarAppQueries()) await q(sql);
    });
  });
  await check('property fields match the shared schema and invalid property kinds remain rejected', async () => {
    const types = Object.fromEntries((await q("select column_name,data_type from information_schema.columns where table_schema='public' and table_name='properties'")).map(r=>[r.column_name,r.data_type]));
    for (const col of ['default_checkin_time','default_checkout_time','quiet_hours','pet_policy','smoking_policy','cancellation_policy','house_rules','discount_stance']) assert.equal(types[col],'text',col);
    assert.equal(types.bedrooms,'integer'); assert.equal(types.bathrooms,'numeric'); assert.equal(types.max_occupancy,'integer');
    await assert.rejects(q("update properties set kind='unknown'"),/properties_kind_check/);
  });
  await check('browser roles gain no read or write access to calendar data', async () => {
    for (const role of ['anon','authenticated']) for (const table of ['properties','bookings','property_calendar_days','property_calendar_blocks']) {
      assert.equal((await q("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') allowed",[role,'public.'+table]))[0].allowed,false);
    }
  });
  // Test-only permission in a disposable DB. Nothing is dispatched and no
  // fixture coverage or publish setting is carried to the hosted pilot.
  await q("update helm_booking_inventory_consumers set configuration=jsonb_set(configuration,'{publishEnabled}','true') where property_id=$1",[p]);
  let hold;
  await check('ordinary create RPC captures one change and queues held nights', async () => {
    const v=(await read()).captureVersion;
    hold=await create(start,shiftIsoDay(start,2));
    assert.equal((await read()).captureVersion,v+1);
    assert.deepEqual(await counts(await planned()),[0,0,1,1,1,1,1,1]);
  });
  await check('ordinary overlap rejection leaves booking, audit, capture and queue unchanged', async () => {
    const state=await read(), audit=await q('select * from booking_events');
    await assert.rejects(asService(()=>q("select * from helm_create_booking($1,'manual','manual','confirmed',$2,$3,'{}','local-test',false)",[p,start,shiftIsoDay(start,1)])),/booking_overlap/);
    assert.deepEqual(await read(),state); assert.deepEqual(await q('select * from booking_events'),audit);
  });
  await check('ordinary move RPC releases old nights and queues the new hold', async () => {
    await asService(()=>q("select * from helm_move_booking($1,$2,$3,'block','local-test',false)",[hold.id,shiftIsoDay(start,3),shiftIsoDay(start,5)]));
    assert.deepEqual(await counts(await planned()),[1,1,1,0,0,1,1,1]);
  });
  await check('ordinary cancel RPC releases the hold without deleting its audit trail', async () => {
    await asService(()=>q("select * from helm_cancel_booking($1,'local-test','Local rehearsal complete')",[hold.id]));
    assert.deepEqual(await counts(await planned()),[1,1,1,1,1,1,1,1]);
    assert.equal((await q('select count(*)::int n from booking_events where booking_id=$1',[hold.id]))[0].n,3);
  });
  await check('calendar closure queues availability while price/minimum changes do not create a competing writer', async () => {
    await asService(()=>q('insert into property_rate_days(property_id,date,closed,nightly_cents,min_nights) values($1,$2,true,27800,4)',[p,start]));
    const job=await planned(); assert.deepEqual(await counts(job),[0,1,1,1,1,1,1,1]);
    for(const day of job.days) assert.deepEqual(Object.keys(day).sort(),['available','date','stopSell']);
    const v=(await read()).captureVersion;
    await asService(()=>q('update property_rate_days set nightly_cents=29900,min_nights=2 where property_id=$1',[p]));
    assert.equal((await read()).captureVersion,v);
  });
  await check('normal calendar mirror rows can be stored and released by the app service role', async () => {
    const plan=shapeRatePlan(ratesBefore[0]);
    const rows=buildHelmCalendarDays({propertyId:p,start,end:start,plan,rateDays:new Map(),rentalPeriods:[],bookings:[{
      id:hold.id,status:'block',check_in:start,check_out:shiftIsoDay(start,1),hold_kind:'owner',notes:'Fictional hold'}]});
    const row={...rows[0],synced_at:new Date().toISOString()}, fields=Object.keys(row);
    assert.equal(row.status,'unavailable');
    await asService(async()=>{
      await q(`insert into property_calendar_days(${fields.join(',')}) values(${fields.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));
      await q('insert into property_calendar_blocks(property_id,date) values($1,$2)',[p,start]);
      await q("update property_calendar_days set status='available',block_type=null where property_id=$1",[p]);
      await q('delete from property_calendar_blocks where property_id=$1',[p]);
    });
    assert.equal((await q('select count(*)::int n from property_calendar_blocks'))[0].n,0);
  });
  await check('no messages, provider attempts or finance values were created', async () => {
    assert.equal((await q('select count(*)::int n from automation_sends'))[0].n,0);
    assert.deepEqual(await q('select * from property_rate_plans'),ratesBefore);
    const jobs=replayInventoryJournal((await read()).journal).queue.list();
    assert.ok(jobs.every(j=>j.attempts===0 && !j.task && !j.request));
    assert.equal((await q('select gross_amount,payout from bookings where id=$1',[hold.id]))[0].gross_amount,null);
    assert.equal((await q('select gross_amount,payout from bookings where id=$1',[hold.id]))[0].payout,null);
  });
  console.log(`PASS: ${passed} local calendar schema/RPC/queue checks. Browser and hosted provider demonstration still required.`);
} catch(error) { console.error('FAIL:',error.message); process.exitCode=1; }
finally { await db.close(); }
