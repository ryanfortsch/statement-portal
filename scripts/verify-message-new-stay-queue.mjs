// Disposable local database only; all destinations and bookings are synthetic.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CALDERWOOD_STAGING } from '../src/lib/calderwood-readonly/channex.ts';
export async function verifyNewStayQueue({db,scalar,connection,generation,fixture,refresh,receipt}) {
 let count=0;const pass=s=>{count++;console.log('PASS new stay queue: '+s);};
 await db.query(readFileSync(new URL('../docs/guesty-exit/staging-storage/message-new-stay-queue.sql',import.meta.url),'utf8'));
 await db.query("update helm_channex_revisions.message_new_stay_clocks set expires_at=clock_timestamp()+interval '300 days'; update helm_channex_revisions.message_receipt_policy set expires_at=clock_timestamp()+interval '300 days'");
 const route=randomUUID(),channel=randomUUID(),phone='+12025550149';
 await db.query("insert into automation_channex_routes(property_id,environment,channex_property_id,channel_id,provider,generation,source_stopped_at,source_drained_at) values('HELMTEST-calderwood','staging',$1,$2,'Airbnb',$3,clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour')",[CALDERWOOD_STAGING.propertyId,channel,route]);
 await db.query("insert into cleaner_schedule_recipients(phone,display_name,enabled,property_ids) values($1,'HELMTEST',true,array['HELMTEST-calderwood'])",[phone]);
 const rules=[];
 for(const [workflow,trigger] of Object.entries({confirmation:'booking_confirmed',pre_arrival:'pre_arrival',key_code:'checkin_day',pre_checkout:'pre_checkout',cleaner_advance:'pre_arrival',cleaner_arrival:'checkin_day'})){
  const id=randomUUID();
  await db.query("insert into message_automations(id,property_id,key,audience,send_mode,enabled,configured_in_ota,channel_exclusions,body,timezone,trigger) values($1,'HELMTEST-calderwood',$2,$3,'auto',false,false,'{}','HELMTEST','America/New_York',$4)",[id,'new-'+workflow,workflow.startsWith('cleaner')?'cleaner':'guest',trigger]);
  rules.push({automation_id:id,workflow,digest:await scalar('select md5(to_jsonb(r)::text) data from message_automations r where id=$1',[id])});
 }
 await db.query("insert into helm_channex_revisions.message_new_stay_queue_policy(singleton,connection,generation,route_generation,rules,from_number,recipient_phones,source_stopped_at,source_drained_at,expires_at) select true,$1,$2,generation,$3,'+12025550148',array[$4],source_stopped_at,source_drained_at,clock_timestamp()+interval '300 days' from automation_channex_routes where property_id='HELMTEST-calderwood'",[connection,generation,JSON.stringify(rules),phone]);
 const bind=async f=>db.query("insert into automation_message_thread_bindings values($1,'HELMTEST-calderwood',$2,'staging',$3,$4,$5,'HELMTEST-thread',clock_timestamp())",[f.booking,route,channel,f.remote,randomUUID()]);
 const tick=async()=>{await db.query('set role service_role');try{return await scalar('select helm_pilot_message_queue_prepare($1,$2,100) data',[connection,generation]);}finally{await db.query('reset role');}};
 const rows=f=>scalar('select count(*)::int data from automation_sends where booking_id=$1',[f.booking]);
 const f=await fixture();await refresh();await bind(f);await tick();assert.equal(await rows(f),0);
 pass('disabled policy cannot create any queue');
 await db.query('update helm_channex_revisions.message_new_stay_queue_policy set enabled=true');
 const result=await tick();assert.equal(result.canSend,false);assert.ok(result.prepared>=1);assert.equal(await rows(f),6);
 assert.equal(await scalar("select count(*)::int data from automation_sends where booking_id=$1 and status='held' and delivery_used in ('channex','quo_cleaner')",[f.booking]),6);
 assert.equal(await scalar('select count(*)::int data from automation_channex_jobs where booking_id=$1',[f.booking]),4);
 assert.equal(await scalar('select count(*)::int data from automation_cleaner_batches where booking_id=$1 and not enabled',[f.booking]),2);
 assert.equal(await scalar('select count(*)::int data from automation_message_handoffs h join automation_sends s on s.id=h.send_id where s.booking_id=$1',[f.booking]),0);
 const snapshot=await scalar('select jsonb_agg(to_jsonb(s) order by id) data from automation_sends s where booking_id=$1',[f.booking]);
 await tick();assert.deepEqual(await scalar('select jsonb_agg(to_jsonb(s) order by id) data from automation_sends s where booking_id=$1',[f.booking]),snapshot);
 pass('six held jobs reserve both rails atomically, with no fabricated Guesty history; replay preserves all rows');
 const missing=await fixture();await refresh();assert.ok((await tick()).blocked>0);assert.equal(await rows(missing),0);
 await bind(missing);
 await db.query('update cleaner_schedule_recipients set enabled=false where phone=$1',[phone]);await tick();assert.equal(await rows(missing),0);
 await db.query('update cleaner_schedule_recipients set enabled=true where phone=$1',[phone]);
 await db.query("update message_automations set body='HELMTEST-edited' where id=$1",[rules[0].automation_id]);await tick();assert.equal(await rows(missing),0);
 await db.query("update message_automations set body='HELMTEST' where id=$1",[rules[0].automation_id]);await tick();assert.equal(await rows(missing),6);
 pass('missing thread, disabled recipient and changed template block all six; recovery prepares once');
 const failed=await fixture();await refresh();await bind(failed);
 await db.query(`create function helmtest_fail_queue() returns trigger language plpgsql as $$ begin if new.booking_id='${failed.booking}'::uuid then raise exception 'HELMTEST final failure'; end if; return new; end $$;
 create trigger helmtest_fail_queue before insert on helm_channex_revisions.message_new_stay_queues for each row execute function helmtest_fail_queue();`);
 await tick();assert.equal(await rows(failed),0);assert.equal(await scalar('select count(*)::int data from automation_channex_jobs where booking_id=$1',[failed.booking]),0);
 assert.equal(await scalar('select count(*)::int data from automation_cleaner_batches where booking_id=$1',[failed.booking]),0);
 await db.query('drop trigger helmtest_fail_queue on helm_channex_revisions.message_new_stay_queues; drop function helmtest_fail_queue()');await tick();assert.equal(await rows(failed),6);
 pass('last-write failure rolls back all six sends and both provider queues; retry recovers');
 const short=await fixture();
 const ci=new Date(Date.now()+5*86400000).toISOString().slice(0,10),co=new Date(Date.now()+8*86400000).toISOString().slice(0,10);
 await db.query('update bookings set check_in=$2,check_out=$3 where id=$1',[short.booking,ci,co]);await receipt(short,'modified',ci,co);await refresh();await bind(short);await tick();assert.equal(await rows(short),0);
 pass('booking inside ten days blocks atomically instead of inventing a missed-cleaner reminder policy');
 const expiring=await fixture();await refresh();await bind(expiring);
 await db.query("update helm_channex_revisions.message_timing_policies set expires_at=clock_timestamp()+interval '1 hour' where booking_id=$1",[expiring.booking]);
 await tick();assert.equal(await rows(expiring),0);
 pass('queue expiry cannot extend the reviewed timing authority to cover later messages');
 const occupied=await fixture();await refresh();await bind(occupied);
 const held=randomUUID();await db.query("insert into automation_sends(id,booking_id,property_id,automation_id,automation_key,status) values($1,$2,'HELMTEST-calderwood',$3,'new-key_code','held')",[held,occupied.booking,rules.find(r=>r.workflow==='key_code').automation_id]);
 await tick();assert.equal(await rows(occupied),1);assert.equal(await scalar('select status data from automation_sends where id=$1',[held]),'held');
 pass('preexisting held queues are never adopted or released');
 const stale=await fixture();await refresh();await bind(stale);
 await db.query('update helm_channex_revisions.message_new_stay_queue_policy set route_generation=$1',[randomUUID()]);await tick();assert.equal(await rows(stale),0);
 await db.query('update helm_channex_revisions.message_new_stay_queue_policy set route_generation=$1',[route]);
 await db.query("update bookings set status='cancelled' where id=$1",[stale.booking]);await tick();assert.equal(await rows(stale),0);
 pass('changed route generation and cancelled bookings cannot create jobs');
 for(const role of ['anon','authenticated','service_role']){
  await db.query('set role '+role);try{
   await assert.rejects(db.query('update helm_channex_revisions.message_new_stay_queue_policy set enabled=true'),/permission denied/);
   await assert.rejects(db.query('select helm_channex_revisions.prepare_new_stay_queue($1,$2,$3)',[f.booking,connection,generation]),/permission denied/);
  }finally{await db.query('reset role');}
 }
 assert.equal(await scalar("select automations_enabled data from properties where id='HELMTEST-calderwood'"),false);
 assert.equal(await scalar("select enabled data from automation_channex_routes where property_id='HELMTEST-calderwood'"),false);
 pass('workers cannot select rules/destinations or activate policy; property and message route remain disabled');
 console.log(`PASS ${count} additional new-stay queue PostgreSQL scenarios; no live sends`);
}
