// Disposable local PostgreSQL only. No env, hosted connection or provider network.
// Usage: node scripts/verify-channex-message-worker.mjs <native-bin-dir> <pg-index.js>
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { ChannexMessageWorker, createChannexJobStore } from '../src/lib/channex-messaging/worker.ts';
import { runScheduledChannexMessages, renderScheduledMessage } from '../src/lib/channex-messaging/scheduled.ts';
import { ChannexMessageTransport } from '../src/lib/channex-messaging/transport.ts';
assert.ok(isAbsolute(process.argv[2] ?? '') && isAbsolute(process.argv[3] ?? ''), 'Absolute local dependency paths required');
const bin = process.argv[2];
const { default: pg } = await import(pathToFileURL(process.argv[3]).href);
const root = mkdtempSync(join(tmpdir(), 'helm-channex-messages-')); chmodSync(root, 0o700);
const data = join(root, 'data'), port = 55483;
const pgctl = (...args) => execFileSync(join(bin, 'pg_ctl'), ['-D', data, ...args], { stdio: 'ignore' });
const clients = [];
async function connect() {
  const c = new pg.Client({ host: root, port, user: 'helmtest', database: 'postgres' });
  await c.connect(); clients.push(c); await c.query("set statement_timeout='8s'; set lock_timeout='6s'; set timezone='UTC'"); return c;
}
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const booking = id(1), send = id(2), rule = id(3), generation = id(4);
const text = 'HELMTEST synthetic welcome; no access or guest data';
const scope = { environment: 'staging', propertyId: id(5), channelId: id(6), provider: 'Airbnb' };
const attempt = { ...scope, bookingId: id(7), threadId: id(8), bodySha256: createHash('sha256').update(text).digest('hex') };
let running = false, count = 0;
const pass = label => { count++; console.log(`PASS ${label}`); };
try {
 execFileSync(join(bin, 'initdb'), ['-D', data, '-A', 'trust', '-U', 'helmtest', '--no-locale', '-E', 'UTF8'], { stdio: 'ignore' });
 const start = () => { pgctl('-l', join(root, 'server.log'), '-o', `-h '' -k ${root} -p ${port}`, '-w', 'start'); running = true; };
 start();
 let db = await connect(), a = await connect(), b = await connect();
 await db.query(`create role anon; create role authenticated; create role service_role;
 create table properties(id text primary key, automations_enabled boolean not null, calendar_authority text not null, default_checkout_time text, name text, title text, address text, wifi_name text, parking text);
 create table guests(id uuid primary key, first_name text);
 create table bookings(id uuid primary key, property_id text not null references properties(id), guest_id uuid,
 status text not null, duplicate_of uuid, check_in date not null, check_out date not null, channel text, guest_name text);
 create table message_automations(id uuid primary key, property_id text, key text, audience text, send_mode text,
 enabled boolean, configured_in_ota boolean, channel_exclusions text[], body text, timezone text, min_nights integer, trigger text);
 create table automation_sends(id uuid primary key, booking_id uuid references bookings(id), property_id text,
 automation_id uuid references message_automations(id), automation_key text, status text, fire_at timestamptz,
 planned_check_in date, planned_check_out date, delivery_used text, provider_message_id text, sent_at timestamptz,
 updated_at timestamptz, error text);
 create table property_rate_plans(property_id text primary key, checkin_time text,checkout_time text);
 create table checkout_adjustments(property_id text,stay_check_in date,adjusted_checkout_time text,adjusted_check_out date);
 create table property_access(property_id text primary key,smart_lock_code text);
 create table guest_access_codes(id uuid primary key,booking_id uuid,code text);
 create table lock_devices(device_id text primary key,property_id text,active boolean);`);
 await db.query(readFileSync(new URL('../docs/guesty-exit/staging-storage/automation-holds.sql', import.meta.url), 'utf8'));
 await db.query(readFileSync(new URL('../docs/guesty-exit/staging-storage/channex-message-worker.sql', import.meta.url), 'utf8'));
 await db.query(readFileSync(new URL('../docs/guesty-exit/staging-storage/channex-message-schedule.sql', import.meta.url), 'utf8'));
 const rpc = c => async (name, args) => {
  const calls = {
   automation_channex_candidates: ['select public.automation_channex_candidates($1,$2,$3) as data',[args.p_property_id,args.p_environment,args.p_limit]],
   automation_channex_snapshot: ['select public.automation_channex_snapshot($1) as data',[args.p_send_id]],
   automation_channex_refresh: ['select public.automation_channex_refresh($1,$2,$3,$4) as data',[args.p_send_id,args.p_revision,args.p_body_sha256,args.p_fire_at]],
   automation_channex_checked: ['select public.automation_channex_checked($1) as data',[args.p_send_id]],
   automation_channex_read: ['select public.automation_channex_read($1) as data', [args.p_send_id]],
   automation_channex_claim: ['select public.automation_channex_claim($1,$2,$3) as data', [args.p_send_id,args.p_attempt_id,args.p_attempt]],
   automation_channex_finish: ['select public.automation_channex_finish($1,$2,$3,$4,$5) as data', [args.p_send_id,args.p_attempt_id,args.p_state,args.p_provider_id,args.p_rejection_status]],
  };
  assert.ok(calls[name]); const [query, params] = calls[name];
  return { data: (await c.query(query, params)).rows[0].data, error: null };
 };
 const store = c => createChannexJobStore(rpc(c));
 const reset = async () => {
  await db.query('truncate automation_channex_stay_times,automation_hold_events,automation_channex_jobs,automation_sends,message_automations,bookings,automation_channex_routes,properties,property_rate_plans,checkout_adjustments,property_access,guest_access_codes,lock_devices,guests');
  await db.query("insert into properties values('HELMTEST-home',true,'helm','11:00','HELMTEST-home',null,null,null,null)");
  await db.query("insert into guests values($1,'HELMTEST')",[id(40)]);
  await db.query("insert into bookings values($1,'HELMTEST-home',$2,'confirmed',null,'2027-01-01','2027-01-04','airbnb','HELMTEST Person')",[booking,id(40)]);
  await db.query("insert into message_automations values($1,'HELMTEST-home','pre_arrival','guest','auto',true,false,'{}',$2,'America/New_York',null,'booking_confirmed')",[rule,text]);
  await db.query("insert into property_rate_plans values('HELMTEST-home','16:00','11:00')");
  await db.query("insert into automation_sends values($1,$2,'HELMTEST-home',$3,'pre_arrival','scheduled',clock_timestamp()+interval '200 milliseconds','2027-01-01','2027-01-04',null,null,null,clock_timestamp(),null)",[send,booking,rule]);
  await db.query("insert into automation_channex_routes values('HELMTEST-home','staging',$1,$2,'Airbnb',$3,true,clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '1 minute')",[scope.propertyId,scope.channelId,generation]);
  await db.query(`insert into automation_channex_jobs(send_id,booking_id,property_id,automation_key,route_generation,channex_booking_id,thread_id,body_sha256,context_revision,fire_at,expires_at,source_evidence_at,source_evidence_id,workflow)
   select id,booking_id,property_id,automation_key,$2,$3,$4,$5,public.automation_channex_context(id),fire_at,fire_at+interval '1 hour',clock_timestamp()-interval '30 seconds','HELMTEST-reviewed-manifest','confirmation' from automation_sends where id=$1`,[send,generation,attempt.bookingId,attempt.threadId,attempt.bodySha256]);
  await db.query("insert into automation_channex_stay_times select booking_id,planned_check_in,planned_check_out,null,null,fire_at-interval '30 minutes',clock_timestamp(),'HELMTEST-timing' from automation_sends where id=$1",[send]);
  await db.query('update automation_channex_jobs set context_revision=public.automation_channex_schedule_context(send_id)');
  const ready = await store(db).read(send);
  await delay(220); return ready;
 };
 const claim = (c, token=id(10), input=attempt) => store(c).claim(send,token,input);
 const hold = async c => {
  const version = (await c.query('select updated_at::text as v from automation_sends where id=$1',[send])).rows[0].v;
  return (await c.query('select public.automation_set_hold($1,$2,$3,true,$4) as ok',[send,'HELMTEST-home','HELMTEST-operator',version])).rows[0].ok;
 };
 let posts=0;
 const client = new ChannexMessageTransport({ scope,apiKey:'HELMTEST',sendEnabled:true,fetcher: async (url,init) => {
  const rel = i => ({data:{id:i}});
  const message={id:id(20),type:'message',attributes:{sender:'property',message:text,attachments:[]},relationships:{message_thread:rel(attempt.threadId)}};
  if(init.method==='POST'){posts++; return Response.json({data:message});}
  if(url.includes('/messages?'))return Response.json({data:[message],meta:{page:1,limit:100,total:1}});
  return Response.json({data:{id:attempt.threadId,type:'message_thread',attributes:{provider:scope.provider,is_closed:false},
   relationships:{property:rel(scope.propertyId),channel:rel(scope.channelId),booking:rel(attempt.bookingId)}}});
 }});
 const worker = c => new ChannexMessageWorker({store:store(c),transport:client,enabled:true});
 let ready=await reset();
 const render = async job => ({text,contextRevision:job.contextRevision});
 const results=await Promise.all([worker(a).dispatch(send,render),worker(b).dispatch(send,render)]);
 assert.equal(results.filter(r=>r.state==='accepted').length,1);assert.equal(posts,1);
 assert.equal((await worker(db).dispatch(send,render)).state,'needs_reconciliation');
 assert.equal((await worker(db).reconcile(send)).state,'recorded');assert.equal(posts,1);
 pass('actual SQL + transport + competing workers: one POST and provider-history readback');
 const mutations=[
  ['hold',async()=>{assert.equal(await hold(db),true);}],
  ['cancellation',()=>db.query("update bookings set status='cancelled'")],
  ['duplicate stay',()=>db.query('update bookings set duplicate_of=$1',[id(99)])],
  ['changed dates',()=>db.query("update bookings set check_out='2027-01-05'")],
  ['changed schedule',()=>db.query("update automation_sends set fire_at=fire_at+interval '1 day'")],
  ['not yet due',()=>db.query("update automation_sends set fire_at=fire_at+interval '10 minutes'; update automation_channex_jobs set fire_at=fire_at+interval '10 minutes'")],
  ['expiry',()=>db.query("update automation_channex_jobs set expires_at=clock_timestamp()-interval '1 millisecond'")],
  ['Guesty ownership',()=>db.query("update properties set calendar_authority='guesty'")],
  ['disabled sender',()=>db.query('update automation_channex_routes set enabled=false')],
  ['old handoff evidence',()=>db.query("update automation_channex_jobs set source_evidence_at=clock_timestamp()-interval '3 minutes'")],
  ['changed route generation',()=>db.query('update automation_channex_routes set generation=$1',[id(90)])],
  ['changed check-in time',()=>db.query("update property_rate_plans set checkin_time='17:00'")],
  ['changed checkout policy',()=>db.query("update properties set default_checkout_time='10:00'")],
  ['checkout adjustment',()=>db.query("insert into checkout_adjustments values('HELMTEST-home','2027-01-01','12:00',null)")],
  ['changed access source',()=>db.query("insert into property_access values('HELMTEST-home','HELMTEST-only')")],
  ['changed template',()=>db.query("update message_automations set body='HELMTEST changed'")],
  ['changed guest identity',()=>db.query("update guests set first_name='HELMTEST-other'")],
 ];
 for(const [name,change] of mutations){await reset();await change();assert.equal(await claim(db),false,name);assert.equal((await store(db).read(send)).state,'prepared');pass(`${name} blocks claim`);}
 await reset();assert.equal(await claim(db,id(10),{...attempt,threadId:id(99)}),false);
 assert.equal(await claim(db,id(10),{...attempt,bodySha256:'b'.repeat(64)}),false);pass('wrong route/body envelope blocks claim');
 await reset();await assert.rejects(db.query("update automation_sends set status='sending'"),/durable claim/);
 await assert.rejects(db.query("update automation_sends set delivery_used='ota_manual'"),/rerouted/);
 await assert.rejects(db.query("update automation_channex_routes set channel_id=$1",[id(90)]),/immutable/);
 pass('database blocks legacy claim, manual fallback and changed receipt routing');
 for(const outcome of [{state:'unknown'},{state:'rejected',status:422}]){
  await reset();assert.equal(await claim(db),true);assert.equal(await store(db).finish(send,id(10),outcome),true);
  assert.equal(await store(db).finish(send,id(10),outcome),true);assert.equal(await claim(db),false);
  assert.equal(await store(db).finish(send,id(10),{state:'accepted',providerMessageId:id(20)}),false);
  pass(`${outcome.state} persists without automatic retry or conflicting result`);
 }
 await reset();assert.equal(await claim(db),true);
 assert.equal(await store(db).finish(send,id(99),{state:'unknown'}),false);
 assert.equal(await store(db).finish(send,id(10),{state:'accepted',providerMessageId:id(20)}),true);
 assert.equal(await store(db).finish(send,id(10),{state:'unknown'}),false);pass('attempt identity and monotonic acceptance enforced');
 // Prove a second connection waits for the winner's transaction, then observes it.
 const aPid=(await a.query('select pg_backend_pid() as p')).rows[0].p;
 const bPid=(await b.query('select pg_backend_pid() as p')).rows[0].p;
 const blocked=async()=>{for(let i=0;i<200;i++){if((await db.query('select $1::int=any(pg_blocking_pids($2)) as b',[aPid,bPid])).rows[0].b)return;await delay(10);}assert.fail('Expected a real database lock wait');};
 await reset();await a.query('begin');assert.equal(await hold(a),true);
 let pending=claim(b);pending.catch(()=>{});await blocked();await a.query('commit');assert.equal(await pending,false);pass('hold wins actual PostgreSQL race');
 await reset();await a.query('begin');assert.equal(await claim(a),true);
 pending=hold(b);pending.catch(()=>{});await blocked();await a.query('commit');assert.equal(await pending,false);pass('claim wins actual race; late hold cannot recall it');
 await reset();assert.equal(await claim(db),true);
 await Promise.all(clients.splice(0).map(c=>c.end()));pgctl('-m','fast','-w','stop');running=false;start();
 db=await connect();a=await connect();b=await connect();
 assert.equal(await claim(db),false);assert.equal((await worker(db).dispatch(send,render)).state,'needs_reconciliation');
 pass('committed claim survives PostgreSQL restart without another POST');
 ready=await reset();const real=store(db);
 const lost=new ChannexMessageWorker({transport:client,enabled:true,store:{...real,finish:async(...args)=>{await real.finish(...args);throw Error('HELMTEST lost acknowledgement');}}});
 const before=posts;assert.equal((await lost.dispatch(send,async()=>({text,contextRevision:ready.contextRevision}))).state,'ledger_uncertain');
 assert.equal((await worker(db).dispatch(send,render)).state,'needs_reconciliation');assert.equal((await worker(db).reconcile(send)).state,'recorded');assert.equal(posts,before+1);
 pass('lost acceptance-save acknowledgement recovers by GET without duplicate send');
 for(const role of ['anon','authenticated']){
  await db.query(`set role ${role}`);
  await assert.rejects(db.query('select public.automation_channex_read($1)',[send]),/permission denied/);
  await db.query('reset role');
 }
 await db.query('set role service_role');
 await assert.rejects(db.query('update automation_channex_routes set enabled=true'),/permission denied/);
 assert.equal((await store(db).read(send)).state,'recorded');await db.query('reset role');
 pass('RPCs deny browser roles and worker cannot enable routes');
 // Run the actual scheduled adapter against the same database and transport.
 const config={propertyId:'HELMTEST-home',environment:'staging',apiKey:'HELMTEST'};
 const tick=c=>runScheduledChannexMessages({config,rpc:rpc(c),transportFactory:()=>client});
 const snapshot=async()=> (await rpc(db)('automation_channex_snapshot',{p_send_id:send})).data;
 const refresh=async snap=> {const body=renderScheduledMessage(snap);return (await rpc(db)('automation_channex_refresh',{
  p_send_id:send,p_revision:snap.revision,p_body_sha256:body.bodySha256,p_fire_at:snap.fireAt})).data;};
 await reset();const postsBefore=posts;
 const ticks=await Promise.all([tick(a),tick(b)]);
 assert.equal(ticks.reduce((n,r)=>n+r.accepted,0),1);assert.equal(posts,postsBefore+1);
 assert.equal((await tick(db)).recorded,1);assert.equal(posts,postsBefore+1);
 pass('cron adapter renders, refreshes, claims, sends once, then records provider history');
 await reset();const dryBefore=posts;
 const dry=await runScheduledChannexMessages({config,rpc:rpc(db),dry:true,transportFactory:()=>{assert.fail('dry transport');}});
 assert.equal(dry.candidates,1);assert.equal(posts,dryBefore);
 assert.equal((await db.query('select last_checked_at from automation_channex_jobs')).rows[0].last_checked_at,null);
 pass('dry cron neither stamps candidates nor touches the provider');
 await reset();await db.query("update automation_channex_jobs set workflow='key_code',expires_at='2028-01-01'; update message_automations set trigger='checkin_day'");
 assert.equal(await hold(db),true);
 const heldTick=await tick(db);assert.equal(heldTick.held,1);assert.equal(heldTick.accepted,0);
 let srow=(await db.query('select status,fire_at,planned_check_in from automation_sends')).rows[0];
 assert.equal(srow.status,'held');assert.equal(srow.fire_at.toISOString(),'2027-01-01T20:00:00.000Z');
 await db.query("update bookings set check_in='2027-01-02'");
 assert.equal((await tick(db)).attention,1); // moved stay needs matching source observation
 assert.equal((await db.query('select status from automation_sends')).rows[0].status,'held');
 await db.query("update automation_channex_stay_times set check_in='2027-01-02',arrival_time='18:00'");
 assert.equal((await tick(db)).held,1);
 srow=(await db.query('select status,fire_at,planned_check_in from automation_sends')).rows[0];
 assert.equal(srow.status,'held');assert.equal(srow.fire_at.toISOString(),'2027-01-02T22:00:00.000Z');
 assert.equal(srow.planned_check_in instanceof Date?srow.planned_check_in.toISOString().slice(0,10):srow.planned_check_in,'2027-01-02');
 pass('moved ETA refreshes canonical schedule only with matching observation and preserves hold');
 await reset();await db.query("update automation_channex_jobs set workflow='pre_checkout',expires_at='2028-01-01'; update message_automations set trigger='pre_checkout'");
 await db.query("update property_rate_plans set checkout_time='09:00'; update properties set default_checkout_time='12:00'");
 assert.equal((await snapshot()).fireAt,'2027-01-03T17:00:00+00:00');
 await db.query("update automation_channex_stay_times set departure_time='13:00'");
 assert.equal((await snapshot()).fireAt,'2027-01-03T18:00:00+00:00');
 await db.query("insert into checkout_adjustments values('HELMTEST-home','2027-01-01','14:00','2027-01-05')");
 assert.equal((await snapshot()).fireAt,'2027-01-04T19:00:00+00:00');
 pass('checkout schedule uses current house policy, then ETD, then approved adjustment');
 await reset();await db.query("update automation_channex_jobs set workflow='pre_arrival',expires_at='2028-01-01'; update message_automations set trigger='pre_arrival'");
 for(const [arrival,expected] of [['2027-03-14','2027-03-13T21:00:00+00:00'],['2027-03-15','2027-03-14T20:00:00+00:00'],['2027-11-08','2027-11-07T21:00:00+00:00']]){
  await db.query("update bookings set check_in=$1,check_out=$1::date+3",[arrival]);
  await db.query("update automation_channex_stay_times set check_in=$1,check_out=$1::date+3",[arrival]);
  assert.equal((await snapshot()).fireAt,expected);
 }
 await db.query("update bookings set check_in='2027-03-15',check_out='2027-03-18'; update automation_channex_stay_times set check_in='2027-03-15',check_out='2027-03-18',arrival_time='02:30'");
 assert.equal((await snapshot()).fireAt,null);
 pass('calendar-day offsets survive DST; nonexistent wall time blocks');
 await reset();let snap=await snapshot();
 await db.query("insert into property_access values('HELMTEST-home','HELMTEST-only')");
 assert.equal(await refresh(snap),false);
 await db.query("update message_automations set body='HELMTEST {{door_code}} at {{check_in_time}}'");
 snap=await snapshot();const rendered=renderScheduledMessage(snap);assert.match(rendered.text,/HELMTEST-only/);
 assert.equal(await refresh(snap),true);
 const stored=(await db.query('select to_jsonb(j)::text as body from automation_channex_jobs j')).rows[0].body;
 assert.ok(!stored.includes('HELMTEST-only'));assert.equal((await store(db).read(send)).bodySha256,rendered.bodySha256);
 pass('source changes invalidate snapshot; refreshed render persists only a digest');
 await reset();snap=await snapshot();await db.query("update automation_sends set status='cancelled'");
 assert.equal(await refresh(snap),false);
 await reset();snap=await snapshot();assert.equal(await claim(db),true);assert.equal(await refresh(snap),false);
 pass('refresh cannot resurrect cancellation or alter an attempted message');
 await reset();await db.query("update automation_channex_stay_times set confirmed_at=confirmed_at-interval '5 minutes'");
 assert.equal(await refresh(await snapshot()),false);
 pass('retiming into the past cannot manufacture catch-up');
 await reset();await hold(db);const afterHold=await snapshot();assert.equal(await refresh(afterHold),true);
 assert.equal(await claim(db),false);assert.equal((await db.query('select status from automation_sends')).rows[0].status,'held');
 pass('refresh never releases hold and final claim still refuses it');
 await reset();await db.query('set role service_role');
 await assert.rejects(db.query("update automation_channex_stay_times set arrival_time='18:00'"),/permission denied/);
 assert.equal((await tick(db)).accepted,1);await db.query('reset role');
 pass('worker role can run scheduler but cannot manufacture source observations');
 for(const role of ['anon','authenticated']){
  await db.query(`set role ${role}`);
  await assert.rejects(db.query('select public.automation_channex_snapshot($1)',[send]),/permission denied/);
  await db.query('reset role');
 }
 pass('browser roles cannot read render snapshot or access values');
 await reset();const beforeRace=posts;
 const raced=await runScheduledChannexMessages({config,rpc:rpc(db),transportFactory:()=>({
  verifyReceipt:client.verifyReceipt.bind(client),sendText:async(...args)=>{
   await db.query("update message_automations set body='HELMTEST new template after render'");
   return client.sendText(...args);
  }
 })});
 assert.equal(raced.blocked,1);assert.equal(posts,beforeRace);
 pass('template change after refresh is caught at final claim before provider POST');
 await reset();await db.query('update automation_channex_stay_times set confirmed_at=null');
 assert.equal((await snapshot()).fireAt,null);assert.equal((await tick(db)).attention,1);
 pass('missing real confirmation never substitutes import or cron time');
 await reset();assert.equal(await claim(db),true);
 assert.equal(await store(db).finish(send,id(10),{state:'accepted',providerMessageId:id(20)}),true);
 await db.query('select public.automation_channex_checked($1)',[send]);
 await db.query('insert into bookings select $1,property_id,guest_id,status,duplicate_of,check_in,check_out,channel,guest_name from bookings where id=$2',[id(50),booking]);
 await db.query("insert into automation_sends select $1,$2,property_id,automation_id,automation_key,'scheduled',clock_timestamp()+interval '1 minute',planned_check_in,planned_check_out,null,null,null,clock_timestamp(),null from automation_sends where id=$3",[id(51),id(50),send]);
 await db.query("insert into automation_channex_jobs(send_id,booking_id,property_id,automation_key,route_generation,channex_booking_id,thread_id,body_sha256,context_revision,fire_at,expires_at,source_evidence_at,source_evidence_id,workflow) select $1,$2,j.property_id,j.automation_key,j.route_generation,$3,$4,j.body_sha256,public.automation_channex_context($1),s.fire_at,s.fire_at+interval '1 hour',j.source_evidence_at,'HELMTEST-next','confirmation' from automation_channex_jobs j join automation_sends s on s.id=$1 where j.send_id=$5",[id(51),id(50),id(52),id(53),send]);
 let scan=(await rpc(db)('automation_channex_candidates',{p_property_id:'HELMTEST-home',p_environment:'staging',p_limit:1})).data;
 assert.deepEqual(scan,[id(51)]);
 await db.query('select public.automation_channex_checked($1)',[id(51)]);
 scan=(await rpc(db)('automation_channex_candidates',{p_property_id:'HELMTEST-home',p_environment:'staging',p_limit:1})).data;
 assert.deepEqual(scan,[send]);
 pass('unconfirmed receipts and blocked renders rotate fairly instead of starving new work');
 console.log(`PASS ${count} local PostgreSQL acceptance scenarios; provider POSTs were synthetic only`);
}finally{
 await Promise.all(clients.map(c=>c.end().catch(()=>{})));
 if(running)pgctl('-m','fast','-w','stop');
 rmSync(root,{recursive:true,force:true});
}
