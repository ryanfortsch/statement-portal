/** Real PostgreSQL, synthetic loopback only. No .env or provider requests. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createChannexTimingBindingStore } from '../src/lib/channex-messaging/timing-binding-store.ts';
import { requireTimingEvidence } from '../src/lib/channex-messaging/timing-evidence.ts';
import { createChannexScheduleStore } from '../src/lib/channex-messaging/schedule-store.ts';
import { registerCalderwoodStaySchedules } from '../src/lib/channex-messaging/schedule-coordinator.ts';
import { reviewCalderwoodTimingBinding } from '../src/lib/channex-messaging/timing-provider-review.ts';
import { syntheticTimingProvider } from '../src/lib/__tests__/fixtures/channex-timing-provider.ts';
import { MESSAGE_RULE_FIELDS } from '../src/lib/channex-messaging/preparation-rules.ts';
import { MESSAGE_SCHEDULE_LEDGER_FIELDS } from '../src/lib/channex-messaging/schedule-plan.ts';
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
    : name === 'helm_channex_message_register' ? str(JSON.stringify(args.p_plan))+'::jsonb' : null;
  assert.ok(a);
  const raw = sql(`set role service_role; select to_jsonb(public.${name}(${a}));`);
  if (loseResponse && name.endsWith('_review')) throw Error('Synthetic lost committed response');
  return { data: raw ? JSON.parse(raw) : null, error: null };
};
const store = createChannexTimingBindingStore(rpc, { enabled: true });
sql(readFileSync(new URL('../supabase/migrations/20261112160000_channex_timing_bindings.sql', import.meta.url), 'utf8'));
assert.equal(sql("select count(*) from helm_channex_messages.timing_bindings;"), '0');
assert.equal(sql(`select has_table_privilege('service_role','helm_channex_messages.timing_bindings','select,insert,update,delete')
 or has_table_privilege('authenticated','helm_channex_messages.timing_bindings','select,insert,update,delete')
 or has_function_privilege('authenticated','helm_channex_timing_binding_review(jsonb,text)','execute')
 or has_function_privilege('anon','helm_channex_timing_binding_read(uuid)','execute');`), 'f');
assert.equal(sql("select relrowsecurity from pg_class where oid='helm_channex_messages.timing_bindings'::regclass;"), 't');
function setup() {
  sql(`delete from helm_channex_messages.timing_bindings;
    delete from helm_airbnb_bookings.bookings where canonical_id='${bid}';
    select channex_synthetic_timing_setup();`);
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
// Real provider-review orchestration -> SQL binding -> coordinator. This loader
// reads synthetic database fixtures as the test database owner; it is deliberately
// NOT an application/service-role loader or a production activation writer.
function providerReview(plan: ReturnType<typeof setup>, corruptSecondClock = false) {
  const load = async () => JSON.parse(sql(`select jsonb_build_object(
    'capture',jsonb_build_object('id',c.id,'checkedAt',to_char(c.checked_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'savedAt',to_char(c.saved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'sourceContract',c.source_contract,'row',item),
    'context',public.helm_channex_message_schedule_context('${bid}'),
    'scope',jsonb_build_object('environment',s.environment,'propertyId',s.remote_property,'channelId',s.channel_id,'provider',s.provider),
    'route',jsonb_build_object('remoteBookingId',r.remote_id,'threadId','${thread}','revisionId',r.latest_revision))
    from helm_channex_messages.source_timing_captures c cross join lateral jsonb_array_elements(c.rows) item
    cross join helm_channex_messages.scope s join helm_airbnb_bookings.bookings r on r.canonical_id='${bid}'
    where c.id='${plan.captureId}' and item->>'bookingId'='${bid}' and s.property_id='65_calderwood';`));
  let reads = 0;
  return reviewCalderwoodTimingBinding({bindingId:plan.bindingId,captureId:plan.captureId,bookingId:bid},'owner@synthetic.test',{
    load,store,clock:Date.now,credentials:async()=>({guestyToken:'synthetic-guesty',channexKey:'synthetic-channex'}),
    fetcher:async(url,init)=>{
      assert.equal(init?.method,'GET'); assert.equal(init?.body,undefined); reads++;
      const s=await load(), source=syntheticTimingProvider(s.capture.row,{...s.route,channelId:s.scope.channelId});
      if(corruptSecondClock && reads>4) source.v2.plannedArrival='22:00';
      const path=new URL(String(url)).pathname;
      return Response.json(path.includes('/reservations/')?source.v2:path.endsWith('/reservations-v3')?source.v3
        :path.includes('/bookings/')?source.booking:source.thread);
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

// Templates/merge inputs are still synthetic; this is not their release workflow.
p=setup();
const snapshot=syntheticScheduleSnapshot(Date.now());
sql('delete from message_automations;');
for (const rule of snapshot.currentRules.filter(r=>r.audience==='guest')) sql(`insert into message_automations(${MESSAGE_RULE_FIELDS})
 select ${MESSAGE_RULE_FIELDS} from jsonb_populate_record(null::message_automations,${str(JSON.stringify(rule))}::jsonb);`);
p.context=JSON.parse(sql(`select helm_channex_message_schedule_context('${bid}');`));
const reviewed=await providerReview(p);
assert.equal(reviewed.state,'created'); assert.equal(reviewed.sourceReads,8);
assert.equal(reviewed.jobsCreated+reviewed.messagesSent,0);
const schedules=createChannexScheduleStore(rpc,{enabled:true});
const load=async()=>{
  const e=expected(p), evidence=await store.load(p.bindingId,e,Date.now());
  return {...snapshot,observedAt:e.observedAt,booking:{...snapshot.booking,id:bid,start:p.reviewedRow.start,end:p.reviewedRow.end},
    clocks:e.clocks,sourceIdentity:e.sourceIdentity,route:e.route,timingEvidence:evidence,
    ledger:JSON.parse(sql(`select coalesce(jsonb_agg(x),'[]'::jsonb) from
      (select ${MESSAGE_SCHEDULE_LEDGER_FIELDS} from automation_sends where booking_id='${bid}') x;`))};
};
const cycle=await registerCalderwoodStaySchedules(bid,{store:schedules,load,now:Date.now},{enabled:true,expiresAfterMs:1800_000});
assert.equal(cycle.state,'complete'); assert.equal(cycle.outcomes.filter(o=>o.state==='created').length,3);
assert.equal(sql('select count(*) from helm_channex_messages.jobs;'),'3');
assert.equal((await registerCalderwoodStaySchedules(bid,{store:schedules,load,now:Date.now},{enabled:true,expiresAfterMs:1800_000})).outcomes.filter(o=>o.state==='created').length,0);

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
console.log('PASS: retained capture -> provider double-read -> SQL binding -> trusted loader -> coordinator; provider drift, lost committed response, role isolation, conflicts, concurrent review/cancellation; review itself creates zero jobs/messages');
