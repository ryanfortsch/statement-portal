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
  await c.connect(); clients.push(c); await c.query("set statement_timeout='8s'; set lock_timeout='6s'"); return c;
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
 create table properties(id text primary key, automations_enabled boolean not null, calendar_authority text not null, default_checkout_time time);
 create table guests(id uuid primary key, first_name text);
 create table bookings(id uuid primary key, property_id text not null references properties(id), guest_id uuid,
 status text not null, duplicate_of uuid, check_in date not null, check_out date not null, channel text);
 create table message_automations(id uuid primary key, property_id text, key text, audience text, send_mode text,
 enabled boolean, configured_in_ota boolean, channel_exclusions text[], body text);
 create table automation_sends(id uuid primary key, booking_id uuid references bookings(id), property_id text,
 automation_id uuid references message_automations(id), automation_key text, status text, fire_at timestamptz,
 planned_check_in date, planned_check_out date, delivery_used text, provider_message_id text, sent_at timestamptz,
 updated_at timestamptz, error text);
 create table property_rate_plans(property_id text primary key, checkin_time time,checkout_time time);
 create table checkout_adjustments(property_id text,stay_check_in date,adjusted_checkout_time time);
 create table property_access(property_id text primary key,smart_lock_code text);
 create table guest_access_codes(id uuid primary key,booking_id uuid,code text);
 create table lock_devices(device_id text primary key,property_id text,active boolean);`);
 await db.query(readFileSync(new URL('../docs/guesty-exit/staging-storage/automation-holds.sql', import.meta.url), 'utf8'));
 await db.query(readFileSync(new URL('../docs/guesty-exit/staging-storage/channex-message-worker.sql', import.meta.url), 'utf8'));
 const rpc = c => async (name, args) => {
  const calls = {
   automation_channex_read: ['select public.automation_channex_read($1) as data', [args.p_send_id]],
   automation_channex_claim: ['select public.automation_channex_claim($1,$2,$3) as data', [args.p_send_id,args.p_attempt_id,args.p_attempt]],
   automation_channex_finish: ['select public.automation_channex_finish($1,$2,$3,$4,$5) as data', [args.p_send_id,args.p_attempt_id,args.p_state,args.p_provider_id,args.p_rejection_status]],
  };
  assert.ok(calls[name]); const [query, params] = calls[name];
  return { data: (await c.query(query, params)).rows[0].data, error: null };
 };
 const store = c => createChannexJobStore(rpc(c));
 const reset = async () => {
  await db.query('truncate automation_hold_events,automation_channex_jobs,automation_sends,message_automations,bookings,automation_channex_routes,properties,property_rate_plans,checkout_adjustments,property_access,guest_access_codes,lock_devices,guests');
  await db.query("insert into properties values('HELMTEST-home',true,'helm','11:00')");
  await db.query("insert into guests values($1,'HELMTEST')",[id(40)]);
  await db.query("insert into bookings values($1,'HELMTEST-home',$2,'confirmed',null,'2027-01-01','2027-01-04','airbnb')",[booking,id(40)]);
  await db.query("insert into message_automations values($1,'HELMTEST-home','pre_arrival','guest','auto',true,false,'{}','HELMTEST template')",[rule]);
  await db.query("insert into property_rate_plans values('HELMTEST-home','16:00','11:00')");
  await db.query("insert into automation_sends values($1,$2,'HELMTEST-home',$3,'pre_arrival','scheduled',clock_timestamp()+interval '200 milliseconds','2027-01-01','2027-01-04',null,null,null,clock_timestamp(),null)",[send,booking,rule]);
  await db.query("insert into automation_channex_routes values('HELMTEST-home','staging',$1,$2,'Airbnb',$3,true,clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '1 minute')",[scope.propertyId,scope.channelId,generation]);
  await db.query(`insert into automation_channex_jobs(send_id,booking_id,property_id,automation_key,route_generation,channex_booking_id,thread_id,body_sha256,context_revision,fire_at,expires_at,source_evidence_at,source_evidence_id)
   select id,booking_id,property_id,automation_key,$2,$3,$4,$5,public.automation_channex_context(id),fire_at,fire_at+interval '1 hour',clock_timestamp()-interval '30 seconds','HELMTEST-reviewed-manifest' from automation_sends where id=$1`,[send,generation,attempt.bookingId,attempt.threadId,attempt.bodySha256]);
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
  ['checkout adjustment',()=>db.query("insert into checkout_adjustments values('HELMTEST-home','2027-01-01','12:00')")],
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
 console.log(`PASS ${count} local PostgreSQL acceptance scenarios; provider POSTs were synthetic only`);
}finally{
 await Promise.all(clients.map(c=>c.end().catch(()=>{})));
 if(running)pgctl('-m','fast','-w','stop');
 rmSync(root,{recursive:true,force:true});
}
