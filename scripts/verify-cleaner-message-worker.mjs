// Called only by the disposable local PostgreSQL acceptance harness. No hosted data.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { runScheduledCleanerMessages } from '../src/lib/cleaner-messaging/scheduled.ts';
import { createCleanerTransport, messageHash } from '../src/lib/cleaner-messaging/transport.ts';
import { quoFromNumber } from '../src/lib/quo-lines.ts';
export async function verifyCleaners({ db, a, b, restart }) {
 let count=0, posts=0;const pass=s=>{count++;console.log(`PASS cleaner: ${s}`);};
 const book=randomUUID(), send=randomUUID(), rule=randomUUID();const property='HELMTEST-cleaner-home';
 const from=quoFromNumber('ops'), phones=['+12025550101','+12025550102'];
 const config={propertyId:property,apiKey:'HELMTEST'};
 await db.query('create table cleaner_schedule_recipients(phone text primary key,display_name text,portal_token text,enabled boolean,property_ids text[],region text,language text); alter table properties add column region text;');
 await db.query(readFileSync(new URL('../docs/guesty-exit/staging-storage/cleaner-message-worker.sql',import.meta.url),'utf8'));
 const rpc=c=>async(name,args)=>{
  const map={
   automation_cleaner_candidates:['select automation_cleaner_candidates($1) data',[args.p_property_id]],
   automation_cleaner_snapshot:['select automation_cleaner_snapshot($1) data',[args.p_job_id]],
   automation_cleaner_refresh:['select automation_cleaner_refresh($1,$2,$3) data',[args.p_job_id,args.p_revision,args.p_fire_at]],
   automation_cleaner_claim:['select automation_cleaner_claim($1,$2,$3,$4,$5) data',[args.p_job_id,args.p_attempt_id,args.p_revision,args.p_fire_at,args.p_target]],
   automation_cleaner_finish:['select automation_cleaner_finish($1,$2,$3,$4) data',[args.p_job_id,args.p_attempt_id,args.p_state,args.p_provider_id]],
   automation_cleaner_checked:['select automation_cleaner_checked($1) data',[args.p_job_id]],
  };assert.ok(map[name]);return {data:(await c.query(...map[name])).rows[0].data,error:null};
 };
 const snap=async(id,c=db)=>(await rpc(c)('automation_cleaner_snapshot',{p_job_id:id})).data;
 const claim=async(id,token=randomUUID(),snapshot=null,c=db)=>{
  const s=snapshot??await snap(id,c);
  return rpc(c)('automation_cleaner_claim',{p_job_id:id,p_attempt_id:token,p_revision:s.revision,p_fire_at:s.fireAt,
    p_target:{from:s.from,to:s.to,bodySha256:messageHash('HELMTEST cleaner reminder')}}).then(r=>r.data);
 };
 const finish=(id,token,state,providerId=null,c=db)=>rpc(c)('automation_cleaner_finish',{p_job_id:id,p_attempt_id:token,p_state:state,p_provider_id:providerId}).then(r=>r.data);
 const fixture=async(flow='cleaner_arrival')=>{
  await db.query('truncate automation_cleaner_jobs,automation_cleaner_batches,automation_channex_jobs,automation_channex_stay_times,automation_hold_events,automation_sends,message_automations,bookings,automation_channex_routes,properties,property_rate_plans,checkout_adjustments,property_access,guest_access_codes,lock_devices,guests,cleaner_schedule_recipients');
  await db.query("insert into properties(id,automations_enabled,calendar_authority,default_checkout_time,name,region) values($1,true,'helm','11:00',$1,'HELMTEST-ct')",[property]);
  await db.query("insert into bookings(id,property_id,status,check_in,check_out,channel,guest_name) values($1,$2,'confirmed',(clock_timestamp() at time zone 'UTC'+interval '7 hours')::date,(clock_timestamp() at time zone 'UTC'+interval '7 hours')::date+3,'airbnb','HELMTEST')",[book,property]);
  await db.query("insert into message_automations values($1,$2,'cleaner_arrival','cleaner','auto',true,false,'{}','HELMTEST cleaner reminder','UTC',null,'checkin_day')",[rule,property]);
  await db.query("insert into property_rate_plans values($1,'16:00','11:00')",[property]);
  await db.query("insert into automation_sends select $1,id,property_id,$2,'cleaner_arrival','scheduled',clock_timestamp()+interval '1 hour',check_in,check_out,null,null,null,clock_timestamp(),null from bookings where id=$3",[send,rule,book]);
  await db.query("insert into automation_channex_stay_times select id,check_in,check_out,(date_trunc('minute',clock_timestamp() at time zone 'UTC')+interval '7 hours')::time,null,null,clock_timestamp(),'HELMTEST-source' from bookings where id=$1",[book]);
  if(flow==='cleaner_advance'){
   await db.query("update bookings set check_in=(clock_timestamp() at time zone 'UTC')::date+10,check_out=(clock_timestamp() at time zone 'UTC')::date+13");
   await db.query("update automation_channex_stay_times t set check_in=b.check_in,check_out=b.check_out,arrival_time=date_trunc('minute',clock_timestamp() at time zone 'UTC')::time from bookings b where b.id=t.booking_id");
   await db.query("update message_automations set trigger='pre_arrival'");
   await db.query('update automation_sends s set planned_check_in=b.check_in,planned_check_out=b.check_out from bookings b where b.id=s.booking_id');
  }
  for(const [i,phone] of phones.entries())await db.query("insert into cleaner_schedule_recipients values($1,'HELMTEST cleaner',$2,true,$3,'HELMTEST-ct','en')",[phone,`HELMTEST-token-${i}`,[property]]);
  await db.query(`insert into automation_cleaner_batches(send_id,booking_id,property_id,automation_key,workflow,from_number,recipient_phones,enabled,source_stopped_at,source_drained_at,source_evidence_at,source_evidence_id,prepared_at,fire_at,expires_at)
   select id,booking_id,property_id,automation_key,$4,$2,$3,true,clock_timestamp()-interval '3 hours',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '90 minutes','HELMTEST-reviewed-source',clock_timestamp()-interval '1 hour',fire_at,fire_at+interval '1 day' from automation_sends where id=$1`,[send,from,phones,flow]);
  // Local fixture time travel: registration requires future work; emulate the
  // original schedule becoming due without weakening that production invariant.
  await db.query('update automation_cleaner_batches set fire_at=automation_cleaner_schedule(send_id)');
  await db.query('update automation_sends set fire_at=automation_cleaner_schedule(id)');
  return (await db.query('select id from automation_cleaner_jobs order by to_number')).rows.map(x=>x.id);
 };
 let deliveryStatus='delivered';let rejectSecond=false,throwPost=false;const messages=new Map();
 const transport=createCleanerTransport({apiKey:'HELMTEST',enabled:true,fetcher:async(url,init)=>{
  if(init.method==='POST'){
   posts++;if(throwPost)throw Error('HELMTEST timeout');const body=JSON.parse(init.body);
   if(rejectSecond&&body.to[0]===phones[1])return Response.json({}, {status:402});
   const m={id:`AC_HELMTEST_${posts}`,from:body.from,to:body.to,text:body.content,direction:'outgoing',status:'queued',media:[]};messages.set(m.id,m);return Response.json({data:m},{status:202});
  }
  const m=messages.get(String(url).split('/').at(-1));return Response.json({data:{...m,status:deliveryStatus}});
 }});
 const tick=(c=db,extra={})=>runScheduledCleanerMessages({config,rpc:rpc(c),transport,...extra});
 let ids=await fixture();assert.equal((await tick(db,{config:null})).enabled,false);assert.equal(posts,0);assert.equal((await tick(db,{dry:true})).candidates,2);assert.equal(posts,0);pass('disabled and dry paths do not claim or POST');
 const result=await tick();assert.equal(result.accepted,2);assert.equal(posts,2);
 const receipts=(await db.query('select provider_message_id from automation_cleaner_jobs')).rows;
 assert.equal(new Set(receipts.map(x=>x.provider_message_id)).size,2);assert.equal((await db.query('select provider_message_id from automation_sends')).rows[0].provider_message_id,null);
 assert.equal((await tick()).delivered,2);assert.equal(posts,2);pass('two recipients retain separate receipts and reconcile without another POST');
 ids=await fixture();const before=posts;const race=await Promise.all([tick(a),tick(b)]);assert.equal(posts-before,2);assert.equal(race.reduce((n,x)=>n+x.accepted,0),2);pass('overlapping workers send each recipient at most once');
 ids=await fixture();rejectSecond=true;assert.equal((await tick()).accepted,1);rejectSecond=false;const partialPosts=posts;await tick();assert.equal(posts,partialPosts);assert.equal((await db.query('select status from automation_sends')).rows[0].status,'failed');pass('partial rejection never retries the successful or rejected recipient');
 ids=await fixture();throwPost=true;assert.equal((await tick()).attention,2);throwPost=false;const unknownPosts=posts;await tick();assert.equal(posts,unknownPosts);pass('ambiguous provider failures remain unknown without retries');
 ids=await fixture();let lost=false;assert.equal((await tick(db,{rpc:async(name,args)=>{
  const r=await rpc(db)(name,args);if(name==='automation_cleaner_finish'&&!lost){lost=true;throw Error('HELMTEST lost save acknowledgement');}return r;
 }})).accepted,2);pass('lost finish acknowledgement retries only the database write');
 ids=await fixture();const claimPosts=posts;await tick(db,{rpc:async(name,args)=>{
  const r=await rpc(db)(name,args);if(name==='automation_cleaner_claim')throw Error('HELMTEST lost claim acknowledgement');return r;
 }});await tick();assert.equal(posts,claimPosts);pass('lost claim acknowledgement prevents POST and cannot be reclaimed');
 ids=await fixture();const holdVersion=(await db.query('select updated_at::text v from automation_sends where id=$1',[send])).rows[0].v;
 assert.equal((await db.query('select automation_set_hold($1,$2,$3,true,$4) ok',[send,property,'HELMTEST-operator',holdVersion])).rows[0].ok,true);
 assert.equal((await tick()).held,2);assert.equal(await claim(ids[0]),false);pass('operator hold survives refresh and blocks final claim');
 ids=await fixture();const old=await snap(ids[0]);await db.query("update message_automations set body='HELMTEST changed'");assert.equal(await claim(ids[0],randomUUID(),old),false);pass('template changed after render invalidates the final claim');
 for(const query of ["update bookings set status='cancelled'","update properties set calendar_authority='guesty'","update cleaner_schedule_recipients set enabled=false","update cleaner_schedule_recipients set property_ids='{}',region='cape_ann'","update automation_cleaner_batches set enabled=false","update message_automations set configured_in_ota=true"]){
  ids=await fixture();await db.query(query);assert.equal(await claim(ids[0]),false);
 }pass('cancellation, Guesty ownership, recipient disable/scope, batch disable and OTA coverage all block');
 ids=await fixture();await db.query("update cleaner_schedule_recipients set phone='+12025550109' where phone=$1",[phones[0]]);assert.equal(await claim(ids[0]),false);pass('changed phone cannot silently redirect an existing job');
 ids=await fixture();const oldTime=await snap(ids[0]);await db.query("update automation_channex_stay_times set arrival_time=arrival_time-interval '1 minute'");const moved=await snap(ids[0]);assert.notEqual(oldTime.fireAt,moved.fireAt);
 assert.equal((await rpc(db)('automation_cleaner_refresh',{p_job_id:ids[0],p_revision:moved.revision,p_fire_at:moved.fireAt})).data,false);pass('schedule move into the past cannot become automatic catch-up');
 ids=await fixture();await db.query("update automation_channex_stay_times set arrival_time=arrival_time+interval '30 minutes'");const future=await snap(ids[0]);assert.equal((await rpc(db)('automation_cleaner_refresh',{p_job_id:ids[0],p_revision:future.revision,p_fire_at:future.fireAt})).data,true);assert.equal(await claim(ids[0]),false);assert.equal((await tick(db,{dry:true})).candidates,0);pass('unattempted future ETA change retimes and waits without occupying the due scan');
 ids=await fixture();const token=randomUUID();assert.equal(await claim(ids[0],token),true);
 assert.equal(await finish(ids[0],token,'accepted','AC_HELMTEST_BOUND'),true);assert.equal(await finish(ids[0],token,'delivered','AC_OTHER'),false);
 assert.equal(await finish(ids[0],token,'delivered','AC_HELMTEST_BOUND'),true);assert.equal(await finish(ids[0],token,'accepted','AC_HELMTEST_BOUND'),false);pass('receipt is bound to attempt and message ID and cannot downgrade delivered');
 ids=await fixture();await tick();deliveryStatus='undelivered';assert.equal((await tick()).attention,2);deliveryStatus='delivered';assert.match((await db.query('select error from automation_sends')).rows[0].error,/delivery failed/);pass('undelivered receipts surface failure rather than claiming delivery');
 ids=await fixture();const cancelToken=randomUUID();assert.equal(await claim(ids[0],cancelToken),true);await db.query("update automation_sends set status='cancelled'");assert.equal(await finish(ids[0],cancelToken,'accepted','AC_HELMTEST_CANCEL'),true);assert.equal((await db.query('select status from automation_sends')).rows[0].status,'cancelled');pass('receipt after cancellation preserves cancellation');
 ids=await fixture();for(const role of ['anon','authenticated']){
  await db.query(`set role ${role}`);await assert.rejects(db.query('select automation_cleaner_snapshot($1)',[ids[0]]),/permission denied/);await db.query('reset role');
 }await db.query('set role service_role');await assert.rejects(db.query('update automation_cleaner_batches set enabled=true'),/permission denied/);assert.equal((await tick()).accepted,2);await db.query('reset role');pass('browser roles cannot read jobs; worker executes but cannot activate/register');
 ids=await fixture();await assert.rejects(db.query("update automation_sends set status='sending'"),/durable claim/);await assert.rejects(db.query("update automation_sends set delivery_used='cleaner_sms'"),/rerouted/);pass('legacy sender cannot claim or reroute reserved work');
 ids=await fixture();const restartToken=randomUUID();assert.equal(await claim(ids[0],restartToken),true);
 ({db,a,b}=await restart());assert.equal(await claim(ids[0]),false);const restartPosts=posts;await tick();assert.equal(posts-restartPosts,1);pass('database restart preserves the first attempt and sends only the remaining recipient');
 ids=await fixture('cleaner_advance');const advance=await snap(ids[0]);assert.equal(new Date(advance.fireAt).toISOString().slice(0,10),new Date(advance.renderAt).toISOString().slice(0,10));assert.equal((await tick()).accepted,2);pass('ten-calendar-day reminder executes at the verified arrival clock');
 ids=await fixture('cleaner_advance');await db.query("update message_automations set timezone='America/New_York'");
 for(const arrival of ['2027-03-15','2027-11-08']){
  await db.query("update bookings set check_in=$1,check_out=$1::date+3",[arrival]);
  await db.query("update automation_channex_stay_times set check_in=$1,check_out=$1::date+3,arrival_time='16:00'",[arrival]);
  assert.equal((await snap(ids[0])).fireAt,null);
  const beforeDstPosts=posts;assert.equal((await tick()).blocked,2);assert.equal(posts,beforeDstPosts);
 }
 pass('ten-day reminder withholds spring/fall clock conflicts without SMS');
 ids=await fixture();await db.query("update message_automations set timezone='America/New_York'");
 for(const [arrival,clock,expected] of [['2027-03-14','16:00','2027-03-14T13:00:00+00:00'],['2027-11-07','16:00','2027-11-07T14:00:00+00:00'],['2027-03-14','02:30',null],['2027-11-07','01:30',null]]){
  await db.query("update bookings set check_in=$1,check_out=$1::date+3",[arrival]);
  await db.query("update automation_channex_stay_times set check_in=$1,check_out=$1::date+3,arrival_time=$2",[arrival,clock]);
  assert.equal((await snap(ids[0])).fireAt,expected);
 }
 pass('seven-hour cleaner timing retains 9 AM across DST and rejects invalid anchors');
 ids=await fixture();await db.query("update message_automations set trigger='pre_checkout'");assert.equal(await claim(ids[0]),false);pass('changed workflow binding cannot silently reuse the cleaner schedule');
 ids=await fixture();await db.query('delete from automation_channex_stay_times');assert.equal((await snap(ids[0])).fireAt,null);assert.equal((await tick()).blocked,2);pass('missing verified timing never falls back to an assumed arrival');
 ids=await fixture();await tick();await db.query('update automation_cleaner_batches set enabled=false');assert.equal((await tick()).delivered,2);pass('disabling future sends does not stop read-only receipt reconciliation');
 ids=await fixture();await db.query("update automation_channex_stay_times set arrival_time='17:00'");
 const arrival=await snap(ids[0]);assert.equal(new Date(arrival.fireAt).getUTCHours(),10);pass('arrival-day reminder follows changed ETA by seven hours');
 console.log(`PASS ${count} cleaner PostgreSQL scenarios; all SMS HTTP was synthetic`);
}
