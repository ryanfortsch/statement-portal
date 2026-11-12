/** Real PostgreSQL, synthetic loopback only. No .env or provider requests. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createChannexTimingBindingStore } from '../src/lib/channex-messaging/timing-binding-store.ts';
import { timingReviewOverviewSchema } from '../src/lib/channex-messaging/timing-review-contract.ts';
import { requireTimingEvidence } from '../src/lib/channex-messaging/timing-evidence.ts';
import { createChannexScheduleStore } from '../src/lib/channex-messaging/schedule-store.ts';
import { createCalderwoodScheduleInputReader } from '../src/lib/channex-messaging/schedule-inputs.ts';
import { registerCalderwoodStaySchedules } from '../src/lib/channex-messaging/schedule-coordinator.ts';
import { reviewCalderwoodTimingBinding } from '../src/lib/channex-messaging/timing-provider-review.ts';
import { syntheticTimingProvider } from '../src/lib/__tests__/fixtures/channex-timing-provider.ts';
import { MESSAGE_RULE_FIELDS } from '../src/lib/channex-messaging/preparation-rules.ts';
import { syntheticScheduleSnapshot } from '../src/lib/__tests__/fixtures/channex-schedule-snapshot.ts';
if (process.env.PGHOST !== '127.0.0.1' || process.env.PGDATABASE !== 'helm_synthetic_channex') throw Error('Synthetic loopback database required');
const psql = process.env.CHANNEX_TEST_PSQL || 'psql';
function sql(query: string) {
  const r = spawnSync(psql, ['-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8' });
  if (r.status) throw Error(r.stderr); return r.stdout.trim();
}
const str = (s: string) => "'" + s.replaceAll("'", "''") + "'";
const bid = '90000000-0000-4000-8000-000000000901';
const remote = '90000000-0000-4000-8000-000000000905', thread = '90000000-0000-4000-8000-000000000906';
let loseResponse = false, rpcCalls = 0;
const rpc = async (name: string, args: Record<string, unknown>) => {
  rpcCalls++;
  const a = name === 'helm_channex_timing_binding_read' ? str(String(args.p_binding_id))+'::uuid'
    : name === 'helm_channex_timing_binding_review' ? str(JSON.stringify(args.p_intent))+'::jsonb,'+str(String(args.p_actor))
    : name === 'helm_channex_message_schedule_context' ? str(String(args.p_booking_id))+'::uuid'
    : name === 'helm_channex_message_register' ? str(JSON.stringify(args.p_plan))+'::jsonb'
    : name === 'helm_channex_message_schedule_inputs' ? str(String(args.p_booking_id))+'::uuid,'+str(String(args.p_binding_id))+'::uuid' : null;
  assert.ok(a);
  const raw = sql(`set role service_role; select to_jsonb(public.${name}(${a}));`);
  if (loseResponse && name.endsWith('_review')) throw Error('Synthetic lost committed response');
  return { data: raw ? JSON.parse(raw) : null, error: null };
};
const store = createChannexTimingBindingStore(rpc, { enabled: true });
sql(readFileSync(new URL('../supabase/migrations/20261112160000_channex_timing_bindings.sql', import.meta.url), 'utf8'));
sql(readFileSync(new URL('../supabase/migrations/20261112190000_channex_timing_review_surface.sql', import.meta.url), 'utf8'));
// Expand the deliberately minimal fixture to the existing production columns
// used by the real private input reader. These are synthetic values only.
sql(`alter table properties add column kind text not null default 'managed', add column is_active boolean not null default true,
 add column name text, add column wifi_name text;
 alter table property_access add column wifi_password text;
 update properties set name='Synthetic Home',wifi_name='Synthetic Network' where id='65_calderwood';
 update property_access set smart_lock_code='SYNTHETIC-CODE',wifi_password='SYNTHETIC-PASSWORD' where property_id='65_calderwood';`);
sql(readFileSync(new URL('../supabase/migrations/20261112210000_channex_schedule_inputs.sql', import.meta.url), 'utf8'));
const inputReader=createCalderwoodScheduleInputReader(rpc,{enabled:true});
assert.equal(sql("select count(*) from helm_channex_messages.timing_bindings;"), '0');
assert.equal(sql(`select has_table_privilege('service_role','helm_channex_messages.timing_bindings','select,insert,update,delete')
 or has_table_privilege('authenticated','helm_channex_messages.timing_bindings','select,insert,update,delete')
 or has_function_privilege('authenticated','helm_channex_timing_binding_review(jsonb,text)','execute')
 or has_function_privilege('anon','helm_channex_timing_binding_read(uuid)','execute');`), 'f');
assert.equal(sql("select relrowsecurity from pg_class where oid='helm_channex_messages.timing_bindings'::regclass;"), 't');
function setup() {
  sql(`delete from helm_channex_messages.timing_bindings;
    delete from helm_airbnb_bookings.bookings where canonical_id='${bid}';
    select channex_synthetic_timing_setup();
    update properties set kind='managed',is_active=true where id='65_calderwood';
    update bookings set guest_name='Synthetic Guest' where id='${bid}';`);
  const row = JSON.parse(sql('select channex_synthetic_timing_plan()->0;'));
  const capture = JSON.parse(sql(`set role service_role; select helm_channex_capture_source_timing(
    channex_synthetic_timing_plan(),clock_timestamp()-interval '5 seconds',clock_timestamp(),'owner@synthetic.test');`));
  // Deliberate synthetic handover fixture, not a production activation writer.
  sql(`update properties set calendar_authority='helm',automations_enabled=true where id='65_calderwood';
    insert into helm_channex_messages.scope(property_id,environment,remote_property,channel_id,provider,enabled,source_stopped_at,source_drained_at,source_evidence_id)
    values('65_calderwood','production','320c5cb5-91e0-46af-b9b3-a3fc20b4631e',gen_random_uuid(),'Airbnb',true,clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour',gen_random_uuid());
    insert into helm_airbnb_bookings.bookings(remote_id,canonical_id,code,environment,remote_property,generation,latest_at,latest_revision,check_in,check_out,status)
    select '${remote}',id,external_confirmation_code,'production','320c5cb5-91e0-46af-b9b3-a3fc20b4631e',1,clock_timestamp(),gen_random_uuid(),check_in,check_out,status from bookings where id='${bid}';`);
  const context = JSON.parse(sql(`select helm_channex_message_schedule_context('${bid}');`));
  const now = new Date().toISOString();
  return { bindingId: randomUUID(), captureId: capture.captureId, bookingId: bid, context,
    remoteBookingId: remote, threadId: thread, reviewStartedAt: now, reviewCheckedAt: now, reviewedRow: row };
}
const expected = (p: ReturnType<typeof setup>) => {
  const { bookingId, start, end, clocks, status: _status, ...sourceIdentity } = p.reviewedRow; void _status;
  return { bookingId, sourceIdentity, clocks: { start, end, ...clocks }, observedAt: new Date().toISOString(),
    route: { remoteBookingId: remote, threadId: thread }, context: p.context };
};
const count = () => sql('select count(*) from helm_channex_messages.timing_bindings;');
let p = setup();
// Exercise the SQL boundary directly, independently of the TypeScript parser.
for (const raw of [{...p,extra:'untrusted'}, {...p,reviewedRow:null},
  {...p,context:{...p.context,extra:'untrusted'}},
  {...p,reviewedRow:{...p.reviewedRow,guestName:'synthetic-private'}}]) {
  assert.throws(()=>sql(`set role service_role; select helm_channex_timing_binding_review(${str(JSON.stringify(raw))}::jsonb,'owner@synthetic.test');`));
  assert.equal(count(),'0');
}
assert.equal((await createChannexTimingBindingStore(rpc).bind(p,'owner@synthetic.test')).state, 'disabled');
assert.equal(rpcCalls, 0);
assert.equal((await store.bind(p,'owner@synthetic.test')).state, 'created');
const initial = await store.load(p.bindingId, expected(p), Date.now()); assert.ok(initial);
requireTimingEvidence(initial, expected(p), Date.now());
assert.equal(initial.captureId, p.captureId);
assert.equal((await store.bind(p,'owner@synthetic.test')).state, 'existing');
assert.deepEqual(await store.load(p.bindingId, expected(p), Date.now()), initial);
assert.equal(count(), '1');
assert.equal(sql('select (select count(*) from automation_sends)||\':\'||(select count(*) from helm_channex_messages.jobs);'), '0:0');
// Conflicting replay cannot overwrite the retained review, including its actor.
assert.equal((await store.bind({...p, threadId:randomUUID()},'owner@synthetic.test')).state, 'uncertain');
assert.equal((await store.bind(p,'different@synthetic.test')).state, 'uncertain');
assert.equal(count(), '1');
assert.deepEqual(await store.load(p.bindingId, expected(p), Date.now()), initial);

p=setup(); loseResponse=true;
assert.equal((await store.bind(p,'owner@synthetic.test')).state,'uncertain'); assert.equal(count(),'1');
loseResponse=false;
assert.ok(await store.load(p.bindingId,expected(p),Date.now()));
assert.equal((await store.bind(p,'owner@synthetic.test')).state,'existing'); assert.equal(count(),'1');

for (const mutate of [
  (v: typeof p) => ({...v, captureId:randomUUID()}),
  (v: typeof p) => ({...v, context:{...v.context,contextRevision:'0'.repeat(32)}}),
  (v: typeof p) => ({...v, remoteBookingId:randomUUID()}),
  (v: typeof p) => ({...v, reviewedRow:{...v.reviewedRow,clocks:{...v.reviewedRow.clocks,defaultArrival:'15:00'}}}),
  (v: typeof p) => ({...v, reviewStartedAt:new Date(Date.now()-90_000).toISOString(),reviewCheckedAt:new Date(Date.now()-80_000).toISOString()}),
  (v: typeof p) => ({...v, reviewStartedAt:new Date(Date.now()+10_000).toISOString(),reviewCheckedAt:new Date(Date.now()+10_000).toISOString()}),
]) {
  p=setup(); assert.equal((await store.bind(mutate(p),'owner@synthetic.test')).state,'uncertain'); assert.equal(count(),'0');
}
// A persisted record cannot silently attach itself to changed current state.
for (const mutation of [
  `update bookings set status='cancelled' where id='${bid}'`,
  `update bookings set check_out=check_out+1 where id='${bid}'`,
  `update bookings set duplicate_of=id where id='${bid}'`,
  `update properties set calendar_authority='guesty' where id='65_calderwood'`,
  `update properties set automations_enabled=false where id='65_calderwood'`,
  `update helm_channex_messages.scope set generation=gen_random_uuid()`,
  `update helm_channex_messages.scope set source_evidence_id=gen_random_uuid()`,
  `update helm_channex_messages.scope set enabled=false,source_stopped_at=null`,
  `update guesty_reservations set check_out=check_out+1`,
  `update helm_airbnb_bookings.bookings set remote_property=gen_random_uuid() where canonical_id='${bid}'`,
  `update property_access set smart_lock_code='changed-synthetic' where property_id='65_calderwood'`,
]) {
  p=setup(); assert.equal((await store.bind(p,'owner@synthetic.test')).state,'created');
  sql(mutation); assert.equal(await store.load(p.bindingId,expected(p),Date.now()),null);
  assert.equal((await store.bind(p,'owner@synthetic.test')).state,'uncertain'); assert.equal(count(),'1');
}
// Real provider-review orchestration -> SQL binding -> production input reader ->
// coordinator, using only synthetic provider fixtures and explicit fixture setup.
function providerReview(plan: ReturnType<typeof setup>, corruptSecondClock = false) {
  const load = async () => {
    const value = JSON.parse(sql(`set role service_role; select helm_channex_timing_review_snapshot('${plan.captureId}','${bid}');`));
    // Expected context comes from the same UTC-pinned production reader,
    // not a connection-timezone rendering of an equivalent instant.
    if (value) plan.context=value.context;
    return value;
  };
  let reads = 0;
  return reviewCalderwoodTimingBinding({bindingId:plan.bindingId,captureId:plan.captureId,bookingId:bid},'owner@synthetic.test',{
    load,store,clock:Date.now,credentials:async()=>({guestyToken:'synthetic-guesty',channexKey:'synthetic-channex'}),
    fetcher:async(url,init)=>{
      assert.equal(init?.method,'GET'); assert.equal(init?.body,undefined); reads++;
      const s=await load(), source=syntheticTimingProvider(s.capture.row,{...s.route,threadId:thread,channelId:s.scope.channelId});
      if(corruptSecondClock && reads>4) source.v2.plannedArrival='22:00';
      const path=new URL(String(url)).pathname;
      return Response.json(path.includes('/reservations/')?source.v2:path.endsWith('/reservations-v3')?source.v3
        :path.includes('/bookings/')?source.booking:path.endsWith('/message_threads')
          ? {data:[source.thread.data],meta:{page:1,limit:100,total:1}} :source.thread);
    },
  },{enabled:true});
}
p=setup();
assert.equal((await providerReview(p,true)).state,'changed'); assert.equal(count(),'0');
assert.equal(sql('select count(*) from helm_channex_messages.jobs;'),'0');
loseResponse=true;
assert.equal((await providerReview(p)).state,'uncertain'); assert.equal(count(),'1');
loseResponse=false;
assert.ok(await store.load(p.bindingId,expected(p),Date.now()));
assert.equal(sql('select count(*) from helm_channex_messages.jobs;'),'0');

// The deployed read surface is available to the service role only and has no
// side effects even when Guesty still controls the home.
assert.equal(sql(`select has_function_privilege('anon','helm_channex_timing_review_overview()','execute')
 or has_function_privilege('authenticated','helm_channex_timing_review_snapshot(uuid,uuid)','execute');`),'f');
const overview=()=>timingReviewOverviewSchema.parse(JSON.parse(sql('set role service_role; select helm_channex_timing_review_overview();')));
p=setup();
assert.equal(overview().stays[0].state,'ready');
assert.equal(sql(`set timezone='Pacific/Auckland'; select helm_channex_message_schedule_context('${bid}');`),
  sql(`set timezone='America/New_York'; select helm_channex_message_schedule_context('${bid}');`));
assert.equal(JSON.stringify(overview()).includes(p.reviewedRow.guestyId),false);
assert.equal(JSON.stringify(overview()).includes(p.reviewedRow.code),false);
assert.equal((await providerReview(p)).state,'created');
assert.equal(overview().stays[0].review?.id,p.bindingId);
assert.equal(overview().stays[0].review?.currentContext,true);
sql(`update bookings set check_out=check_out+1 where id='${bid}';`);
assert.equal(overview().stays[0].review?.currentContext,false);
assert.equal(overview().stays[0].state,'needs_matching');
assert.equal(sql(`set role service_role; select helm_channex_timing_review_snapshot('${p.captureId}','${bid}') is null;`),'t');
p=setup();
sql(`delete from helm_channex_messages.scope; update properties set calendar_authority='guesty',automations_enabled=false where id='65_calderwood';`);
const dormant=overview();
assert.equal(dormant.authority,'guesty');assert.equal(dormant.handoverRecorded,false);
assert.equal(dormant.stays[0].state,'waiting_handover');
assert.equal((await providerReview(p)).state,'unavailable');assert.equal(count(),'0');
assert.equal(sql('select count(*) from helm_channex_messages.jobs;'),'0');
assert.equal(sql(`set role service_role; select helm_channex_timing_review_snapshot('${randomUUID()}','${bid}') is null;`),'t');

// Both read functions are stable/service-only. The input loader returns no data
// without a usable binding, and never returns private notes, contacts or money.
assert.equal(sql(`select has_function_privilege('service_role','helm_channex_message_schedule_inputs(uuid,uuid)','execute')
 and not has_function_privilege('anon','helm_channex_message_schedule_inputs(uuid,uuid)','execute')
 and not has_function_privilege('authenticated','helm_channex_message_schedule_inputs(uuid,uuid)','execute');`),'t');
assert.equal(sql(`select provolatile='s' and prosecdef and 'search_path=""'=any(proconfig) and 'TimeZone=UTC'=any(proconfig)
 from pg_proc where oid='helm_channex_message_schedule_inputs(uuid,uuid)'::regprocedure;`),'t');
p=setup();
assert.equal(await inputReader.load(bid,p.bindingId),null);
sql(`update bookings set notes='PRIVATE-NOTES',guest_email='private@synthetic.test',guest_phone='PRIVATE-PHONE',gross_amount=12345 where id='${bid}';`);
assert.equal((await providerReview(p)).state,'created');
const loaded=await inputReader.load(bid,p.bindingId); assert.ok(loaded);
assert.equal(loaded.snapshot.merge.guest_first,'Synthetic');
assert.ok(!JSON.stringify(loaded).includes('PRIVATE-NOTES'));
assert.ok(!JSON.stringify(loaded).includes('private@synthetic.test'));
assert.ok(!JSON.stringify(loaded).includes('PRIVATE-PHONE'));
assert.ok(!('capturedRules' in loaded.snapshot));
assert.equal(await inputReader.load(randomUUID(),p.bindingId),null);
assert.equal(sql('select count(*) from helm_channex_messages.jobs;'),'0');
for(const mutation of [
 `update properties set kind='partner' where id='65_calderwood'`,
 `update properties set is_active=false where id='65_calderwood'`,
 `update properties set calendar_authority='guesty' where id='65_calderwood'`,
 `update property_access set wifi_password='CHANGED' where property_id='65_calderwood'`,
 `update bookings set guest_name='Changed Guest' where id='${bid}'`,
 `update bookings set check_out=check_out+1 where id='${bid}'`,
 `update helm_channex_messages.scope set enabled=false`,
 `update message_automations set body='Changed body' where property_id='65_calderwood'`,
]) {
 p=setup(); assert.equal((await providerReview(p)).state,'created');
 sql(mutation); assert.equal(await inputReader.load(bid,p.bindingId),null);
}

// Archived template release evidence is still synthetic and supplied separately.
// All current rules, booking, merge and history now use the real service reader.
p=setup();
const snapshot=syntheticScheduleSnapshot(Date.now());
sql('delete from message_automations;');
for (const rule of snapshot.currentRules.filter(r=>r.audience==='guest')) sql(`insert into message_automations(${MESSAGE_RULE_FIELDS})
 select ${MESSAGE_RULE_FIELDS} from jsonb_populate_record(null::message_automations,${str(JSON.stringify(rule))}::jsonb);`);
p.context=JSON.parse(sql(`select helm_channex_message_schedule_context('${bid}');`));
const reviewed=await providerReview(p);
assert.equal(reviewed.state,'created'); assert.equal(reviewed.sourceReads,10);
assert.equal(reviewed.jobsCreated+reviewed.messagesSent,0);
const schedules=createChannexScheduleStore(rpc,{enabled:true});
const load=async()=>{
  const inputs=await inputReader.load(bid,p.bindingId); assert.ok(inputs);
  return {...inputs.snapshot,capturedRules:snapshot.capturedRules};
};
const cycle=await registerCalderwoodStaySchedules(bid,{store:schedules,load,now:Date.now},{enabled:true,expiresAfterMs:1800_000});
assert.equal(cycle.state,'complete'); assert.equal(cycle.outcomes.filter(o=>o.state==='created').length,3);
assert.equal(sql('select count(*) from helm_channex_messages.jobs;'),'3');
assert.equal((await registerCalderwoodStaySchedules(bid,{store:schedules,load,now:Date.now},{enabled:true,expiresAfterMs:1800_000})).outcomes.filter(o=>o.state==='created').length,0);
assert.equal((await inputReader.load(bid,p.bindingId))?.snapshot.ledger.length,3);

// A cancelled/held row on a merged-away stay (including an indirect descendant)
// is not empty history. Block instead of replaying it under the canonical ID.
p=setup(); assert.equal((await providerReview(p)).state,'created');
const child='90000000-0000-4000-8000-000000000931',grandchild='90000000-0000-4000-8000-000000000932';
sql(`insert into bookings(id,property_id,channel,source,status,check_in,check_out,duplicate_of)
 select '${child}',property_id,channel,source,'cancelled',check_in,check_out,id from bookings where id='${bid}';
 insert into bookings(id,property_id,channel,source,status,check_in,check_out,duplicate_of)
 select '${grandchild}',property_id,channel,source,'cancelled',check_in,check_out,id from bookings where id='${child}';`);
assert.ok(await inputReader.load(bid,p.bindingId));
sql(`insert into automation_sends(id,booking_id,property_id,automation_key,fire_at,status,planned_check_in,planned_check_out)
 select gen_random_uuid(),id,property_id,'pre_arrival',clock_timestamp(),'cancelled',check_in,check_out from bookings where id='${grandchild}';`);
assert.equal(await inputReader.load(bid,p.bindingId),null);
sql(`delete from automation_sends where booking_id='${grandchild}'; delete from bookings where id in ('${child}','${grandchild}');`);

// Oversized history fails as a whole; a limit is never mistaken for completeness.
p=setup(); assert.equal((await providerReview(p)).state,'created');
sql(`insert into automation_sends(id,booking_id,property_id,automation_key,fire_at,status,planned_check_in,planned_check_out)
 select gen_random_uuid(),id,property_id,'synthetic_history_'||n,clock_timestamp(),'cancelled',check_in,check_out
 from bookings cross join generate_series(1,5001) n where id='${bid}';`);
assert.equal(await inputReader.load(bid,p.bindingId),null);

// Two independent SQL sessions reviewing the same intent converge on one record.
p=setup();
function concurrentReview() {
  const child=spawn(psql,['-X','-Atq','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
  return new Promise<string>((resolve,reject)=>{
    let out='',err='';child.stdout.on('data',s=>{out+=s;});child.stderr.on('data',s=>{err+=s;});
    child.on('error',reject);child.on('exit',c=>c?reject(Error(err)):resolve(JSON.parse(out.trim()).state));
    child.stdin.end(`set role service_role; select helm_channex_timing_binding_review(${str(JSON.stringify(p))}::jsonb,'owner@synthetic.test');`);
  });
}
assert.deepEqual((await Promise.all([concurrentReview(),concurrentReview()])).sort(),['created','existing']);assert.equal(count(),'1');

// A pending cancellation wins before review commits; no partial binding survives.
p=setup();
const writer=spawn(psql,['-X','-Atq','-v','ON_ERROR_STOP=1'],{env:{...process.env,PGAPPNAME:'channex_binding_cancel'},stdio:['pipe','pipe','pipe']});
const done=new Promise<void>((resolve,reject)=>{let err='';writer.stderr.on('data',s=>{err+=s;});writer.on('error',reject);writer.on('exit',c=>c?reject(Error(err)):resolve());});
writer.stdin.end(`begin; update bookings set status='cancelled' where id='${bid}'; select pg_sleep(2); commit;`);
let waiting=false;
for(let i=0;i<60;i++) {waiting=sql("select count(*) from pg_stat_activity where application_name='channex_binding_cancel' and wait_event='PgSleep'")==='1';if(waiting)break;await new Promise(r=>setTimeout(r,25));}
assert.ok(waiting);
assert.equal((await store.bind(p,'owner@synthetic.test')).state,'uncertain'); await done; assert.equal(count(),'0');
sql(`delete from helm_channex_messages.timing_bindings; delete from helm_airbnb_bookings.bookings where canonical_id='${bid}';
  select channex_synthetic_timing_setup(); delete from bookings where id='${bid}'; delete from guesty_reservations;`);
console.log('PASS: retained capture -> provider double-read -> SQL binding -> production input reader -> coordinator; provider drift, lost response, role isolation, complete history, duplicate-family conflicts, current-data changes and concurrent cancellation; reads/reviews create zero jobs/messages');
