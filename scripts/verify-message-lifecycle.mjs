// Runs only inside the disposable local PostgreSQL harness. Fictional stays and
// forbidden provider calls: a lifecycle rehearsal cannot deliver a real message.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { diffPlan, withdrawnSends } from '../src/lib/automations-core.ts';
import { runScheduledChannexMessages } from '../src/lib/channex-messaging/scheduled.ts';
import { runScheduledCleanerMessages } from '../src/lib/cleaner-messaging/scheduled.ts';
export async function verifyMessageLifecycle({db,bundle,scalar}) {
  let count=0,providerCalls=0;
  const pass=label=>{count++;console.log(`PASS message lifecycle: ${label}`);};
  const forbidden=async()=>{providerCalls++;throw Error('HELMTEST provider call forbidden');};
  const rpc=async(name,args)=>{
    const calls={
      automation_channex_candidates:['select automation_channex_candidates($1,$2,$3) data',[args.p_property_id,args.p_environment,args.p_limit]],
      automation_channex_snapshot:['select automation_channex_snapshot($1) data',[args.p_send_id]],
      automation_channex_read:['select automation_channex_read($1) data',[args.p_send_id]],
      automation_channex_refresh:['select automation_channex_refresh($1,$2,$3,$4) data',[args.p_send_id,args.p_revision,args.p_body_sha256,args.p_fire_at]],
      automation_channex_checked:['select automation_channex_checked($1) data',[args.p_send_id]],
      automation_cleaner_candidates:['select automation_cleaner_candidates($1) data',[args.p_property_id]],
      automation_cleaner_snapshot:['select automation_cleaner_snapshot($1) data',[args.p_job_id]],
      automation_cleaner_refresh:['select automation_cleaner_refresh($1,$2,$3) data',[args.p_job_id,args.p_revision,args.p_fire_at]],
      automation_cleaner_checked:['select automation_cleaner_checked($1) data',[args.p_job_id]],
    };
    assert.ok(calls[name],`Unexpected lifecycle RPC ${name}`);
    return {data:await scalar(...calls[name]),error:null};
  };
  const ledger=f=>scalar('select jsonb_agg(to_jsonb(s) order by s.automation_key) data from automation_sends s where booking_id=$1',[f.booking]);
  const prepare=async()=>{
    const f=await bundle();
    for(const e of f.entries)if(!e.review.sent)e.review.expires_at=new Date(Date.parse(e.review.expires_at)+30*86400000).toISOString();
    await scalar('select automation_message_handoff_stay($1,$2,$3) data',[f.booking,f.canonical,JSON.stringify(f.entries)]);
    // Enable only these fictional local fixture controls to exercise the real
    // scan/refresh path. No hosted database or transport is available here.
    await db.query('update automation_channex_routes set enabled=true where property_id=$1',[f.property]);
    await db.query('update automation_cleaner_batches set enabled=true where property_id=$1',[f.property]);
    return f;
  };
  const tick=async f=>({
    guest:await runScheduledChannexMessages({config:{propertyId:f.property,environment:'staging',apiKey:'HELMTEST'},rpc,
      transportFactory:()=>({sendText:forbidden,verifyReceipt:forbidden})}),
    cleaner:await runScheduledCleanerMessages({config:{propertyId:f.property,apiKey:'HELMTEST'},rpc,
      transport:{send:forbidden,receipt:forbidden}}),
  });
  const observe=async(f,overrides={})=>{
    const facts=await scalar("select jsonb_build_object('check_in',check_in,'check_out',check_out,'observed_at',date_trunc('milliseconds',clock_timestamp())) data from bookings where id=$1",[f.booking]);
    const old=await scalar('select revision data from automation_message_observations where booking_id=$1',[f.booking]);
    const canonical=await scalar('select automation_message_stay_revision($1) data',[f.booking]);
    return scalar('select automation_message_observe_times($1,$2,$3,$4) data',[f.booking,canonical,old,
      {...f.obs,...facts,...overrides,source_revision:`HELMTEST:${randomUUID()}`,evidence_id:`HELMTEST:${randomUUID()}`}]);
  };
  let f=await prepare();const before=await ledger(f);
  const nativePlans=before.map(s=>({...s,fire_at:new Date(Date.parse(s.fire_at)+86400000).toISOString(),status:'scheduled',error:null}));
  assert.equal(diffPlan(nativePlans,before).frozen,6);
  assert.equal(diffPlan(nativePlans.map(s=>({...s,automation_id:randomUUID()})),before).keyed,6);
  assert.deepEqual(withdrawnSends([],before,nativePlans.map(s=>({id:s.automation_id,trigger:'pre_arrival'})),new Set(nativePlans.map(s=>s.automation_id))),[]);
  pass('native planner cannot retime, withdraw or replace any of the six real handoff ledger rows');
  await db.query('update bookings set check_in=check_in+1,check_out=check_out+1 where id=$1',[f.booking]);
  const stale=await tick(f);
  assert.equal(stale.guest.accepted+stale.cleaner.accepted,0);assert.deepEqual(await ledger(f),before);
  pass('changed dates block both workers until a matching fresh timing observation exists');
  await observe(f,{arrival_time:'17:00',departure_time:'12:00'});
  const refreshed=await tick(f),after=await ledger(f);
  assert.equal(refreshed.guest.refreshed,3);assert.equal(refreshed.guest.held,1);assert.equal(refreshed.guest.attention,0);
  assert.equal(refreshed.cleaner.blocked+refreshed.cleaner.attention,0);
  for(const old of before){
    const current=after.find(s=>s.id===old.id);assert.ok(current);
    if(old.automation_key==='confirmation'){assert.deepEqual(current,old);continue;}
    assert.equal(current.status,old.status);
    assert.equal(Date.parse(current.fire_at)-Date.parse(old.fire_at),25*3600000);
    assert.equal(Date.parse(current.planned_check_in)-Date.parse(old.planned_check_in),86400000);
  }
  assert.equal(after.length,6);assert.equal(after.find(s=>s.automation_key==='key_code').status,'held');
  assert.equal(providerCalls,0);
  pass('both real workers retime five unsent workflows by the exact date and local-clock change while retaining IDs, source history and door-code hold');
  await tick(f);
  assert.deepEqual((await ledger(f)).map(s=>[s.id,s.status,s.fire_at]),after.map(s=>[s.id,s.status,s.fire_at]));
  assert.equal(providerCalls,0);
  pass('repeated scheduling ticks preserve the same six rows and never replay imported confirmation');
  const priorCancel=await ledger(f);
  await db.query("update bookings set status='cancelled' where id=$1",[f.booking]);
  await tick(f);assert.deepEqual(await ledger(f),priorCancel);assert.equal(providerCalls,0);
  pass('cancellation suppresses both guest and cleaner execution without deleting history or releasing holds');
  f=await prepare();const expiredBefore=await ledger(f);
  await db.query('update bookings set check_in=check_in+45,check_out=check_out+45 where id=$1',[f.booking]);
  await observe(f);const expired=await tick(f);
  assert.equal(expired.guest.blocked,3);assert.equal(expired.cleaner.blocked,4);
  assert.deepEqual(await ledger(f),expiredBefore);assert.equal(providerCalls,0);
  pass('a date move beyond the reviewed handoff expiry cannot silently extend sending authority');
  console.log(`PASS ${count} additional message lifecycle PostgreSQL scenarios; zero provider calls`);
}
