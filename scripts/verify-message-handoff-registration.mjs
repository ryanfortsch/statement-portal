// Continuation of the disposable PostgreSQL harness. Synthetic rows and HTTP only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { renderScheduledMessage, runScheduledChannexMessages } from '../src/lib/channex-messaging/scheduled.ts';
import { ChannexMessageTransport } from '../src/lib/channex-messaging/transport.ts';
import { quoFromNumber } from '../src/lib/quo-lines.ts';
export async function verifyMessageHandoff({ db, a, b }) {
 let count=0;const pass=s=>{count++;console.log(`PASS handoff: ${s}`);};
 await db.query(readFileSync(new URL('../docs/guesty-exit/staging-storage/message-handoff-registration.sql',import.meta.url),'utf8'));
 const scalar=async(sql,args=[],c=db)=>(await c.query(sql,args)).rows[0].data;
 const canon=f=>scalar('select automation_message_stay_revision($1) data',[f.booking]);
 const current=f=>scalar('select automation_message_observation_current($1) data',[f.booking]);
 const observe=(f,obs=f.obs,expected=null,c=db)=>scalar('select automation_message_observe_times($1,$2,$3,$4) data',[f.booking,f.canonical,expected,obs],c);
 const bind=(f,body=f.binding)=>scalar('select automation_message_bind_thread($1,$2) data',[f.booking,body]);
 const register=(f,review=f.review,c=db)=>scalar('select automation_message_register_handoff($1,$2) data',[f.send,review],c);
 const snapshot=f=>scalar('select automation_channex_snapshot($1) data',[f.send]);
 const fixture=async(flow='key_code',held=false,imminent=false)=>{
  const f={booking:randomUUID(),send:randomUUID(),rule:randomUUID(),generation:randomUUID(),property:`HELMTEST-handoff-${randomUUID()}`,flow};
  f.scope={environment:'staging',propertyId:randomUUID(),channelId:randomUUID(),provider:'Airbnb'};
  f.target={channex_booking_id:randomUUID(),thread_id:randomUUID()};
  const times=await scalar(`select jsonb_build_object('observed',date_trunc('milliseconds',clock_timestamp()),
   'stopped',clock_timestamp()-interval '3 minutes','drained',clock_timestamp()-interval '2 minutes',
   'check_in',(clock_timestamp() at time zone 'UTC')::date+20,'check_out',(clock_timestamp() at time zone 'UTC')::date+23,
   'confirmed',date_trunc('milliseconds',clock_timestamp())-interval '30 minutes'+case when $1 then interval '2 seconds' else interval '20 minutes' end) data`,[imminent]);
  const arrival=new Date(`${times.check_in}T16:00:00Z`), departure=new Date(`${times.check_out}T11:00:00Z`);
  f.fire=flow==='confirmation'?new Date(Date.parse(times.confirmed)+1800000):new Date(
   flow==='pre_checkout'?departure.getTime()-86400000:arrival.getTime()-(flow==='pre_arrival'?86400000:flow==='key_code'?3600000:flow==='cleaner_advance'?864000000:25200000));
  await db.query("insert into properties(id,automations_enabled,calendar_authority,default_checkout_time,name,region) values($1,true,'helm','11:00',$1,'HELMTEST')",[f.property]);
  await db.query("insert into bookings(id,property_id,status,check_in,check_out,channel,guest_name) values($1,$2,'confirmed',$3,$4,'airbnb','HELMTEST')",[f.booking,f.property,times.check_in,times.check_out]);
  const trigger={confirmation:'booking_confirmed',pre_arrival:'pre_arrival',pre_checkout:'pre_checkout',key_code:'checkin_day',cleaner_advance:'pre_arrival',cleaner_arrival:'checkin_day'}[flow];
  await db.query("insert into message_automations values($1,$2,$3,$4,'auto',true,false,'{}','HELMTEST synthetic reminder','UTC',null,$5)",[f.rule,f.property,flow,flow.startsWith('cleaner')?'cleaner':'guest',trigger]);
  await db.query("insert into property_rate_plans values($1,'16:00','11:00')",[f.property]);
  await db.query("insert into automation_sends select $1,id,property_id,$2,$3,$4,$5,check_in,check_out,null,null,null,clock_timestamp(),null from bookings where id=$6",[f.send,f.rule,flow,held?'held':'scheduled',f.fire,f.booking]);
  await db.query("insert into automation_channex_routes values($1,'staging',$2,$3,'Airbnb',$4,false,$5,$6)",[f.property,f.scope.propertyId,f.scope.channelId,f.generation,times.stopped,times.drained]);
  f.canonical=await canon(f);
  f.obs={check_in:times.check_in,check_out:times.check_out,arrival_time:null,departure_time:null,confirmed_at:times.confirmed,
   observed_at:times.observed,source_revision:`HELMTEST:${randomUUID()}`,evidence_id:`HELMTEST:${randomUUID()}`};
  f.observation=await observe(f);
  f.binding={...f.target,canonical_revision:f.canonical,route_generation:f.generation,verified_at:times.observed,evidence_id:`HELMTEST:${randomUUID()}`};
  await bind(f);
  f.review={review_id:randomUUID(),context_revision:await scalar('select automation_channex_context($1) data',[f.send]),observation_revision:f.observation,
   complete:true,sent:false,queued:false,uncertain:false,evidence_id:`HELMTEST:${randomUUID()}`,observed_at:times.observed,
   stopped_at:times.stopped,drained_at:times.drained,expires_at:new Date(f.fire.getTime()+86400000).toISOString(),workflow:flow};
  if(flow.startsWith('cleaner')){f.review.from_number=quoFromNumber('ops');f.review.recipient_phones=['+12025550141','+12025550142'];}
  return f;
 };
 let f=await fixture();assert.equal(await current(f),true);assert.equal(await observe(f),f.observation);pass('verified null overrides persist and lost-ack replay keeps the same observation identity');
 await db.query("set timezone='America/New_York'");assert.equal(await current(f),true);assert.equal(await observe(f),f.observation);
 await db.query("set timezone='UTC'");pass('source provenance and retry identity are stable across database session time zones');
 for(const patch of [{arrival_time:undefined},{observed_at:'2026-01-01T00:00:00Z'},{observed_at:new Date(Date.now()+3600000).toISOString()},
   {arrival_time:'24:00'},{arrival_time:'09:30+01'},{confirmed_at:'infinity'},{source_revision:''},{check_in:'2020-01-01'},{extra:'unexpected'}]){
  await assert.rejects(observe(f,{...f.obs,...patch},f.observation));
 }assert.equal(await current(f),true);pass('missing, stale, future, mismatched and malformed observations reject without changing current timing');
 const next=()=>({...f.obs,observed_at:new Date().toISOString(),arrival_time:'17:00',source_revision:`HELMTEST:${randomUUID()}`});
 await delay(5);const concurrent=await Promise.allSettled([observe(f,next(),f.observation,a),observe(f,next(),f.observation,b)]);
 assert.equal(concurrent.filter(x=>x.status==='fulfilled').length,1);pass('competing timing observations use compare-and-swap and cannot overwrite a newer revision');
 f=await fixture();await db.query('update bookings set check_in=check_in+1 where id=$1',[f.booking]);assert.equal(await current(f),false);
 await db.query('update bookings set check_in=check_in-1 where id=$1',[f.booking]);assert.equal(await current(f),false);
 await assert.rejects(register(f),/future-unsent/);pass('canonical date changes invalidate timing even after dates are changed back');
 f=await fixture();await db.query("update automation_channex_stay_times set arrival_time='18:00' where booking_id=$1",[f.booking]);
 assert.equal(await current(f),false);await assert.rejects(register(f),/future-unsent/);pass('editing raw timing bypasses neither provenance nor registration checks');
 f=await fixture();await db.query('update bookings set check_in=check_in+1,check_out=check_out+1 where id=$1',[f.booking]);
 const changed=await scalar('select jsonb_build_object(\'check_in\',check_in,\'check_out\',check_out) data from bookings where id=$1',[f.booking]);
 f.canonical=await canon(f);await delay(2);assert.notEqual(await observe(f,{...f.obs,...changed,observed_at:new Date().toISOString()},f.observation),f.observation);
 assert.equal(await current(f),true);
 assert.equal(await scalar('select count(*)::int data from automation_message_observation_history where booking_id=$1',[f.booking]),2);
 assert.equal(await scalar('select source_revision data from automation_message_observation_history where revision=$1',[f.observation]),f.obs.source_revision);
 pass('a fresh observation restores valid timing and retains the previous revision provenance');
 f=await fixture();assert.equal(await bind(f),true);await assert.rejects(bind(f,{...f.binding,thread_id:randomUUID()}),/identity conflict/);
 await assert.rejects(bind(f,{...f.binding,route_generation:randomUUID()}),/binding mismatch/);pass('same binding is idempotent; thread or route-generation remapping is rejected');
 const other=await fixture();await db.query('delete from automation_message_thread_bindings where booking_id=$1',[other.booking]);
 // Bind a second canonical stay under the same property/route and provider IDs.
 await db.query('update bookings set property_id=$1 where id=$2',[f.property,other.booking]);other.canonical=await canon(other);
 await delay(2);await observe(other,{...other.obs,observed_at:new Date().toISOString()},other.observation);
 await assert.rejects(bind(other,{...f.binding,canonical_revision:other.canonical}),/duplicate key/);pass('one external booking or thread cannot be assigned to two canonical stays');
 for(const [field,value] of [['complete',false],['sent',true],['queued',true],['uncertain',true],['sent','false']]){
  f=await fixture();await assert.rejects(register(f,{...f.review,[field]:value}),/future-unsent/);
  assert.equal(await scalar('select count(*)::int data from automation_channex_jobs where send_id=$1',[f.send]),0);
 }pass('incomplete, already-sent, still-queued, uncertain or string-boolean history cannot create a new job');
 f=await fixture();for(const patch of [{observed_at:new Date(Date.now()-3600000).toISOString()},{expires_at:f.fire.toISOString()},
   {stopped_at:new Date().toISOString()},{drained_at:new Date(Date.now()+3600000).toISOString()}]){
  await assert.rejects(register(f,{...f.review,...patch}));
 }pass('stale evidence, mismatched stop/drain and invalid source expiry block registration');
 f=await fixture();await db.query("update message_automations set body='HELMTEST changed after review' where id=$1",[f.rule]);
 await assert.rejects(register(f),/future-unsent/);pass('template changes after review invalidate the reviewed context');
 f=await fixture();await db.query("update message_automations set trigger='booking_confirmed' where id=$1",[f.rule]);
 f.review.context_revision=await scalar('select automation_channex_context($1) data',[f.send]);
 await assert.rejects(register(f),/rule binding/);pass('a different workflow cannot be assigned to a coincidentally matching schedule');
 f=await fixture();await db.query("update automation_sends set fire_at=fire_at+interval '1 hour' where id=$1",[f.send]);
 await assert.rejects(register(f),/schedule mismatch/);
 assert.equal(await scalar('select delivery_used data from automation_sends where id=$1',[f.send]),null);
 assert.equal(await scalar('select count(*)::int data from automation_message_handoffs where send_id=$1',[f.send]),0);pass('schedule mismatch rolls back job, source audit and native-row reservation together');
 for(const flow of ['confirmation','pre_arrival','key_code','pre_checkout','cleaner_advance','cleaner_arrival']){
  f=await fixture(flow,true);assert.equal(await register(f),true);assert.equal(await register(f),true);
  assert.equal(await scalar('select status data from automation_sends where id=$1',[f.send]),'held');
  assert.equal(await scalar('select enabled data from automation_channex_routes where property_id=$1',[f.property]),false);
  if(flow.startsWith('cleaner')){
   assert.equal(await scalar('select enabled data from automation_cleaner_batches where send_id=$1',[f.send]),false);
   assert.equal(await scalar('select count(*)::int data from automation_cleaner_jobs where send_id=$1',[f.send]),2);
  }else{assert.equal(Date.parse((await snapshot(f)).fireAt),f.fire.getTime());
   assert.ok(renderScheduledMessage(await snapshot(f)).bodySha256);}
  await assert.rejects(register(f,{...f.review,review_id:randomUUID()}),/identity conflict/);
 }pass('all six workflows retain holds, schedules, unique jobs and separate activation; exact reviews replay safely');
 const g=await fixture(),c=await fixture('cleaner_arrival');await db.query('begin');
 await register(g);await assert.rejects(register(c,{...c.review,recipient_phones:['+12025550141','+12025550141']}));await db.query('rollback');
 assert.equal(await scalar('select count(*)::int data from automation_message_handoffs where send_id=any($1::uuid[])',[[g.send,c.send]]),0);
 assert.equal(await scalar('select delivery_used data from automation_sends where id=$1',[g.send]),null);pass('multi-workflow handoff transaction rolls back every registration on one invalid recipient list');
 f=await fixture();await register(f);await db.query("update bookings set status='cancelled' where id=$1",[f.booking]);
 assert.equal((await snapshot(f)).input,null);pass('later cancellation invalidates the actual worker render source');
 f=await fixture('cleaner_arrival');await register(f);await db.query('update bookings set check_out=check_out+1 where id=$1',[f.booking]);
 const child=await scalar('select id data from automation_cleaner_jobs where send_id=$1 limit 1',[f.send]);
 assert.equal((await scalar('select automation_cleaner_snapshot($1) data',[child])).input,null);pass('the same provenance gate blocks stale cleaner rendering');
 f=await fixture();for(const role of ['anon','authenticated','service_role']){
  await db.query(`set role ${role}`);
  for(const [sql,args] of [['select automation_message_observe_times($1,$2,$3,$4)',[f.booking,f.canonical,null,f.obs]],
   ['select automation_message_bind_thread($1,$2)',[f.booking,f.binding]],['select automation_message_register_handoff($1,$2)',[f.send,f.review]],
   ['select * from automation_message_handoffs',[]]])await assert.rejects(db.query(sql,args),/permission denied/);
  await db.query('reset role');
 }pass('browser and worker roles cannot ingest observations, bind identities or register handoffs');
 // Real adapter/SQL end-to-end, with fake transport HTTP. Let a genuine future
 // confirmation become due; no fixture time travel or direct timing/job mutation.
 f=await fixture('confirmation',false,true);await register(f);
 const rpc=async(name,args)=>{
  const map={automation_channex_candidates:['select automation_channex_candidates($1,$2,$3) data',[args.p_property_id,args.p_environment,args.p_limit]],
   automation_channex_snapshot:['select automation_channex_snapshot($1) data',[args.p_send_id]],
   automation_channex_read:['select automation_channex_read($1) data',[args.p_send_id]],
   automation_channex_refresh:['select automation_channex_refresh($1,$2,$3,$4) data',[args.p_send_id,args.p_revision,args.p_body_sha256,args.p_fire_at]],
   automation_channex_claim:['select automation_channex_claim($1,$2,$3) data',[args.p_send_id,args.p_attempt_id,args.p_attempt]],
   automation_channex_finish:['select automation_channex_finish($1,$2,$3,$4,$5) data',[args.p_send_id,args.p_attempt_id,args.p_state,args.p_provider_id,args.p_rejection_status]],
   automation_channex_checked:['select automation_channex_checked($1) data',[args.p_send_id]]};
  assert.ok(map[name]);return {data:await scalar(...map[name]),error:null};
 };
 let posts=0;const messageId=randomUUID();
 const transportFactory=()=>new ChannexMessageTransport({scope:f.scope,apiKey:'HELMTEST',sendEnabled:true,fetcher:async(url,init)=>{
  const rel=id=>({data:{id}});
  const message={id:messageId,type:'message',attributes:{sender:'property',message:'HELMTEST synthetic reminder',attachments:[]},
   relationships:{message_thread:rel(f.target.thread_id)}};
  if(init.method==='POST'){posts++;return Response.json({data:message});}
  if(url.includes('/messages?'))return Response.json({data:[message],meta:{page:1,limit:100,total:1}});
  return Response.json({data:{id:f.target.thread_id,type:'message_thread',attributes:{provider:'Airbnb',is_closed:false},
   relationships:{property:rel(f.scope.propertyId),channel:rel(f.scope.channelId),booking:rel(f.target.channex_booking_id)}}});
 }});
 const tick=()=>runScheduledChannexMessages({config:{propertyId:f.property,environment:'staging',apiKey:'HELMTEST'},rpc,transportFactory});
 await delay(2100);await tick();assert.equal(posts,0);
 await db.query('update automation_channex_routes set enabled=true where property_id=$1',[f.property]);
 assert.equal((await tick()).accepted,1);assert.equal(posts,1);
 assert.equal((await tick()).recorded,1);assert.equal(posts,1);pass('verified registration reaches the actual worker and durable receipt after separate enablement, with exactly one synthetic send');
 console.log(`PASS ${count} additional local handoff PostgreSQL scenarios; no live provider calls`);
}
