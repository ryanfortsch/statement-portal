/** Full chain prerequisite. Disposable loopback DB, synthetic bookings only. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { normalizeAirbnbBookingRevision } from '../src/lib/channex-bookings/revision.ts';
import { createNewStayStore } from '../src/lib/channex-messaging/new-stay-store.ts';
import { CALDERWOOD_PRODUCTION as m } from '../src/lib/channex-production-preflight.ts';
import { intakeRow } from '../src/lib/__tests__/fixtures/channex-booking-intake.ts';
if (process.env.PGHOST !== '127.0.0.1' || process.env.PGDATABASE !== 'helm_synthetic_channex') throw Error('Synthetic loopback database required');
globalThis.fetch = async () => { throw Error('Real network disabled'); };
const psql = process.env.CHANNEX_TEST_PSQL || 'psql';
const quote = (v: unknown) => "'"+String(v).replaceAll("'", "''")+"'";
function sql(input: string) {
  const r = spawnSync(psql, ['-X','-Atq','-v','ON_ERROR_STOP=1'], { input, encoding:'utf8' });
  if (r.status) throw Error(r.stderr); return r.stdout.trim();
}
function asyncSql(input: string) {
  const child = spawn(psql,['-X','-Atq','-v','ON_ERROR_STOP=1']); let out='',err='';
  child.stdout.on('data',v=>{out+=v;});child.stderr.on('data',v=>{err+=v;});
  const done = new Promise<string>((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code?reject(Error(err)):resolve(out.trim()));});
  child.stdin.end(input);return done;
}
const read = (id: string) => JSON.parse(sql(`set role service_role; select helm_channex_new_stay_read('${id}');`) || 'null');
const admitSql = 'set role service_role; select helm_channex_new_stays_admit();';
const admit = () => JSON.parse(sql(admitSql));
const counts = () => sql("select (select count(*) from automation_sends)||':'||(select count(*) from helm_channex_messages.jobs)||':'||(select count(*) from helm_channex_messages.cleaner_jobs);");
const originalCounts = counts();
sql(readFileSync('supabase/migrations/20261114010000_channex_new_stay_admission.sql','utf8'));
assert.equal(counts(),originalCounts);
for(const name of ['new_stay_epochs','new_stay_admissions','new_stay_clock_exceptions']) {
  assert.equal(sql(`select count(*) from helm_channex_messages.${name};`),'0');
  assert.equal(sql(`select relrowsecurity from pg_class where oid='helm_channex_messages.${name}'::regclass;`),'t');
  for(const role of ['anon','authenticated','service_role'])
    assert.equal(sql(`select has_table_privilege('${role}','helm_channex_messages.${name}','select,insert,update,delete');`),'f');
}
for(const fn of ['helm_channex_new_stays_admit()','helm_channex_new_stay_read(uuid)','helm_channex_new_stay_clock_save(jsonb,text)']) {
  for(const role of ['anon','authenticated']) assert.equal(sql(`select has_function_privilege('${role}','${fn}','execute');`),'f');
  assert.equal(sql(`select has_function_privilege('service_role','${fn}','execute');`),'t');
}
assert.deepEqual(admit(),{state:'disabled',admitted:0,canSend:false});
const map={environment:'production' as const,propertyId:m.propertyId,roomTypeId:m.roomTypeId,ratePlanId:m.ratePlanId,generation:1};
function make(n:number,status='new',remote=randomUUID(),code='ADMISSIONSYNTHETIC'+n) {
  const raw=intakeRow();raw.id=randomUUID();
  const start=`2036-03-${String(n*2+1).padStart(2,'0')}`,end=`2036-03-${String(n*2+2).padStart(2,'0')}`;
  Object.assign(raw.attributes,{booking_id:remote,ota_reservation_code:code,status,arrival_date:start,departure_date:end});
  Object.assign(raw.attributes.rooms[0],{checkin_date:start,checkout_date:end});
  return normalizeAirbnbBookingRevision(raw,map);
}
const commit=(v:ReturnType<typeof make>)=>JSON.parse(sql(`set role service_role; select helm_airbnb_revision_commit(${quote(JSON.stringify(v))}::jsonb);`));
const before=commit(make(0));
assert.equal(admit().admitted,0);assert.equal(read(before.canonicalBookingId),null);
const epoch=randomUUID(),excludedRemote=randomUUID();
// Fixture-only independent cutover evidence. Production has NO epoch creator.
sql(`update helm_channex_messages.scope set enabled=true,source_stopped_at=clock_timestamp()-interval '5 minutes',
 source_drained_at=clock_timestamp()-interval '4 minutes',source_evidence_id=gen_random_uuid() where property_id='65_calderwood';
 insert into helm_channex_messages.new_stay_epochs(id,property_id,route_generation,source_evidence_id,source_drained_at,
 import_generation,coverage_evidence_id,baseline_remote_ids,baseline_codes,actor,timing_policy,confirmation_policy)
 select '${epoch}',property_id,generation,source_evidence_id,source_drained_at,1,gen_random_uuid(),array['${excludedRemote}'::uuid],
 array[' ADMISSIONSYNTHETIC2 '],'synthetic-owner','calderwood_new_airbnb_helm_clocks_v1',
 'calderwood_new_airbnb_first_receipt_30m_v1' from helm_channex_messages.scope where property_id='65_calderwood';`);
assert.throws(()=>sql(`update helm_channex_messages.new_stay_epochs set opened_at=clock_timestamp();`),/immutable/);
const excludedByRemote=commit(make(1,'new',excludedRemote)),excludedByCode=commit(make(2)),modifiedFirst=commit(make(3,'modified'));
assert.equal(admit().admitted,0);
for(const b of [before,excludedByRemote,excludedByCode,modifiedFirst])assert.equal(read(b.canonicalBookingId),null);

const good=Array.from({length:8},(_,i)=>commit(make(i+4)));
// Already-known history cannot become a "new" automation enrollment. Put it
// first in arrival order to prove it cannot starve the next five eligible stays.
sql(`insert into automation_sends(booking_id,property_id,automation_key,fire_at,status,planned_check_in,planned_check_out)
 select id,property_id,'synthetic_prior_send',clock_timestamp(),'sent',check_in,check_out from bookings where id='${good[0].canonicalBookingId}';`);
const one=admit();assert.equal(one.admitted,5);assert.equal(one.canSend,false);
const concurrent=await Promise.all([asyncSql(admitSql),asyncSql(admitSql)]);
assert.equal(concurrent.map(v=>JSON.parse(v).admitted).reduce((a,b)=>a+b,0),2);
assert.equal(sql('select count(*) from helm_channex_messages.new_stay_admissions;'),'7');
assert.equal(admit().admitted,0);assert.equal(read(good[0].canonicalBookingId),null);

const rpc=async(name:string,args:Record<string,unknown>)=>{
  const expression=name==='helm_channex_new_stays_admit'?'helm_channex_new_stays_admit()'
    :name==='helm_channex_new_stay_read'?`helm_channex_new_stay_read(${quote(args.p_booking)}::uuid)`
    :name==='helm_channex_new_stay_clock_save'?`helm_channex_new_stay_clock_save(${quote(JSON.stringify(args.p_change))}::jsonb,${quote(args.p_actor)})`:null;
  assert.ok(expression);return {data:JSON.parse(sql('set role service_role; select '+expression+';')||'null'),error:null};
};
const store=createNewStayStore(rpc,{enabled:true});
const target=good[1].canonicalBookingId;
const loaded=await store.load(target);assert.ok(loaded);
assert.equal(loaded.clocks.defaultArrival,'16:00');assert.equal(loaded.clocks.defaultDeparture,'11:00');
assert.equal(loaded.clocks.confirmedAt,null);
assert.equal(loaded.confirmation.fireAt,sql(`select to_char(to_timestamp(ceil(extract(epoch from(first_received_at+interval '30 minutes'))*1000)/1000)
 at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from helm_channex_messages.new_stay_admissions where booking_id='${target}';`));
const change={id:randomUUID(),bookingId:target,replaces:null,start:loaded.clocks.start,end:loaded.clocks.end,arrival:'13:00',departure:'12:00'};
assert.equal((await store.saveClocks(change,'synthetic-owner')).state,'created');
assert.equal((await store.saveClocks(change,'synthetic-owner')).state,'existing');
assert.equal((await store.load(target))!.clocks.plannedArrival,'13:00');
assert.equal((await store.saveClocks({...change,arrival:'14:00'},'synthetic-owner')).state,'uncertain');
assert.equal((await store.saveClocks({...change,id:randomUUID()},'synthetic-owner')).state,'uncertain');
const reset={...change,id:randomUUID(),replaces:change.id,arrival:null,departure:null};
// Commit a clock edit then lose the client response. The same request recovers
// its receipt; it cannot overwrite a different edit or append a second version.
const lost=createNewStayStore(async(name,args)=>{await rpc(name,args);throw Error('response lost');},{enabled:true});
assert.equal((await lost.saveClocks(reset,'synthetic-owner')).state,'uncertain');
assert.equal((await store.saveClocks(reset,'synthetic-owner')).state,'existing');
assert.equal(sql(`select count(*) from helm_channex_messages.new_stay_clock_exceptions where booking_id='${target}';`),'2');
assert.equal((await store.load(target))!.clocks.plannedArrival,null);

// Competing operators cannot both append an initial exception. The loser must
// refresh the saved version before changing it, just like a lost-response retry.
const raceBooking=good[3].canonicalBookingId, raceLoaded=(await store.load(raceBooking))!;
const raceChanges=[1,2].map((n)=>({id:randomUUID(),bookingId:raceBooking,replaces:null,
 start:raceLoaded.clocks.start,end:raceLoaded.clocks.end,arrival:`1${n}:00`,departure:null}));
const race=await Promise.allSettled(raceChanges.map(c=>asyncSql(`set role service_role;
 select helm_channex_new_stay_clock_save(${quote(JSON.stringify(c))}::jsonb,'synthetic-owner');`)));
assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
assert.equal(race.filter(r=>r.status==='rejected').length,1);
assert.equal(sql(`select count(*) from helm_channex_messages.new_stay_clock_exceptions where booking_id='${raceBooking}';`),'1');

// The existing Helm late-checkout store must participate; it cannot silently
// disappear because the new timing source uses a different exception table.
sql(`alter table checkout_adjustments add column if not exists original_check_out date;
 alter table checkout_adjustments add column if not exists adjusted_checkout_time text;
 alter table checkout_adjustments add column if not exists status text;`);
const adjustedBooking=good[4].canonicalBookingId, adjustmentId=randomUUID();
sql(`insert into checkout_adjustments(id,property_id,stay_check_in,original_check_out,adjusted_checkout_time,status)
 select '${adjustmentId}',property_id,check_in,check_out,'13:00','active' from bookings where id='${adjustedBooking}';`);
assert.equal((await store.load(adjustedBooking))!.clocks.plannedDeparture,'13:00');
sql(`update checkout_adjustments set adjusted_check_out=original_check_out+1 where id='${adjustmentId}';`);
await assert.rejects(store.load(adjustedBooking),/inputs unavailable/);

// A normal queued or historical message is NOT permission to silently retime it.
const historyBooking=good[5].canonicalBookingId, historyClocks=(await store.load(historyBooking))!.clocks;
sql(`insert into automation_sends(booking_id,property_id,automation_key,fire_at,status,planned_check_in,planned_check_out)
 select id,property_id,'synthetic_scheduled',clock_timestamp()+interval '1 day','scheduled',check_in,check_out
 from bookings where id='${historyBooking}';`);
assert.equal((await store.saveClocks({id:randomUUID(),bookingId:historyBooking,replaces:null,
 start:historyClocks.start,end:historyClocks.end,arrival:'13:00',departure:null},'synthetic-owner')).state,'uncertain');
assert.equal(sql(`select count(*) from helm_channex_messages.new_stay_clock_exceptions where booking_id='${historyBooking}';`),'0');

// Change and cancellation preserve admission/first receipt, while stale dated
// exceptions demand review and cancellations return no scheduling inputs.
const edit={...good[1].revision,revisionId:randomUUID(),status:'modified' as const,checkIn:'2036-04-01',checkOut:'2036-04-03',providerReceivedAt:'2026-11-14T12:00:00.000001Z'};
commit(edit);
await assert.rejects(store.load(target),/inputs unavailable/);
const adjusted={...reset,id:randomUUID(),replaces:reset.id,start:edit.checkIn,end:edit.checkOut};
assert.equal((await store.saveClocks(adjusted,'synthetic-owner')).state,'created');
assert.equal((await store.load(target))!.confirmation.fireAt,loaded.confirmation.fireAt);
const cancel={...edit,revisionId:randomUUID(),status:'cancelled' as const,providerReceivedAt:'2026-11-14T12:00:00.000002Z'};
commit(cancel);assert.equal(await store.load(target),null);
assert.equal(sql(`select count(*) from helm_channex_messages.new_stay_admissions where booking_id='${target}';`),'1');

// A live scope revocation blocks all future uses; restoring the SAME unchanged
// route can resume reads. A changed generation cannot adopt the old epoch.
const remaining=good[2].canonicalBookingId;
sql("update helm_channex_messages.scope set enabled=false where property_id='65_calderwood';");
assert.equal(admit().state,'disabled');assert.equal(await store.load(remaining),null);
sql("update helm_channex_messages.scope set enabled=true where property_id='65_calderwood';");
assert.ok(await store.load(remaining));
sql("update helm_channex_messages.scope set generation=gen_random_uuid() where property_id='65_calderwood';");
assert.equal(admit().state,'disabled');assert.equal(await store.load(remaining),null);
assert.equal(sql('select count(*) from helm_channex_messages.jobs;'),originalCounts.split(':')[1]);
assert.equal(sql('select count(*) from helm_channex_messages.cleaner_jobs;'),originalCounts.split(':')[2]);
console.log('PASS: real SQL admission baseline exclusions, pre-boundary/import refusal, bounded/concurrent admission, idempotent receipt clocks, exception CAS/recovery, edits/cancellation, revocation, and service-only permissions; no jobs or messages');
