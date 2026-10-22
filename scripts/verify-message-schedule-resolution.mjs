// Synthetic per-message DST handoff evidence. No source data or provider network.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export async function verifyScheduleResolution({db,fixture,scalar}) {
 let count=0;const pass=s=>{count++;console.log(`PASS schedule resolution: ${s}`);};
 const register=(f,review=f.review)=>scalar('select automation_message_register_handoff($1,$2) data',[f.send,review]);
 const proofCount=f=>scalar('select count(*)::int data from automation_message_schedule_resolutions where send_id=$1',[f.send]);
 const schedule=f=>scalar(`select ${f.flow.startsWith('cleaner')?'automation_cleaner_schedule':'automation_channex_schedule'}($1) data`,[f.send]);
 const context=f=>scalar('select automation_channex_context($1) data',[f.send]);
 const observation=async(f,patch={})=>{
  await delay(2);
  f.canonical=await scalar('select automation_message_stay_revision($1) data',[f.booking]);
  f.obs={...f.obs,...patch,observed_at:new Date().toISOString(),source_revision:`HELMTEST:${randomUUID()}`};
  f.observation=await scalar('select automation_message_observe_times($1,$2,$3,$4) data',[f.booking,f.canonical,f.observation,f.obs]);
 };
 const dst=async(flow='pre_checkout',season='fall',choice='elapsed_at')=>{
  const f=await fixture(flow,true);
  const year=new Date().getUTCFullYear()+1,month=season==='fall'?10:2;
  const first=new Date(Date.UTC(year,month,1));
  const sunday=1+(7-first.getUTCDay())%7+(season==='spring'?7:0);
  const anchor=Date.UTC(year,month,sunday),day=86400000;
  const checkIn=new Date(anchor-(flow==='pre_checkout'?3*day:0)).toISOString().slice(0,10);
  const checkOut=new Date(anchor+(flow==='pre_checkout'?0:3*day)).toISOString().slice(0,10);
  await db.query('update bookings set check_in=$2,check_out=$3 where id=$1',[f.booking,checkIn,checkOut]);
  await db.query('update automation_sends set planned_check_in=$2,planned_check_out=$3 where id=$1',[f.send,checkIn,checkOut]);
  await db.query("update message_automations set timezone='America/New_York' where id=$1",[f.rule]);
  await observation(f,{check_in:checkIn,check_out:checkOut});
  f.candidates=await scalar('select to_jsonb(c) data from automation_message_schedule_candidates($1,$2) c',[f.send,flow]);
  assert.notEqual(f.candidates.calendar_at,f.candidates.elapsed_at);
  assert.equal(Math.abs(Date.parse(f.candidates.calendar_at)-Date.parse(f.candidates.elapsed_at)),3600000);
  f.fire=new Date(f.candidates[choice]);
  await db.query('update automation_sends set fire_at=$2 where id=$1',[f.send,f.fire]);
  await delay(2);
  const stamp=new Date().toISOString();
  await db.query('update automation_channex_routes set source_stopped_at=$2,source_drained_at=$2 where property_id=$1',[f.property,stamp]);
  f.review={...f.review,context_revision:await context(f),observation_revision:f.observation,
   observed_at:stamp,stopped_at:stamp,drained_at:stamp,expires_at:new Date(f.fire.getTime()+day).toISOString(),
   source_schedule:{scheduled_at:f.fire.toISOString(),observed_at:stamp,evidence_id:`HELMTEST:queue:${randomUUID()}`}};
  return f;
 };
 for(const flow of ['pre_arrival','pre_checkout','cleaner_advance'])for(const season of ['spring','fall'])for(const choice of ['calendar_at','elapsed_at']){
  const f=await dst(flow,season,choice);
  const without={...f.review};delete without.source_schedule;
  await assert.rejects(register(f,without),/schedule mismatch/);assert.equal(await proofCount(f),0);
  assert.equal(await register(f),true);assert.equal(await register(f),true);
  assert.equal((await schedule(f)).getTime(),f.fire.getTime());assert.equal(await proofCount(f),1);
  assert.equal(await scalar('select status data from automation_sends where id=$1',[f.send]),'held');
  assert.equal(await scalar('select enabled data from automation_channex_routes where property_id=$1',[f.property]),false);
  if(flow.startsWith('cleaner'))assert.equal(await scalar('select enabled data from automation_cleaner_batches where send_id=$1',[f.send]),false);
  await assert.rejects(register(f,{...f.review,source_schedule:{...f.review.source_schedule,evidence_id:'HELMTEST:different'}}),/identity conflict/);
  await db.query("set timezone='America/New_York'");assert.equal((await schedule(f)).getTime(),f.fire.getTime());await db.query("set timezone='UTC'");
  pass(`${flow} ${season} accepts only the reviewed ${choice}, preserves holds/disabled senders and replays once`);
 }
 let f=await dst();
 const badProofs=[null,[],{}, {...f.review.source_schedule,extra:'unexpected'},
  {...f.review.source_schedule,scheduled_at:'infinity'}, {...f.review.source_schedule,scheduled_at:f.fire.toISOString().slice(0,-1)},
  {...f.review.source_schedule,scheduled_at:new Date(f.fire.getTime()+3600000).toISOString()},
  {...f.review.source_schedule,observed_at:new Date(Date.now()-3600000).toISOString()},
  {...f.review.source_schedule,observed_at:new Date(Date.now()+3600000).toISOString()},
  {...f.review.source_schedule,evidence_id:''}];
 for(const source_schedule of badProofs){await assert.rejects(register(f,{...f.review,source_schedule}));assert.equal(await proofCount(f),0);}
 assert.equal(await scalar('select delivery_used data from automation_sends where id=$1',[f.send]),null);
 pass('malformed, invented, stale, future and unbound source times roll back without reserving a message');
 for(const patch of [{queued:true},{sent:true},{complete:false},{uncertain:true},{observation_revision:randomUUID()},{context_revision:'stale'}]){
  await assert.rejects(register(f,{...f.review,...patch}));assert.equal(await proofCount(f),0);
 }pass('an exact source timestamp never replaces current provenance or source stop/drain/history review');
 const ordinary=await fixture('pre_checkout');
 await assert.rejects(register(ordinary,{...ordinary.review,source_schedule:{scheduled_at:ordinary.fire.toISOString(),observed_at:ordinary.obs.observed_at,evidence_id:'HELMTEST:ordinary'}}));
 const hourly=await fixture('key_code');
 await assert.rejects(register(hourly,{...hourly.review,source_schedule:{scheduled_at:hourly.fire.toISOString(),observed_at:hourly.obs.observed_at,evidence_id:'HELMTEST:hourly'}}));
 pass('source resolution cannot override ordinary schedules or hourly workflows');
 f=await dst('cleaner_advance');await assert.rejects(register(f,{...f.review,recipient_phones:[]}));
 assert.equal(await proofCount(f),0);assert.equal(await scalar('select count(*)::int data from automation_cleaner_batches where send_id=$1',[f.send]),0);
 pass('later cleaner recipient validation rolls back source resolution and batch together');
 const first=await dst(),second=await dst('cleaner_advance');
 await db.query('begin');await register(first);await assert.rejects(register(second,{...second.review,recipient_phones:[]}));await db.query('rollback');
 assert.equal(await proofCount(first),0);assert.equal(await proofCount(second),0);
 pass('a multi-message handoff rolls back all exact-time evidence when another workflow fails');
 for(const mutation of ['template','timezone','timing','canonical','canonical_change_back']){
  f=await dst();await register(f);
  if(mutation==='template')await db.query("update message_automations set body='HELMTEST revised' where id=$1",[f.rule]);
  if(mutation==='timezone')await db.query("update message_automations set timezone='UTC' where id=$1",[f.rule]);
  if(mutation==='timing')await observation(f,{departure_time:'12:00'});
  if(mutation.startsWith('canonical'))await db.query('update bookings set check_out=check_out+1 where id=$1',[f.booking]);
  if(mutation==='canonical_change_back')await db.query('update bookings set check_out=check_out-1 where id=$1',[f.booking]);
  assert.equal(await schedule(f),null);
  const snap=await scalar('select automation_channex_snapshot($1) data',[f.send]);assert.equal(snap.fireAt,null);
  pass(`${mutation} changes invalidate the exact-time proof at the worker snapshot`);
 }
 f=await dst('cleaner_advance');await register(f);await observation(f);
 const child=await scalar('select id data from automation_cleaner_jobs where send_id=$1 limit 1',[f.send]);
 assert.equal((await scalar('select automation_cleaner_snapshot($1) data',[child])).fireAt,null);
 pass('a new observation invalidates cleaner proof even when the local clock itself is unchanged');
 f=await dst();await register(f);const other=await dst();const without={...other.review};delete without.source_schedule;
 await assert.rejects(register(other,without),/schedule mismatch/);assert.equal(await proofCount(other),0);
 pass('one stay’s reviewed source time cannot resolve another stay');
 for(const role of ['anon','authenticated','service_role']){
  await db.query(`set role ${role}`);
  for(const [sql,args] of [['select * from automation_message_schedule_resolutions',[]],
   ['select automation_message_schedule_candidates($1,$2)',[f.send,f.flow]],
   ['select automation_message_resolved_schedule($1,$2)',[f.send,f.flow]],
   ['select automation_message_register_handoff($1,$2)',[f.send,f.review]]])await assert.rejects(db.query(sql,args),/permission denied/);
  await db.query('reset role');
 }pass('browser and worker roles cannot read private evidence or manufacture a reviewed schedule');
 console.log(`PASS ${count} additional local source-schedule PostgreSQL scenarios; no live provider calls`);
}
