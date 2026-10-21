import { verifyBookingInventoryCapacity } from './verify-booking-inventory-capacity.mjs';
import { verifyCanonicalSourceDatabase } from './verify-canonical-source.mjs';
import { verifyBookingInventoryRefresh } from './verify-booking-inventory-refresh.mjs';
import { verifyCanonicalRevisions } from './verify-canonical-revisions.mjs';
// Usage: node scripts/verify-booking-inventory-concurrency.mjs /path/to/pg/bin /path/to/pg/lib/index.js
// Owns a NEW temporary PostgreSQL cluster. No connection string/env database,
// TCP listener, hosted data, provider calls, or application dependency required.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { verifyBookingInventorySchema } from './verify-booking-inventory-schema.mjs';
import { installBookingInventoryFixture } from './booking-inventory-fixture.mjs';
import { consumeBookingInventory, bookingInventoryDispatchContext } from '../src/lib/channex-staging/booking-inventory-consumer.ts';
import { replayInventoryJournal, recordInventoryCommand } from '../src/lib/channex-staging/inventory-journal.ts';
import { inventoryDigest } from '../src/lib/channex-staging/inventory-outbox.ts';
import { shiftIsoDay, todayInEastern } from '../src/lib/sca-quotes-types.ts';
if(process.argv.length!==4)throw new Error('Pass PostgreSQL binary directory and pg client module path');
const bin=resolve(process.argv[2]),pg=await import(pathToFileURL(resolve(process.argv[3])).href);
const Client=pg.Client??pg.default?.Client;
if(typeof Client!=='function')throw new Error('Expected a node-postgres client module');
// A short path avoids the Unix socket path-length limit on macOS.
const root=mkdtempSync('/tmp/helm-pg-race-'),data=join(root,'data'),socket=join(root,'socket');
mkdirSync(socket,{mode:0o700});
const clients=[];let server;let stopped=false;let passed=0;
const now=Date.now(),start=shiftIsoDay(todayInEastern(new Date(now)),15),end=shiftIsoDay(start,3);
const config={environment:'staging',topology:'single-unit',connection:'fixture',listing:'22222222-2222-4222-8222-222222222222',generation:1,publishEnabled:true,
  timeZone:'America/New_York',start,end,requiredSources:['fixture'],coverage:[{source:'fixture',start,end,complete:true,observedAt:now-1000,freshUntil:now+1800000}]};
const runProcess=(name,args)=>{
  const r=spawnSync(join(bin,name),args,{encoding:'utf8',timeout:20000});
  if(r.status!==0)throw new Error(`${name} failed: ${r.error?.message??r.stderr}`);
  return r.stdout.trim();
};
async function connect(){
  const c=new Client({host:socket,port:5432,user:'helm_fixture',database:'postgres',password:'fictional-local-only',ssl:false,options:'-c application_name=helm_inventory_fixture',
    connectionTimeoutMillis:2000,statement_timeout:12000,lock_timeout:6000});
  await c.connect();clients.push(c);return c;
}
try{
  console.log(runProcess('postgres',['--version']));
  runProcess('initdb',['-D',data,'--username=helm_fixture','--auth-local=trust','--auth-host=reject','--no-locale','--encoding=UTF8']);
  server=spawn(join(bin,'postgres'),['-D',data,'-k',socket,'-h','','-p','5432','-c','max_connections=10','-c','deadlock_timeout=200ms'],{stdio:['ignore','ignore','pipe']});
  let serverError='';server.stderr.on('data',s=>{serverError=(serverError+s.toString()).slice(-6000);});
  let monitor,connectError;
  for(let i=0;i<100;i++){
    if(server.exitCode!==null)throw new Error(`Test server exited: ${serverError}`);
    try{monitor=await connect();break;}catch(error){connectError=error.message;await delay(30);}
  }
  if(!monitor)throw new Error(`Test server connection failed: ${connectError}; ${serverError}`);
  const a=await connect(),b=await connect();
  const pidA=(await a.query('select pg_backend_pid() pid')).rows[0].pid;
  const pidB=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
  assert.notEqual(pidA,pidB);
  assert.equal((await monitor.query('show listen_addresses')).rows[0].listen_addresses,'');
  await installBookingInventoryFixture({exec:sql=>monitor.query(sql)});
  await monitor.query(readFileSync(new URL('../docs/guesty-exit/staging-storage/booking-inventory-planning.sql',import.meta.url),'utf8'));
  const query=(sql,args=[])=>monitor.query(sql,args);
  const read=async(property='home')=>(await query('select helm_booking_inventory_read($1) state',[property])).rows[0].state;
  const version=async(property='home')=>Number((await query('select version from helm_inventory_capture_scopes where property_id=$1',[property])).rows[0].version);
  const storeFor=c=>({property:'home',read,commit:async(e,j,f,d)=>(await c.query('select helm_booking_inventory_plan_commit($1,$2,$3,$4,$5,$6,$7,$8,$9) ok',
    ['home',e.captureVersion,e.configurationVersion,e.planVersion,e.journalVersion,e.inputs,j,f,d])).rows[0].ok,
    journal:{read:async()=>{const s=await read();return {version:s.journalVersion,journal:s.journal};},
      append:async(v,j)=>(await c.query('select helm_booking_inventory_journal_append($1,$2,$3) ok',['home',v,j])).rows[0].ok}});
  const store=storeFor(monitor);
  const jobs=async()=>replayInventoryJournal((await read()).journal).queue.list();
  const create=(c,property='home')=>c.query("select * from helm_create_booking($1,'manual','manual','block',$2,$3,'{\"hold_kind\":\"owner\"}','fixture',true)",[property,start,shiftIsoDay(start,1)]);
  async function plan(){assert.equal((await consumeBookingInventory(store,Date.now)).status,'queued');return (await jobs()).at(-1);}
  async function blocked(pending,waiter,blocker){
    let finished=false;pending.then(()=>{finished=true;},()=>{finished=true;});
    for(let i=0;i<150;i++){
      const ids=(await query('select pg_blocking_pids($1) ids',[waiter])).rows[0].ids;
      if(ids.includes(blocker)){assert.equal(finished,false);return;}
      if(finished)throw new Error('Expected a real database lock wait, operation already finished');
      await delay(10);
    }
    throw new Error('Expected blocker was not observed in pg_blocking_pids');
  }
  async function check(name,fn){
    try{await fn();passed++;console.log(`PASS ${name}`);}
    finally{await Promise.allSettled([a.query('rollback'),b.query('rollback')]);}
  }
  await query(`insert into properties(id,name,address,city,owner_last,owner_full,owner_greeting,management_fee_pct,calendar_authority)
    select id,'Fictional home','Fictional address','Fictional city','Fixture','Fixture','Fixture',0,'helm'
    from (values('home'),('other')) fixtures(id);
    insert into helm_inventory_capture_scopes(property_id,enabled) values('home',true),('other',true);
    insert into property_rate_plans(property_id,base_nightly_cents) values('home',0),('other',0);`);
  await query('insert into helm_booking_inventory_consumers(property_id,configuration) values($1,$2)',['home',config]);
  await query("insert into property_rate_days(property_id,date,closed) values('home',$1,false)",[start]);
  await query("insert into property_rental_periods(property_id,start_month,start_day,end_month,end_day) values('home',1,1,12,31)");
  const sources=[
    ['booking',c=>create(c)],
    ['rules',c=>c.query("update property_rate_plans set booking_window_days=booking_window_days+1 where property_id='home'")],
    ['closure',c=>c.query("update property_rate_days set closed=not closed where property_id='home'")],
    ['season',c=>c.query("update property_rental_periods set start_day=case when start_day=1 then 2 else 1 end where property_id='home'")],
    ['authority',c=>c.query("update properties set calendar_authority=case when calendar_authority='helm' then 'guesty' else 'helm' end where id='home'")],
  ];
  await check('different sessions serialize same-property changes from different source tables',async()=>{
    const v=await version();await a.query('begin');await create(a);
    const pending=b.query("update property_rate_days set closed=true where property_id='home'");await blocked(pending,pidB,pidA);
    assert.equal(await version(),v);await a.query('commit');await pending;assert.equal(await version(),v+2);
  });
  for(const [name,mutate] of sources){
    await check(`${name}: committed source writer makes a waiting plan stale`,async()=>{
      await create(monitor);const before=await read();
      let proposal;
      await consumeBookingInventory({...store,commit:async(...args)=>{proposal=args;return false;}},Date.now);
      assert.ok(proposal);await a.query('begin');await mutate(a);
      const pending=storeFor(b).commit(...proposal);await blocked(pending,pidB,pidA);
      await a.query('commit');assert.equal(await pending,false);
      const after=await read();assert.equal(after.journalVersion,before.journalVersion);assert.equal(after.captureVersion,before.captureVersion+1);
    });
    await check(`${name}: submitting boundary waits for a writer and rejects its older context`,async()=>{
      await query("update properties set calendar_authority='helm' where id='home'");await create(monitor);const job=await plan();
      await recordInventoryCommand(store.journal,{kind:'claim',id:job.id,now:Date.now(),leaseMs:60000});
      const claimed=(await jobs()).at(-1),context=await bookingInventoryDispatchContext(store,claimed,Date.now);
      assert.equal(context.complete,true);const state=await read(),journal=structuredClone(state.journal);
      journal.commands.push({kind:'dispatch',id:job.id,token:claimed.token,context,now:Date.now()});
      await a.query('begin');await mutate(a);
      const pending=storeFor(b).journal.append(state.journalVersion,journal);await blocked(pending,pidB,pidA);
      await a.query('commit');assert.equal(await pending,false);assert.equal((await jobs()).at(-1).status,'leased');
      await recordInventoryCommand(store.journal,{kind:'expire',now:Date.now()+61000});
    });
    await check(`${name}: a submitting transaction holds the source writer until its commit`,async()=>{
      await query("update properties set calendar_authority='helm' where id='home'");await create(monitor);const job=await plan();
      await recordInventoryCommand(store.journal,{kind:'claim',id:job.id,now:Date.now(),leaseMs:60000});
      const claimed=(await jobs()).at(-1),context=await bookingInventoryDispatchContext(store,claimed,Date.now);
      const state=await read(),journal=structuredClone(state.journal);
      journal.commands.push({kind:'dispatch',id:job.id,token:claimed.token,context,now:Date.now()});
      await a.query('begin');assert.equal(await storeFor(a).journal.append(state.journalVersion,journal),true);
      const pending=mutate(b);await blocked(pending,pidB,pidA);
      assert.equal(await version(),state.captureVersion);await a.query('commit');await pending;
      assert.equal(await version(),state.captureVersion+1);assert.equal((await jobs()).at(-1).status,'submitting');
      // No provider request was made. Roll back the fixture's dispatch command to
      // repeat this boundary test without inventing task-settlement evidence.
      await query('update helm_booking_inventory_consumers set journal=$1,journal_version=$2 where property_id=$3',[state.journal,state.journalVersion,'home']);
      await recordInventoryCommand(store.journal,{kind:'expire',now:Date.now()+61000});
    });
  }
  await check('rolling back the source writer lets the waiting original plan commit',async()=>{
    await create(monitor);let proposal;
    await consumeBookingInventory({...store,commit:async(...args)=>{proposal=args;return false;}},Date.now);
    const before=await read();await a.query('begin');await sources[2][1](a);
    const pending=storeFor(b).commit(...proposal);await blocked(pending,pidB,pidA);await a.query('rollback');
    assert.equal(await pending,true);assert.equal(await version(),before.captureVersion);
  });
  await check('two concurrent planners append exactly one journal entry and checkpoint',async()=>{
    await create(monitor);let proposal;
    await consumeBookingInventory({...store,commit:async(...args)=>{proposal=args;return false;}},Date.now);
    const before=await read();await a.query('begin');assert.equal(await storeFor(a).commit(...proposal),true);
    const pending=storeFor(b).commit(...proposal);await blocked(pending,pidB,pidA);await a.query('commit');
    assert.equal(await pending,false);const after=await read();assert.equal(after.planVersion,before.planVersion+1);assert.equal(after.journalVersion,before.journalVersion+1);
  });
  await check('an ordinary writer on one property does not block another property',async()=>{
    await a.query('begin');await create(a);
    const v=await version('other');await b.query("set lock_timeout='300ms'");
    try{await create(b,'other');assert.equal(await version('other'),v+1);}finally{await b.query("set lock_timeout='6s'");}
    await a.query('rollback');
  });
  for(const [name,mutate] of sources){
    await check(`${name}: enable checkpoint drains an earlier disabled source transaction`,async()=>{
      await query("update helm_inventory_capture_scopes set enabled=false where property_id='home'");const before=await version();
      await a.query('begin');await mutate(a);
      const pending=b.query("update helm_inventory_capture_scopes set enabled=true where property_id='home'");await blocked(pending,pidB,pidA);
      await a.query('commit');await pending;assert.equal(await version(),before+1);
    });
    await check(`${name}: a writer queued behind enable is captured after enable commits`,async()=>{
      await query("update helm_inventory_capture_scopes set enabled=false where property_id='home'");const before=await version();
      await a.query('begin');await a.query("update helm_inventory_capture_scopes set enabled=true where property_id='home'");
      const pending=mutate(b);await blocked(pending,pidB,pidA);await a.query('commit');await pending;
      assert.equal(await version(),before+2);
    });
  }
  await check('committed source versions and journal digests remain consistent after contention',async()=>{
    const gaps=await query(`select s.property_id from helm_inventory_capture_scopes s left join helm_booking_inventory_events e using(property_id)
      group by s.property_id,s.version having count(e.version)<>s.version or max(e.version)<>s.version`);
    assert.equal(gaps.rows.length,0);
    const state=await read();const replay=replayInventoryJournal(state.journal);
    assert.equal(replay.journal.commands.length,state.journalVersion);
    for(const job of replay.queue.list())assert.equal(inventoryDigest(job.days),job.digest);
  });
  await monitor.query(readFileSync(new URL('../docs/guesty-exit/staging-storage/booking-inventory-refresh.sql',import.meta.url),'utf8'));
  const refreshFor=(client,s,until)=>client.query('select helm_booking_inventory_plan_refresh($1,$2,$3,$4,$5,$6,$7,$8) ok',
    ['home',s.captureVersion,s.configurationVersion,s.planVersion,s.journalVersion,s.inputs,until,s.lastDigest]).then(r=>r.rows[0].ok);
  const refreshBaseline=async()=>{
    await create(monitor);await plan();
    await query("update helm_booking_inventory_consumers set planned_fresh_until=1 where property_id='home'");
    return read();
  };
  for(const [name,mutate] of sources) await check(`refresh race: ${name} writer wins over stale deadline renewal`,async()=>{
    const before=await refreshBaseline();await a.query('begin');await mutate(a);
    const pending=refreshFor(b,before,Date.now()+20000);await blocked(pending,pidB,pidA);
    await a.query('commit');assert.equal(await pending,false);
    const after=await read();assert.equal(after.plannedFreshUntil,1);assert.deepEqual(after.journal,before.journal);
    assert.equal(after.captureVersion,before.captureVersion+1);
  });
  await check('refresh race: completed renewal holds source writers until its atomic commit',async()=>{
    const before=await refreshBaseline();await a.query('begin');
    assert.equal(await refreshFor(a,before,Date.now()+20000),true);
    const pending=create(b);await blocked(pending,pidB,pidA);
    await a.query('commit');await pending;const after=await read();
    assert.equal(after.plannedCaptureVersion,before.captureVersion);assert.equal(after.captureVersion,before.captureVersion+1);
    assert.deepEqual(after.journal,before.journal);
  });
  await check('refresh race: two workers cannot overwrite or regress the same refreshed deadline',async()=>{
    const before=await refreshBaseline(),until=Date.now()+20000;await a.query('begin');
    assert.equal(await refreshFor(a,before,until),true);
    const pending=refreshFor(b,before,until);await blocked(pending,pidB,pidA);
    await a.query('commit');assert.equal(await pending,false);
    const after=await read();assert.equal(after.plannedFreshUntil,until);assert.deepEqual(after.journal,before.journal);
  });
  await check('refresh race: expiry during a consumer lock wait refuses the stale calculation',async()=>{
    const before=await refreshBaseline();await a.query('begin');
    await a.query("select property_id from helm_booking_inventory_consumers where property_id='home' for update");
    const pending=refreshFor(b,before,Date.now()+100);await blocked(pending,pidB,pidA);
    await delay(125);await a.query('commit');assert.equal(await pending,false);
    assert.deepEqual(await read(),before);
  });
  await verifyBookingInventoryRefresh({exec:sql=>monitor.query(sql),query:(sql,args)=>monitor.query(sql,args)},check);
  await verifyBookingInventorySchema({exec:sql=>monitor.query(sql),query:(sql,args)=>monitor.query(sql,args)},check);
  const canonical = await verifyCanonicalRevisions({exec:sql=>monitor.query(sql),query:(sql,args)=>monitor.query(sql,args)},check);

  const source=await verifyCanonicalSourceDatabase({exec:sql=>monitor.query(sql),query:(sql,args)=>monitor.query(sql,args)},check);
  await verifyBookingInventoryCapacity({exec:sql=>monitor.query(sql),query:(sql,args)=>monitor.query(sql,args)},check);

  const certifyWith=async(c,s,observed=Date.now())=>(await c.query('select helm_pilot_source_certify($1,$2,$3,$4,$5) ok',
    [JSON.stringify(s),JSON.stringify(s.bindings.map(b=>b.booking)),observed,source.start,source.end])).rows[0].ok;
  for(const [name,write] of [
    ['booking date',"update bookings set check_out=check_out+1 where property_id='HELMTEST-calderwood'"],
    ['uncaptured identity',"update bookings set source_ref='changed' where property_id='HELMTEST-calderwood'"],
    ['configuration',"update helm_booking_inventory_consumers set configuration=jsonb_set(configuration,'{publishEnabled}','true') where property_id='HELMTEST-calderwood'"],
  ]) await check(`source certification race: ${name} commit defeats an older proof`,async()=>{
    const before=await source.read();await a.query('begin');await a.query(write);
    const pending=certifyWith(b,before);await blocked(pending,pidB,pidA);await a.query('commit');assert.equal(await pending,false);
    // Restore only this local fixture so later races test a valid source.
    if(name==='booking date')await query("update bookings set check_out=check_out-1 where property_id='HELMTEST-calderwood'");
    if(name==='uncaptured identity')await query("update bookings b set source_ref='channex-staging:'||m.remote_id from helm_channex_revisions.bookings m where b.id=m.canonical_id");
    if(name==='configuration')await query("update helm_booking_inventory_consumers set configuration=jsonb_set(configuration,'{publishEnabled}','false') where property_id='HELMTEST-calderwood'");
  });
  await check('source certification race: accepted proof holds booking identity stable through commit',async()=>{
    const before=await source.read();await a.query('begin');assert.equal(await certifyWith(a,before),true);
    const pending=b.query("update bookings set source_ref='changed' where property_id='HELMTEST-calderwood'");
    await blocked(pending,pidB,pidA);await a.query('commit');await pending;
    assert.equal((await source.read()).bindings[0].valid,false);
    await query("update bookings b set source_ref='channex-staging:'||m.remote_id from helm_channex_revisions.bookings m where b.id=m.canonical_id");
  });
  await check('source certification race: concurrent proofs cannot both advance the same configuration',async()=>{
    const before=await source.read();await a.query('begin');assert.equal(await certifyWith(a,before),true);
    const pending=certifyWith(b,before);await blocked(pending,pidB,pidA);await a.query('commit');assert.equal(await pending,false);
  });
  await check('source certification race: proof expiring in a lock wait cannot renew coverage',async()=>{
    const before=await source.read();await a.query('begin');
    await a.query("select property_id from helm_booking_inventory_consumers where property_id='HELMTEST-calderwood' for update");
    const pending=certifyWith(b,before,Date.now()-59900);await blocked(pending,pidB,pidA);
    await delay(150);await a.query('commit');assert.equal(await pending,false);
  });

  await canonical.verifyConflicts();
  await check('conflict race: concurrent rejected duplicates retain one alert without calendar or receipt mutations',async()=>{
    const prior=(await query("select revision from helm_channex_revisions.receipts where revision_id='80d4fed1-c4bc-4d30-b096-000000000020'")).rows[0].revision;
    const revision={...prior,id:'984badb7-7810-42c2-a951-86c98977d101',bookingId:'984badb7-7810-42c2-a951-86c98977d102',code:'HELMTEST-concurrent-conflict'};
    const before=(await query('select count(*)::int n from helm_channex_revisions.receipts')).rows[0].n;
    await a.query('begin');
    const first=(await a.query('select helm_pilot_revision_observe($1) result',[revision])).rows[0].result;
    assert.equal(first.conflict.reason,'booking_overlap');
    const pending=b.query('select helm_pilot_revision_observe($1) result',[revision]);
    await blocked(pending,pidB,pidA);await a.query('commit');assert.deepEqual((await pending).rows[0].result,first);
    const alert=(await query('select observations::int n from helm_channex_revisions.conflicts where revision_id=$1',[revision.id])).rows[0];
    assert.equal(alert.n,2);assert.equal((await query('select count(*)::int n from helm_channex_revisions.receipts')).rows[0].n,before);
  });

  await check('canonical import race: concurrent duplicate notices create one canonical update',async()=>{
    const prior=(await query("select revision from helm_channex_revisions.receipts order by committed_at desc limit 1")).rows[0].revision;
    const revision={...prior,id:'984badb7-7810-42c2-a951-86c98977d001',status:'modified',receivedAt:'2026-10-19T15:00:00.000001Z',checkIn:'2027-03-01',checkOut:'2027-03-04'};
    const before=(await query("select count(*)::int n from booking_events where booking_id in (select canonical_id from helm_channex_revisions.bookings)")).rows[0].n;
    await a.query('begin');
    const first=(await a.query('select helm_pilot_revision_commit($1) receipt',[revision])).rows[0].receipt;
    const pending=b.query('select helm_pilot_revision_commit($1) receipt',[revision]);
    await blocked(pending,pidB,pidA);await a.query('commit');
    assert.deepEqual((await pending).rows[0].receipt,first);
    assert.equal((await query("select count(*)::int n from booking_events where booking_id in (select canonical_id from helm_channex_revisions.bookings)")).rows[0].n,before+1);
  });
  await check('canonical import race: older revision waiting behind newer cancellation stays stale',async()=>{
    const prior=(await query("select revision from helm_channex_revisions.receipts order by committed_at desc limit 1")).rows[0].revision;
    const cancelled={...prior,id:'984badb7-7810-42c2-a951-86c98977d002',status:'cancelled',receivedAt:'2026-10-19T15:00:02.000001Z'};
    const older={...prior,id:'984badb7-7810-42c2-a951-86c98977d003',receivedAt:'2026-10-19T15:00:01.000001Z'};
    await a.query('begin');await a.query('select helm_pilot_revision_commit($1)',[cancelled]);
    const pending=b.query('select helm_pilot_revision_commit($1) receipt',[older]);
    await blocked(pending,pidB,pidA);await a.query('commit');
    assert.equal((await pending).rows[0].receipt.outcome,'stale');
    assert.equal((await query("select status from bookings where property_id='HELMTEST-calderwood'")).rows[0].status,'cancelled');
  });
  for (const [name, disable, restore, error] of [
    ['capture', "update helm_inventory_capture_scopes set enabled=false where property_id='HELMTEST-calderwood'", "update helm_inventory_capture_scopes set enabled=true where property_id='HELMTEST-calderwood'", /inventory_capture_required/],
    ['authority', "update properties set calendar_authority='guesty' where id='HELMTEST-calderwood'", "update properties set calendar_authority='helm' where id='HELMTEST-calderwood'", /synthetic_helm_property_required/],
  ]) await check(`canonical import race: ${name} withdrawal blocks import before a receipt can be committed`,async()=>{
    const prior=(await query("select revision from helm_channex_revisions.receipts order by committed_at desc limit 1")).rows[0].revision;
    const revision={...prior,id:'984badb7-7810-42c2-a951-86c98977d005',status:'modified',receivedAt:'2026-10-19T15:00:04.000001Z'};
    await a.query('begin');await a.query(disable);
    const pending=b.query('select helm_pilot_revision_commit($1)',[revision]);
    const rejected=assert.rejects(pending,error);
    await blocked(pending,pidB,pidA);await a.query('commit');await rejected;
    assert.equal((await query('select helm_pilot_revision_receipt($1) receipt',[revision.id])).rows[0].receipt,null);
    await query(restore);
  });
  await check('canonical import race: disabling importer wins over a later waiting notification',async()=>{
    const prior=(await query("select revision from helm_channex_revisions.receipts order by committed_at desc limit 1")).rows[0].revision;
    await a.query('begin');await a.query('update helm_channex_revisions.scope set enabled=false');
    const pending=b.query('select helm_pilot_revision_commit($1)',[{...prior,id:'984badb7-7810-42c2-a951-86c98977d004',receivedAt:'2026-10-19T15:00:03.000001Z'}]);
    const rejected=assert.rejects(pending,/revision_import_disabled/);
    await blocked(pending,pidB,pidA);await a.query('commit');await rejected;
  });

  console.log(`PASS: ${passed} native PostgreSQL concurrency/schema checks; observed lock waits; no provider or hosted connections.`);
}catch(error){console.error('FAIL:',error.message);process.exitCode=1;}
finally{
  await Promise.allSettled(clients.map(c=>c.end()));
  if(server && server.exitCode===null){
    const exit=once(server,'exit');server.kill('SIGINT');
    await Promise.race([exit,delay(10000,undefined,{ref:false}).then(()=>{if(server.exitCode===null)server.kill('SIGKILL');})]);
    if(server.exitCode===null)await exit;
  }
  stopped=!server || server.exitCode!==null || server.signalCode!==null;
  if(stopped)rmSync(root,{recursive:true,force:true});
  else{console.error('Test cluster cleanup needs review:',root);process.exitCode=1;}
}
