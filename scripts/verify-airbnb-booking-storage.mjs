// Disposable native PostgreSQL; no hosted database, credentials or provider HTTP.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { installBookingInventoryFixture } from './booking-inventory-fixture.mjs';
import { createAirbnbRevisionReader } from '../src/lib/channex-bookings/client.ts';
import { createAirbnbBookingStore } from '../src/lib/channex-bookings/store.ts';
import { ingestAirbnbBookingRevisions } from '../src/lib/channex-bookings/ingestion.ts';
import { normalizeAirbnbBookingRevision } from '../src/lib/channex-bookings/revision.ts';
assert.ok(isAbsolute(process.argv[2]??'')&&isAbsolute(process.argv[3]??''));
const bin=process.argv[2],{default:pg}=await import(pathToFileURL(process.argv[3]).href);
const root=mkdtempSync('/tmp/helm-airbnb-store-'),data=join(root,'data');
const ctl=(...args)=>execFileSync(join(bin,'pg_ctl'),['-D',data,...args],{stdio:'ignore'});
let running=false,count=0;const connections=[];
async function connect(){const c=new pg.Client({host:root,port:55485,user:'helmtest',database:'postgres'});await c.connect();connections.push(c);return c;}
const id=n=>`30000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const mapping={environment:'staging',propertyId:id(1),roomTypeId:id(2),ratePlanId:id(3),generation:1};
const raw=(n,status='new',extra={})=>({type:'booking_revision',id:id(n),attributes:{booking_id:id(5),property_id:id(1),ota_name:'Airbnb',ota_reservation_code:'SYNTHETIC123',status,
 arrival_date:'2027-02-01',departure_date:'2027-02-04',inserted_at:`2026-10-23T12:00:00.${String(n).padStart(6,'0')}Z`,
 rooms:[{room_type_id:id(2),rate_plan_id:id(3),checkin_date:'2027-02-01',checkout_date:'2027-02-04'}],...extra}});
try{
 execFileSync(join(bin,'initdb'),['-D',data,'-A','trust','-U','helmtest','--no-locale','-E','UTF8'],{stdio:'ignore'});
 ctl('-l',join(root,'server.log'),'-o',`-h '' -k ${root} -p 55485`,'-w','start');running=true;
 const db=await connect(),second=await connect();
 const scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0].v;
 await installBookingInventoryFixture({exec:sql=>db.query(sql)});
 const sql=readFileSync(new URL('../docs/guesty-exit/staging-storage/airbnb-booking-storage.sql',import.meta.url),'utf8');await db.query(sql);
 await db.query("insert into properties(id,name,address,city,owner_last,owner_full,owner_greeting,management_fee_pct,calendar_authority) values('HELMTEST-provider','Fixture','Fixture','Fixture','Fixture','Fixture','Fixture',0,'helm')");
 await db.query("insert into helm_inventory_capture_scopes(property_id,enabled) values('HELMTEST-provider',true)");
 await db.query("insert into helm_airbnb_bookings.scope(property_id,environment,remote_property,room_type,rate_plan,generation) values('HELMTEST-provider','staging',$1,$2,$3,1)",[id(1),id(2),id(3)]);
 const storeFor=c=>createAirbnbBookingStore(async(name,args)=>({data:(await c.query(name==='helm_airbnb_revision_commit'?'select helm_airbnb_revision_commit($1) v':'select helm_airbnb_revision_receipt($1) v',[args.p_revision??args.p_id])).rows[0].v,error:null}));
 const store=storeFor(db);let acks=0;
 const run=async(r,storage=store)=>{
  const rel=n=>({data:{id:id(n)}});
  const reader=createAirbnbRevisionReader({mapping,apiKey:'SYNTHETIC',acknowledgeEnabled:true},async(input,init)=>{
   const path=new URL(String(input)).pathname;
   if(init.method==='POST'){
    assert.equal(path,'/api/v1/booking_revisions/'+r.id+'/ack');
    assert.ok(await storage.receipt(r.id),'ACK requires an actual database receipt');acks++;return Response.json({meta:{message:'Success'}});
   }
   if(path.endsWith('/properties/'+id(1)))return Response.json({data:{id:id(1)}});
   if(path.endsWith('/room_types/'+id(2)))return Response.json({data:{id:id(2),relationships:{property:rel(1)}}});
   if(path.endsWith('/rate_plans/'+id(3)))return Response.json({data:{id:id(3),relationships:{property:rel(1),room_type:rel(2)}}});
   if(path.endsWith('/feed'))return Response.json({data:[r],meta:{page:1,limit:100,total:1}});
   assert.equal(path,'/api/v1/booking_revisions/'+r.id);return Response.json({data:r});
  });
  return ingestAirbnbBookingRevisions(reader,storage,mapping);
 };
 const pass=s=>{count++;console.log('PASS '+s);};
 const state=async()=>({bookings:await scalar("select count(*)::int v from bookings where property_id='HELMTEST-provider'"),receipts:await scalar('select count(*)::int v from helm_airbnb_bookings.receipts'),events:await scalar('select count(*)::int v from booking_events')});
 await assert.rejects(()=>run(raw(10)));assert.equal(acks,0);pass('disabled scope refuses booking and ACK');
 await db.query('update helm_airbnb_bookings.scope set enabled=true');
 await db.query('set role service_role');await run(raw(10));await db.query('reset role');
 assert.deepEqual(await state(),{bookings:1,receipts:1,events:1});
 assert.equal(await scalar('select channel::text v from bookings'),'airbnb');pass('actual canonical RPC creates Airbnb stay, audit and receipt');
 const original=await store.receipt(id(10));await run(raw(10));assert.deepEqual(await store.receipt(id(10)),original);assert.deepEqual(await state(),{bookings:1,receipts:1,events:1});pass('replay preserves one booking and immutable first-receipt clock');
 await Promise.all([run(raw(11,'modified')),run(raw(11,'modified'),storeFor(second))]);assert.deepEqual(await state(),{bookings:1,receipts:2,events:2});pass('concurrent duplicate commits produce one canonical change');
 await db.query("insert into automation_sends(booking_id,property_id,fire_at,planned_check_in,planned_check_out,status) select id,property_id,now(),check_in,check_out,'scheduled' from bookings");
 await run(raw(14,'cancelled'));assert.equal(await scalar('select status::text v from bookings'),'cancelled');assert.equal(await scalar('select status v from automation_sends'),'cancelled');pass('cancellation stops pending automated message through canonical RPC');
 const before=await state();assert.equal((await run(raw(12,'modified'))).stale,1);assert.equal(await scalar('select status::text v from bookings'),'cancelled');assert.equal((await state()).events,before.events);pass('late revision is retained without resurrecting cancellation');
 await assert.rejects(()=>run(raw(15,'modified')));await assert.rejects(()=>run(raw(14,'new')));await assert.rejects(()=>run(raw(16,'cancelled',{inserted_at:raw(14).attributes.inserted_at})));pass('resurrection, changed revision reuse and ambiguous order rejected');
 const beforeFailure=await state();await db.query("create function helm_airbnb_bookings.fail() returns trigger language plpgsql as $$begin raise exception 'fixture fail'; end$$; create trigger fail before insert on helm_airbnb_bookings.receipts for each row execute function helm_airbnb_bookings.fail()");
 await assert.rejects(()=>run(raw(17,'cancelled')));assert.deepEqual(await state(),beforeFailure);await db.query('drop trigger fail on helm_airbnb_bookings.receipts; drop function helm_airbnb_bookings.fail()');pass('receipt failure rolls back canonical mutation and audit');
 const r=normalizeAirbnbBookingRevision(raw(18,'cancelled'),mapping);
 for(const bad of [{...r,customer:'PRIVATE'},{...r,mappingGeneration:2},{...r,propertyId:id(9)}])await assert.rejects(()=>db.query('select helm_airbnb_revision_commit($1)',[bad]));pass('SQL independently rejects private fields and wrong mappings');
 await db.query("update bookings set check_out='2027-02-05'");await assert.rejects(()=>run(raw(19,'cancelled')));await db.query("update bookings set check_out='2027-02-04'");pass('unreviewed local calendar edit cannot be overwritten');
 for(const role of ['anon','authenticated','service_role']){await db.query('set role '+role);try{await assert.rejects(()=>db.query('select * from helm_airbnb_bookings.scope'));if(role!=='service_role')await assert.rejects(()=>store.receipt(id(10)));}finally{await db.query('reset role');}}pass('browser denied RPCs and all service direct private-table access denied');
 await db.query(sql);assert.deepEqual(await store.receipt(id(10)),original);pass('reinstall preserves original durable receipt');
 await db.query(readFileSync(new URL('../docs/guesty-exit/staging-storage/airbnb-message-timing.sql',import.meta.url),'utf8'));
 const timingRaw=raw(30,'new',{booking_id:id(31),ota_reservation_code:'SYNTHETICTIMING',arrival_date:'2040-06-01',departure_date:'2040-06-04',
  inserted_at:await scalar(`select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') v`),
  rooms:[{room_type_id:id(2),rate_plan_id:id(3),checkin_date:'2040-06-01',checkout_date:'2040-06-04'}]});
 await db.query("insert into helm_airbnb_bookings.message_clock_policy(generation,environment,remote_property,arrival_time,departure_time,timezone,starts_at,expires_at) values(1,'staging',$1,'16:00','11:00','America/New_York',clock_timestamp()-interval '1 hour','2091-01-01')",[id(1)]);
 await run(timingRaw);const timingReceipt=await store.receipt(id(30)),timingId=timingReceipt.canonicalBookingId;
 const schedule=()=>scalar('select helm_airbnb_message_schedule($1) v',[timingId]);
 assert.equal(await schedule(),null);await db.query('update helm_airbnb_bookings.message_clock_policy set enabled=true');assert.equal(await schedule(),null);
 pass('timing requires enabled policy AND explicit origin evidence, never infers new from provider status');
 await db.query("insert into helm_airbnb_bookings.message_origins(booking_id,first_revision,generation,origin,evidence_id,enabled) values($1,$2,1,'new','SYNTHETIC-reviewed-origin',true)",[timingId,id(30)]);
 const plan=await schedule();assert.equal(plan.canSend,false);assert.equal(plan.plans.length,6);
 assert.equal(Date.parse(plan.plans[0].fireAt),Date.parse(timingReceipt.committedAt)+30*60000);
 assert.equal(plan.plans.find(p=>p.workflow==='key_code').fireAt,'2040-06-01T19:00:00.000000Z');
 assert.equal(plan.plans.find(p=>p.workflow==='cleaner_arrival').fireAt,'2040-06-01T13:00:00.000000Z');
 assert.ok(plan.plans.every(p=>p.blockedReason===null));pass('six provider timing candidates preserve 3 PM guest code and 9 AM cleaner times');
 await run(timingRaw);assert.deepEqual(await schedule(),plan);pass('replay cannot restart confirmation timer');
 await db.query("update helm_airbnb_bookings.message_origins set origin='migrated',original_confirmed_at=clock_timestamp()-interval '2 days' where booking_id=$1",[timingId]);
 const migrated=await schedule();assert.equal(migrated.confirmationBasis,'original-confirmation');assert.ok(migrated.plans.every(p=>p.blockedReason==='source-message-history-required'));pass('migrated stays preserve original confirmation and require prior message history');
 await db.query("update helm_airbnb_bookings.message_origins set origin='new',original_confirmed_at=null where booking_id=$1",[timingId]);
 await db.query('update helm_airbnb_bookings.message_clock_policy set generation=2');assert.equal(await schedule(),null);await db.query('update helm_airbnb_bookings.message_clock_policy set generation=1');
 await db.query('update helm_airbnb_bookings.message_origins set enabled=false where booking_id=$1',[timingId]);assert.equal(await schedule(),null);await db.query('update helm_airbnb_bookings.message_origins set enabled=true where booking_id=$1',[timingId]);pass('scope generation drift and withdrawn origin evidence stop timing');
 const changed=structuredClone(timingRaw);changed.id=id(33);changed.attributes.status='modified';
 changed.attributes.arrival_date=changed.attributes.rooms[0].checkin_date='2040-06-02';
 changed.attributes.inserted_at=await scalar(`select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') v`);
 await run(changed);const movedPlan=await schedule();assert.equal(movedPlan.plans[0].fireAt,plan.plans[0].fireAt);
 assert.equal(movedPlan.plans.find(p=>p.workflow==='key_code').fireAt,'2040-06-02T19:00:00.000000Z');pass('date modification updates arrival messages while preserving first confirmation clock');
 const shortStay=structuredClone(changed);shortStay.id=id(34);
 shortStay.attributes.arrival_date=shortStay.attributes.rooms[0].checkin_date=await scalar("select (current_date+2)::text v");
 shortStay.attributes.departure_date=shortStay.attributes.rooms[0].checkout_date=await scalar("select (current_date+4)::text v");
 shortStay.attributes.inserted_at=await scalar(`select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') v`);
 await run(shortStay);assert.equal((await schedule()).plans.find(p=>p.workflow==='cleaner_advance').blockedReason,'past-due-policy-required');pass('short-notice cleaner reminder is flagged rather than silently skipped or sent late');
 const cancelled=structuredClone(shortStay);cancelled.id=id(32);cancelled.attributes.status='cancelled';cancelled.attributes.inserted_at=await scalar(`select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') v`);
 await run(cancelled);assert.equal(await schedule(),null);pass('cancelled provider stay has no timing candidates');
 for(const role of ['anon','authenticated','service_role']){await db.query('set role '+role);try{await assert.rejects(()=>db.query('update helm_airbnb_bookings.message_origins set enabled=true'));if(role!=='service_role')await assert.rejects(schedule);}finally{await db.query('reset role');}}pass('workers cannot manufacture origin evidence and browsers cannot read timing');
 console.log(`PASS ${count} provider storage checks; no hosted changes or outbound requests`);
}finally{for(const c of connections)await c.end();if(running)ctl('-m','immediate','-w','stop');rmSync(root,{recursive:true,force:true});}
