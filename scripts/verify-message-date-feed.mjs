// Local PostgreSQL only. Real route/observation/feed SQL, fictional durable revision
// fixtures. This does not simulate a live OTA or enable a guest/cleaner sender.
import assert from 'node:assert/strict';
import { verifyTimingBootstrap } from './verify-message-timing-bootstrap.mjs';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CALDERWOOD_STAGING as mapping } from '../src/lib/calderwood-readonly/channex.ts';
import { createMappedCanonicalRevisionAccess } from '../src/lib/channex-staging/canonical-revision-mapped.ts';
export async function verifyMessageDateFeed({db,a,b,scalar}) {
 let count=0;const pass=s=>{count++;console.log('PASS message date feed: '+s);};
 const sql=name=>readFileSync(new URL('../docs/guesty-exit/staging-storage/'+name+'.sql',import.meta.url),'utf8');
 const property='HELMTEST-calderwood',booking=randomUUID(),remote=randomUUID(),connection='HELMTEST-dates',generation=1;
 await db.query(`alter table bookings add column source_ref text,add column source text;
 create table helm_inventory_capture_scopes(property_id text primary key,enabled boolean);
 create table helm_booking_inventory_consumers(property_id text primary key,configuration jsonb);`);
 await db.query(sql('canonical-revisions'));await db.query(sql('inventory-routes'));await db.query(sql('canonical-revision-routing'));
 await db.query(sql('message-date-feed'));
 await db.query("insert into properties(id,automations_enabled,calendar_authority,default_checkout_time,name,region) values($1,false,'helm','11:00',$1,'HELMTEST')",[property]);
 await db.query("insert into bookings(id,property_id,status,check_in,check_out,channel,guest_name,source_ref,source) values($1,$2,'confirmed','2027-02-01','2027-02-04','other','HELMTEST',$3,'manual')",[booking,property,'channex-staging:'+remote]);
 await db.query('insert into helm_channex_revisions.scope values(true,$1,true)',[property]);
 await db.query('insert into helm_inventory_capture_scopes values($1,true)',[property]);
 await db.query('insert into helm_booking_inventory_consumers values($1,$2)',[property,{connection,generation,listing:mapping.roomTypeId,environment:'staging',topology:'single-unit',timeZone:'America/New_York',publishEnabled:false}]);
 await db.query("insert into helm_staging_inventory_routes(property_id,connection,generation,provider_property_id,room_type_id,rate_plan_id,property_title,rate_plan_title,adults,children,infants) values($1,$2,$3,$4,$5,$6,'65 Calderwood - Isolated Staging','TEST ONLY - Calderwood',6,0,0)",[property,connection,generation,mapping.propertyId,mapping.roomTypeId,mapping.ratePlanId]);
 const route=await scalar('select helm_pilot_revision_route() data');
 const receipt=async()=>{
  const dates=await scalar("select jsonb_build_object('checkIn',check_in,'checkOut',check_out,'status',case when status='cancelled' then 'cancelled' else 'modified' end) data from bookings where id=$1",[booking]);
  const revision={id:randomUUID(),bookingId:remote,...mapping,code:'HELMTEST-dates',...dates,receivedAt:new Date().toISOString()};
  await db.query('insert into helm_channex_revisions.bookings values($1,$2,$3,$4,$5) on conflict(remote_id) do update set latest_revision=excluded.latest_revision,latest_at=excluded.latest_at',[remote,booking,revision.code,revision.receivedAt,revision.id]);
  await db.query("insert into helm_channex_revisions.receipts(revision_id,canonical_id,revision,outcome) values($1,$2,$3,'applied')",[revision.id,booking,revision]);
  return revision;
 };
 await receipt();
 const observe=async(patch={})=>{
  const canonical=await scalar('select automation_message_stay_revision($1) data',[booking]);
  const old=await scalar('select (select revision from automation_message_observations where booking_id=$1) data',[booking]);
  const facts=await scalar("select jsonb_build_object('check_in',check_in,'check_out',check_out,'observed_at',clock_timestamp(),'confirmed_at',clock_timestamp()-interval '2 days') data from bookings where id=$1",[booking]);
  return scalar('select automation_message_observe_times($1,$2,$3,$4) data',[booking,canonical,old,{...facts,arrival_time:'16:00',departure_time:'11:00',source_revision:'HELMTEST:'+randomUUID(),evidence_id:'HELMTEST:'+randomUUID(),...patch}]);
 };
 let observation=await observe({confirmed_at:null});
 const expiry=new Date(Date.now()+60*86400000).toISOString(),evidence='HELMTEST-clock-policy';
 const register=(enabled=false)=>scalar('select helm_pilot_message_times_register($1,$2,$3,$4,$5,$6,$7) data',[booking,observation,connection,generation,evidence,expiry,enabled]);
 await assert.rejects(register(),/Reviewed message clock policy/);
 pass('original confirmation time is mandatory; receipt/import time cannot invent it');
 observation=await observe();await register();
 const history=()=>scalar('select count(*)::int data from automation_message_observation_history where booking_id=$1',[booking]);
 const times=()=>scalar('select to_jsonb(t) data from automation_channex_stay_times t where booking_id=$1',[booking]);
 const refresh=(client=db)=>scalar('select helm_pilot_message_times_refresh($1,$2,100) data',[connection,generation],client);
 assert.equal((await refresh()).scanned,0);await db.query('update helm_channex_revisions.message_timing_policies set enabled=true');
 const before=await times();assert.equal((await refresh()).unchanged,1);
 pass('registration defaults off; enabled steady-state scans preserve the original observation');
 await db.query('update bookings set check_in=check_in+1,check_out=check_out+1 where id=$1',[booking]);
 assert.equal((await refresh()).blocked,1);assert.deepEqual(await times(),before);
 pass('a date change without a matching durable provider receipt cannot advance message timing');
 const moved=await receipt();const prior=await history();
 const [one,two]=await Promise.all([refresh(a),refresh(b)]);
 assert.equal(one.refreshed+two.refreshed,1);assert.equal(one.unchanged+two.unchanged,1);assert.equal(await history(),prior+1);
 const after=await times();assert.equal(after.check_in,'2027-02-02');assert.equal(after.check_out,'2027-02-05');
 assert.equal(after.arrival_time,before.arrival_time);assert.equal(after.departure_time,before.departure_time);assert.equal(after.confirmed_at,before.confirmed_at);
 assert.equal(await scalar('select source_revision data from automation_message_observations where booking_id=$1',[booking]),'channex-date:'+moved.id);
 assert.equal(await scalar('select automation_message_observation_current($1) data',[booking]),true);
 pass('competing automatic refreshes consume one durable date move, retaining reviewed clocks and actual confirmation');
 // Lost response after the database commit. The same adapter recovers by another
 // bounded scan; it never needs an un-ACKed provider event or a manual timing packet.
 await db.query('update bookings set check_in=check_in+1,check_out=check_out+1 where id=$1',[booking]);await receipt();
 let lose=true;
 const access=createMappedCanonicalRevisionAccess('https://jgkblfozftcvymvwhhii.supabase.co','HELMTEST',async(input,init)=>{
  assert.ok(String(input).endsWith('/helm_pilot_message_times_refresh'));
  assert.deepEqual(JSON.parse(init.body),{p_connection:connection,p_generation:generation,p_limit:100});
  await db.query('set role service_role');let result;
  try{result=await refresh();}finally{await db.query('reset role');}
  if(lose)throw Error('HELMTEST lost response');return Response.json(result);
 });
 await assert.rejects(access.refreshMessageDates(route));const saved=await history();lose=false;
 assert.equal((await access.refreshMessageDates(route)).unchanged,1);assert.equal(await history(),saved);
 pass('lost refresh reply recovers through the service RPC without a duplicate observation or provider call');
 // Savepoints isolate negative cases and retain the known-good policy cursor.
 for(const [label,change] of [
  ['manual edit and revert',async()=>{await db.query('update bookings set check_in=check_in+1 where id=$1',[booking]);await db.query('update bookings set check_in=check_in-1 where id=$1',[booking]);}],
  ['owner clock revision',()=>observe({arrival_time:'17:00'})],
  ['wrong source identity',()=>db.query("update bookings set source_ref='HELMTEST-wrong' where id=$1",[booking])],
  ['duplicate stay',()=>db.query('update bookings set duplicate_of=$1 where id=$2',[randomUUID(),booking])],
  ['different policy generation',()=>db.query('update helm_channex_revisions.message_timing_policies set generation=2')],
 ]) {
  await db.query('begin');try{await change();const priorTimes=await times();assert.equal((await refresh()).blocked,1);assert.deepEqual(await times(),priorTimes);}finally{await db.query('rollback');}
  pass(label+' cannot silently replace the reviewed clock policy');
 }
 for(const change of ["update bookings set status='cancelled' where id=$1","update helm_channex_revisions.message_timing_policies set expires_at=clock_timestamp()-interval '1 second' where booking_id=$1"]){
  await db.query('begin');try{await db.query(change,[booking]);const priorTimes=await times();assert.equal((await refresh()).inactive,1);assert.deepEqual(await times(),priorTimes);}finally{await db.query('rollback');}
 }
 pass('cancellation and review expiry stop automatic refresh without renewing authority');
 await assert.rejects(scalar('select helm_pilot_message_times_refresh($1,2,100) data',[connection]),/reviewed_revision_route/);
 await db.query('update helm_channex_revisions.scope set enabled=false');await assert.rejects(refresh(),/revision_import_disabled/);
 await db.query('update helm_channex_revisions.scope set enabled=true');
 for(const role of ['anon','authenticated','service_role']){
  await db.query('set role '+role);
  try{
   await assert.rejects(register(true),/permission denied/);
   await assert.rejects(db.query('select * from helm_channex_revisions.message_timing_policies'),/permission denied/);
   if(role==='service_role')assert.equal((await refresh()).unchanged,1);else await assert.rejects(refresh(),/permission denied/);
  }finally{await db.query('reset role');}
 }
 pass('route generation and disabled scope fence the service RPC; browser roles cannot refresh and workers cannot register policies');
 assert.equal(await scalar('select count(*)::int data from automation_sends where booking_id=$1',[booking]),0);
 assert.equal(await scalar('select automations_enabled data from properties where id=$1',[property]),false);
 assert.equal(await scalar('select count(*)::int data from automation_channex_routes where property_id=$1',[property]),0);
 assert.equal(await scalar('select count(*)::int data from automation_cleaner_batches where property_id=$1',[property]),0);
 pass('automatic timing never creates a message, releases a hold or enables a sender');
 console.log(`PASS ${count} additional message date-feed PostgreSQL scenarios; zero provider calls`);
 await verifyTimingBootstrap({db,a,b,scalar,connection,generation});
}
