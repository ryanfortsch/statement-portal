// Local disposable database only. Canonical receipts are fictional fixtures;
// the actual service refresh, observation, policy and scheduler functions run.
import assert from 'node:assert/strict';
import { verifyNewStayQueue } from './verify-message-new-stay-queue.mjs';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CALDERWOOD_STAGING as mapping } from '../src/lib/calderwood-readonly/channex.ts';
export async function verifyNewStayTiming({db,scalar,connection,generation}) {
 let count=0;const pass=s=>{count++;console.log('PASS new stay timing: '+s);};
 await db.query(readFileSync(new URL('../docs/guesty-exit/staging-storage/message-new-stay-timing.sql',import.meta.url),'utf8'));
 await db.query("insert into helm_channex_revisions.message_new_stay_clocks(singleton,connection,generation,arrival_time,departure_time,expires_at) values(true,$1,$2,'16:00','11:00',clock_timestamp()+interval '12 hours')",[connection,generation]);
 const receipt=async(f,status='new',ci='2027-02-01',co='2027-02-04')=>{
  const revision=randomUUID(),receivedAt=new Date().toISOString();
  await db.query('update helm_channex_revisions.bookings set latest_revision=$1,latest_at=$2 where remote_id=$3',[revision,receivedAt,f.remote]);
  await db.query("insert into helm_channex_revisions.receipts(revision_id,canonical_id,revision,outcome) values($1,$2,$3,'applied')",[revision,f.booking,{id:revision,bookingId:f.remote,...mapping,code:f.code,status,checkIn:ci,checkOut:co,receivedAt}]);
  return revision;
 };
 const fixture=async()=>{
  const f={booking:randomUUID(),remote:randomUUID(),code:'HELMTEST-new-'+randomUUID()};
  await db.query("insert into bookings(id,property_id,status,check_in,check_out,channel,guest_name,source_ref,source) values($1,'HELMTEST-calderwood','confirmed','2027-02-01','2027-02-04','other','HELMTEST',$2,'manual')",[f.booking,'channex-staging:'+f.remote]);
  await db.query('insert into helm_channex_revisions.bookings values($1,$2,$3,clock_timestamp(),$4)',[f.remote,f.booking,f.code,randomUUID()]);
  f.revision=await receipt(f);return f;
 };
 const refresh=async()=>{await db.query('set role service_role');try{return await scalar('select helm_pilot_message_times_refresh($1,$2,100) data',[connection,generation]);}finally{await db.query('reset role');}};
 const state=f=>scalar(`select jsonb_build_object('time',(select to_jsonb(t) from automation_channex_stay_times t where booking_id=$1),
 'policy',(select to_jsonb(p)-'last_checked_at' from helm_channex_revisions.message_timing_policies p where booking_id=$1),
 'history',(select count(*) from automation_message_observation_history where booking_id=$1),
 'anchor',automation_message_confirmation_anchor($1)) data`,[f.booking]);
 const f=await fixture();await refresh();assert.equal((await state(f)).time,null);
 pass('clock onboarding defaults disabled, even with receipt capture enabled');
 await db.query('update helm_channex_revisions.message_new_stay_clocks set enabled=true');
 await refresh();const initial=await state(f);
 assert.equal(initial.time.arrival_time,'16:00:00');assert.equal(initial.time.departure_time,'11:00:00');
 assert.equal(initial.time.confirmed_at,null);assert.equal(initial.policy.confirmed_at,null);
 assert.equal(initial.policy.confirmation_basis,'helm-first-durable-receipt');assert.equal(initial.policy.receipt_revision,f.revision);
 assert.equal(initial.history,1);assert.equal(initial.policy.enabled,true);
 await refresh();assert.deepEqual(await state(f),initial);
 pass('real service tick bootstraps clocks and date policy once without fabricating confirmation; retry is identical');
 // Demonstrate the schedule through a disabled fictional rule; onboarding itself
 // must never create a send or claim Guesty history has been reviewed.
 assert.equal(await scalar('select count(*)::int data from automation_sends where booking_id=$1',[f.booking]),0);
 const send=randomUUID(),rule=randomUUID();
 await db.query("insert into message_automations(id,property_id,key,audience,send_mode,enabled,configured_in_ota,channel_exclusions,body,timezone,trigger) values($1,'HELMTEST-calderwood','confirmation','guest','auto',false,false,'{}','HELMTEST','America/New_York','booking_confirmed')",[rule]);
 await db.query("insert into automation_sends(id,booking_id,property_id,automation_id,automation_key,status) values($1,$2,'HELMTEST-calderwood',$3,'confirmation','held')",[send,f.booking,rule]);
 const scheduled=flow=>db.query('select * from automation_message_schedule_candidates($1,$2)',[send,flow]).then(r=>r.rows[0]);
 const confirmation=(await scheduled('confirmation')).calendar_at.getTime();
 assert.equal(confirmation,Date.parse(initial.anchor)+1800000);
 await db.query("update bookings set check_in='2027-02-06',check_out='2027-02-09' where id=$1",[f.booking]);
 await receipt(f,'modified','2027-02-06','2027-02-09');await refresh();
 const moved=await state(f);assert.equal(moved.history,2);assert.equal(moved.time.check_in,'2027-02-06');
 assert.equal(moved.time.confirmed_at,null);assert.equal(moved.anchor,initial.anchor);
 assert.equal((await scheduled('confirmation')).calendar_at.getTime(),confirmation);
 assert.equal((await scheduled('key_code')).calendar_at.toISOString(),'2027-02-06T20:00:00.000Z');
 assert.equal((await scheduled('cleaner_arrival')).calendar_at.toISOString(),'2027-02-06T14:00:00.000Z');
 for(const [flow,at] of Object.entries({pre_arrival:'2027-02-05T21:00:00.000Z',pre_checkout:'2027-02-08T16:00:00.000Z',cleaner_advance:'2027-01-27T21:00:00.000Z'})) assert.equal((await scheduled(flow)).calendar_at.toISOString(),at);
 assert.equal(await scalar('select status data from automation_sends where id=$1',[send]),'held');
 await refresh();assert.deepEqual(await state(f),moved);
 pass('date move preserves countdown, 3pm code, 9am cleaner clock, hold and receipt identity');
 await db.query("update bookings set check_in='2027-02-07' where id=$1",[f.booking]);await refresh();
 assert.equal((await state(f)).time.check_in,'2027-02-06');assert.equal(await scheduled('confirmation'),undefined);
 await db.query("update bookings set check_in='2027-02-06' where id=$1",[f.booking]);await refresh();
 assert.equal(await scheduled('confirmation'),undefined);
 pass('local date edit/revert cannot renew provenance without a new mapped revision');
 await receipt(f,'modified','2027-02-06','2027-02-09');await refresh();
 await db.query("update bookings set status='cancelled' where id=$1",[f.booking]);await receipt(f,'cancelled','2027-02-06','2027-02-09');await refresh();
 assert.equal((await state(f)).anchor,null);assert.equal(await scheduled('confirmation'),undefined);
 assert.equal(await scalar('select status data from automation_sends where id=$1',[send]),'held');
 pass('mapped cancellation suppresses scheduling and leaves held ledger identity intact');
 // An interrupted transaction must not leave only the timing observation behind.
 const rejected=await fixture(),healthy=await fixture();
 await db.query(`create function public.helmtest_reject_new_policy() returns trigger language plpgsql as $$ begin
 if new.booking_id='${rejected.booking}'::uuid then raise exception 'HELMTEST downstream refusal'; end if; return new; end $$;
 create trigger helmtest_reject_new_policy before insert on helm_channex_revisions.message_timing_policies for each row execute function public.helmtest_reject_new_policy();`);
 await refresh();assert.equal((await state(rejected)).time,null);assert.equal((await state(rejected)).history,0);
 assert.equal((await state(healthy)).history,1);
 assert.equal(await scalar('select bootstrap_outcome data from helm_channex_revisions.message_receipt_anchors where booking_id=$1',[rejected.booking]),'blocked');
 const checked=await scalar('select last_bootstrap_checked_at data from helm_channex_revisions.message_receipt_anchors where booking_id=$1',[rejected.booking]);
 await refresh();assert.equal((await state(healthy)).history,1);assert.equal((await state(rejected)).history,0);
 assert.ok((await scalar('select last_bootstrap_checked_at data from helm_channex_revisions.message_receipt_anchors where booking_id=$1',[rejected.booking]))>checked);
 pass('one rejected stay cannot poison healthy onboarding; blocked retry cursor advances without partial writes');
 await db.query('drop trigger helmtest_reject_new_policy on helm_channex_revisions.message_timing_policies; drop function public.helmtest_reject_new_policy()');
 await refresh();assert.equal((await state(rejected)).history,1);
 assert.equal(await scalar('select bootstrap_outcome data from helm_channex_revisions.message_receipt_anchors where booking_id=$1',[rejected.booking]),'registered');
 pass('late registration failure rolls back clocks/history; next tick recovers exactly once');
 const unexpected=await fixture();
 await db.query(`create function public.helmtest_unexpected_policy() returns trigger language plpgsql as $$ begin
 if new.booking_id='${unexpected.booking}'::uuid then raise exception using errcode='42501',message='HELMTEST permission failure'; end if; return new; end $$;
 create trigger helmtest_unexpected_policy before insert on helm_channex_revisions.message_timing_policies for each row execute function public.helmtest_unexpected_policy();`);
 await assert.rejects(refresh(),/HELMTEST permission failure/);
 assert.equal((await state(unexpected)).history,0);
 assert.equal(await scalar('select bootstrap_outcome data from helm_channex_revisions.message_receipt_anchors where booking_id=$1',[unexpected.booking]),'pending');
 await db.query('drop trigger helmtest_unexpected_policy on helm_channex_revisions.message_timing_policies; drop function public.helmtest_unexpected_policy()');
 await refresh();assert.equal((await state(unexpected)).history,1);
 pass('unexpected permission failures remain visible and abort atomically rather than being swallowed');
 const blocked=await fixture();
 await db.query('update helm_channex_revisions.message_new_stay_clocks set generation=2');await refresh();assert.equal((await state(blocked)).time,null);
 await db.query("update helm_channex_revisions.message_new_stay_clocks set generation=1,expires_at=clock_timestamp()-interval '1 second'");await refresh();assert.equal((await state(blocked)).time,null);
 await db.query("update helm_channex_revisions.message_new_stay_clocks set expires_at=clock_timestamp()+interval '12 hours'");
 await db.query('update helm_channex_revisions.message_receipt_policy set enabled=false');await refresh();assert.equal((await state(blocked)).time,null);
 await db.query('update helm_channex_revisions.message_receipt_policy set enabled=true');await refresh();assert.equal((await state(blocked)).history,1);
 pass('generation mismatch, expired clock review and disabled receipt policy prevent new onboarding');
 const migrated=await fixture(),actual=new Date(Date.now()-86400000).toISOString();
 const reviewed=await scalar('select automation_message_observe_times($1,automation_message_stay_revision($1),null,$2) data',[migrated.booking,{check_in:'2027-02-01',check_out:'2027-02-04',arrival_time:'16:00',departure_time:'11:00',confirmed_at:actual,observed_at:new Date().toISOString(),source_revision:'HELMTEST-owner-review',evidence_id:'HELMTEST-original-confirmation'}]);
 await scalar("select helm_pilot_message_times_register($1,$2,$3,$4,'HELMTEST-original-confirmation',clock_timestamp()+interval '1 hour',true) data",[migrated.booking,reviewed,connection,generation]);
 const legacy=await state(migrated);assert.equal(legacy.policy.confirmation_basis,'original-confirmation');assert.equal(legacy.policy.receipt_revision,null);
 assert.equal(Date.parse(legacy.anchor),Date.parse(actual));await refresh();assert.deepEqual(await state(migrated),legacy);
 pass('existing actual-confirmation registration and date refresh remain compatible after upgrade');
 for(const role of ['anon','authenticated','service_role']){
  await db.query('set role '+role);try{
   await assert.rejects(db.query('update helm_channex_revisions.message_new_stay_clocks set enabled=true'),/permission denied/);
   await assert.rejects(db.query('select helm_channex_revisions.bootstrap_new_stay_times($1,$2,100)',[connection,generation]),/permission denied/);
  }finally{await db.query('reset role');}
 }
 assert.equal(await scalar("select automations_enabled data from properties where id='HELMTEST-calderwood'"),false);
 assert.equal(await scalar('select count(*)::int data from automation_sends where booking_id=$1',[blocked.booking]),0);
 pass('worker cannot choose clocks or enable policy; onboarding creates no messages or sender activation');
 console.log(`PASS ${count} additional new-stay timing PostgreSQL scenarios; no live sends`);
 await verifyNewStayQueue({db,scalar,connection,generation,fixture,refresh,receipt});
}
