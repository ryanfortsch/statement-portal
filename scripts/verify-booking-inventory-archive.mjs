// Local synthetic fixture only. Runs after canonical-source tests on a disposable database.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { consumeBookingInventory, bookingInventoryDispatchContext } from '../src/lib/channex-staging/booking-inventory-consumer.ts';
import { prepareInventoryArchive, verifyInventoryArchive, archiveBookingInventory } from '../src/lib/channex-staging/inventory-archive.ts';
import { recordInventoryCommand, replayInventoryJournal, inventoryJournalVersion } from '../src/lib/channex-staging/inventory-journal.ts';
import { prepareInventoryDispatch } from '../src/lib/channex-staging/inventory-worker.ts';
import { createAvailabilityRequest } from '../src/lib/channex-staging/availability-request.ts';
import { todayInEastern, shiftIsoDay } from '../src/lib/sca-quotes-types.ts';
export async function verifyBookingInventoryArchive(db,check) {
 const sql=readFileSync(new URL('../docs/guesty-exit/staging-storage/booking-inventory-archive.sql',import.meta.url),'utf8');
 await db.exec(sql);
 const q=async(s,a=[])=>(await db.query(s,a)).rows,property='HELMTEST-calderwood';
 const now=Date.now(),start=shiftIsoDay(todayInEastern(new Date(now)),15),end=shiftIsoDay(start,1);
 const cfg={environment:'staging',topology:'single-unit',connection:'calderwood-hosted-inventory',
   listing:'f795ae2c-f47d-4751-86ff-e883b6d30800',generation:1,publishEnabled:true,timeZone:'America/New_York',
   start,end,requiredSources:['synthetic-canonical'],coverage:[{source:'synthetic-canonical',start:shiftIsoDay(start,-30),end:shiftIsoDay(end,30),
   complete:true,observedAt:now-1000,freshUntil:now+1800000}]};
 await q('insert into property_rate_plans(property_id,base_nightly_cents,min_nights_default,booking_window_days) values($1,10000,1,365) on conflict(property_id) do nothing',[property]);
 await q('update helm_booking_inventory_consumers set configuration=$2 where property_id=$1',[property,cfg]);
 const read=async()=>(await q('select helm_booking_inventory_read($1) s',[property]))[0].s;
 const args=(e,a)=>[property,e.captureVersion,e.configurationVersion,e.planVersion,e.journalVersion,e.inputs,a.text,a.next];
 const archiveSql='select helm_booking_inventory_archive($1,$2,$3,$4,$5,$6,$7,$8) ok';
 const store={property,read,
   commit:async(e,j,f,d)=>(await q('select helm_booking_inventory_plan_commit($1,$2,$3,$4,$5,$6,$7,$8,$9) ok',
     [property,e.captureVersion,e.configurationVersion,e.planVersion,e.journalVersion,e.inputs,j,f,d]))[0].ok,
   journal:{read:async()=>{const s=await read();return {version:s.journalVersion,journal:s.journal};},
     append:async(v,j)=>(await q('select helm_booking_inventory_journal_append($1,$2,$3) ok',[property,v,j]))[0].ok},
   commitArchive:async(e,a)=>(await q(archiveSql,args(e,a)))[0].ok,
   readArchive:async id=>(await q('select helm_booking_inventory_archive_read($1,$2) a',[property,id]))[0].a};
 const pause=async value=>q("update helm_booking_inventory_consumers set configuration=jsonb_set(configuration,'{publishEnabled}',$2) where property_id=$1",[property,JSON.stringify(value)]);
 const task1='11111111-1111-4111-8111-111111111111',task2='22222222-2222-4222-8222-222222222222';
 const plan=async()=>{assert.equal((await consumeBookingInventory(store,Date.now)).status,'queued');return replayInventoryJournal((await read()).journal).queue.list().at(-1);};
 const dispatch=async job=>{
   const request=createAvailabilityRequest(job.days.map(d=>({property_id:'30584a9a-8784-4eb1-a387-e26bd43aec1c',room_type_id:cfg.listing,date:d.date,availability:d.available})),Date.now());
   return prepareInventoryDispatch(store.journal,job.id,Date.now,60000,j=>bookingInventoryDispatchContext(store,j,Date.now),request);
 };
 const settle=async(job,task)=>{
   await recordInventoryCommand(store.journal,{kind:'accepted',id:job.id,token:job.token,task,receipt:{requestDigest:job.request.digest,receivedAt:Date.now()}});
   await recordInventoryCommand(store.journal,{kind:'reconcile',id:job.id,token:job.token,
     evidence:{settled:true,complete:true,generation:1,digest:job.digest,task,requestDigest:job.request.digest}});
 };
 const job=await dispatch(await plan());assert.ok(job);await settle(job,task1);await pause(false);
 // Exercise actual capacity recovery and absolute versions above the old ceiling.
 const full=await read();while(full.journal.commands.length<10000)full.journal.commands.push({kind:'expire',now:0});
 await q('update helm_booking_inventory_consumers set journal=$2,journal_version=10000 where property_id=$1',[property,full.journal]);
 const before=await read(),archive=prepareInventoryArchive(before);
 await check('archive: exact paused snapshot and metadata are required; old histories are not overwritten',async()=>{
   for(const field of ['captureVersion','configurationVersion','planVersion','journalVersion'])assert.equal(await store.commitArchive({...before,[field]:before[field]+1},archive),false);
   const changed=JSON.parse(archive.text);changed.journal.commands[0].now++;
   await assert.rejects(()=>store.commitArchive(before,{...archive,text:JSON.stringify(changed)}),/preserve exact history/);
   await assert.rejects(()=>store.commitArchive(before,{...archive,next:{...archive.next,resumeAfter:0}}),/preserve exact history/);
   await pause(true);assert.equal(await store.commitArchive(before,archive),false);await pause(false);
   assert.deepEqual((await read()).journal,before.journal);
 });
 await check('archive: a checkpoint failure rolls back archive, identities and journal together',async()=>{
   const s=await read(),a=prepareInventoryArchive(s);
   await q(`alter table helm_booking_inventory_consumers add constraint archive_failure_fixture check(property_id<>'${property}' or journal_version<=${s.journalVersion})`);
   try{await assert.rejects(()=>store.commitArchive(s,a),/archive_failure_fixture/);}finally{await q('alter table helm_booking_inventory_consumers drop constraint archive_failure_fixture');}
   assert.equal(await store.readArchive(a.id),null);assert.deepEqual(await read(),s);
   assert.equal((await q('select count(*)::int n from helm_inventory_history.identities'))[0].n,0);
 });
 let first;
 await check('archive: service-only atomic rotation preserves complete audit and forces a fresh plan',async()=>{
   const s=await read();await db.exec('set role service_role');
   try{first=await archiveBookingInventory(store);}finally{await db.exec('reset role');}
   assert.equal(first.status,'archived');const a=await store.readArchive(first.id);verifyInventoryArchive(a);
   assert.deepEqual(JSON.parse(a.text).journal,s.journal);
   const after=await read();assert.equal(after.journalVersion,s.journalVersion+1);assert.equal(after.planVersion,s.planVersion);
   assert.equal(after.inputsMatchPlan,false);assert.equal(after.plannedFreshUntil,0);assert.equal(after.configuration.publishEnabled,false);
   assert.equal(after.journal.commands.length,0);assert.equal(await store.commitArchive(s,prepareInventoryArchive(s)),false);
   const stale={...s.journal,commands:[...s.journal.commands,{kind:'expire',now:Date.now()}]};
   assert.equal(await store.journal.append(s.journalVersion,stale),false);
 });
 await check('archive: browser and direct service mutations remain denied; reinstall preserves all bytes',async()=>{
   for(const role of ['anon','authenticated','service_role']){
     for(const sig of ['helm_booking_inventory_archive(text,bigint,bigint,bigint,bigint,jsonb,text,jsonb)','helm_booking_inventory_archive_read(text,text)']) {
       assert.equal((await q('select has_function_privilege($1,$2,\'EXECUTE\') ok',[role,'public.'+sig]))[0].ok,role==='service_role');
     }
     assert.equal((await q("select has_schema_privilege($1,'helm_inventory_history','USAGE') ok",[role]))[0].ok,false);
   }
   const a=await store.readArchive(first.id),s=await read();await db.exec(sql);
   assert.deepEqual(await store.readArchive(first.id),a);assert.deepEqual(await read(),s);
 });
 await check('archive: new plan uses absolute CAS; archived receipt reuse and checkpoint rewrites are refused',async()=>{
   await pause(true);const pending=await plan();assert.equal(pending.version,before.planVersion+1);
   let s=await read();assert.equal(s.journalVersion,s.journal.baseVersion+1);assert.ok(s.journalVersion>10000);
   const oldIdentity={...s.journal,commands:[...s.journal.commands,{kind:'enqueue',intent:{...pending,id:job.id,version:s.planVersion+1},now:Date.now()}]};
   const last=oldIdentity.commands.at(-1).intent;
   for(const key of ['digest','status','attempts','nextAttemptAt'])delete last[key];
   await assert.rejects(()=>store.commit(s,oldIdentity,Date.now()+30000,pending.digest),/Archived inventory identity/);
   const rewritten={...s.journal,resumeAfter:0,commands:[...s.journal.commands,{kind:'expire',now:Date.now()}]};
   await assert.rejects(()=>store.journal.append(s.journalVersion,rewritten),/checkpoint rewrite/);
   // Carrying pacing is tested without waiting: advance only the synthetic command clock.
   const tick=Math.max(Date.now(),s.journal.resumeAfter);
   const req=createAvailabilityRequest(pending.days.map(d=>({property_id:'30584a9a-8784-4eb1-a387-e26bd43aec1c',room_type_id:cfg.listing,date:d.date,availability:d.available})),tick);
   const j=await prepareInventoryDispatch(store.journal,pending.id,()=>tick,60000,x=>bookingInventoryDispatchContext(store,x,()=>tick),req);assert.ok(j);
   const accepted={kind:'accepted',id:j.id,token:j.token,task:task1,receipt:{requestDigest:req.digest,receivedAt:tick}};
   await assert.rejects(()=>recordInventoryCommand(store.journal,accepted),/Archived inventory identity/);
   assert.equal(replayInventoryJournal((await read()).journal).queue.list()[0].status,'submitting');
   await recordInventoryCommand(store.journal,{...accepted,task:task2});
   await recordInventoryCommand(store.journal,{kind:'reconcile',id:j.id,token:j.token,evidence:{settled:true,complete:true,generation:1,digest:j.digest,task:task2,requestDigest:req.digest}});
   await pause(false);
 });
 await check('archive: second segment retains a verifiable predecessor and globally unique identities',async()=>{
   const s=await read(),result=await archiveBookingInventory(store),a=await store.readArchive(result.id);
   assert.equal(verifyInventoryArchive(a).previous,first.id);assert.ok(await store.readArchive(first.id));
   assert.equal(inventoryJournalVersion(a.next),s.journalVersion+1);
   assert.equal((await q('select count(*)::int n from helm_inventory_history.archives'))[0].n,2);
   assert.equal((await q('select count(*)::int n from helm_inventory_history.identities'))[0].n,4);
 });
 return {store,read,pause,plan,args,archiveSql,property};
}
