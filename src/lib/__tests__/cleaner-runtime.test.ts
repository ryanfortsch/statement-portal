import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanerRuntimeFixture as fixture } from './fixtures/cleaner-runtime.ts';
import { runRetainedCleanerPilot,retainedCleanerSendId } from '../channex-messaging/cleaner-runtime.ts';
import { cleanerRuntimeConfiguration } from '../channex-messaging/cleaner-runtime-config.ts';
const due=Date.parse('2026-11-14T21:00:00Z');
test('cleaner runtime defaults off; malformed and duplicate manifests do no work',async()=>{
  const f=fixture();assert.equal((await runRetainedCleanerPilot(f.manifest,f.deps)).state,'disabled');
  for(const m of [null,{}, {...f.manifest,phone:'PRIVATE'}, {format:1,stays:[f.request,f.request]}, {format:1,stays:Array(5).fill(f.request)}])
    assert.equal((await runRetainedCleanerPilot(m,f.deps,{enabled:true})).state,'configuration_required');
  assert.equal(f.calls.length,0);assert.deepEqual(f.counts(),{posts:0,claims:0,registrations:0,smsReads:0});
});
test('activation configuration is independent and receipt-only needs no Guesty/Channex credentials',()=>{
  const f=fixture();const env={VERCEL_ENV:'production',NEXT_PUBLIC_SUPABASE_URL:'https://qjueexujiuticjrtqdyj.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY:'test',QUO_API_KEY:'test',CRON_SECRET:'test',CHANNEX_PRODUCTION_API_KEY:'test',
    HELM_CHANNEX_CLEANER_RECEIPT_KEY:f.keys.receiptKey,HELM_CHANNEX_CLEANER_KEY_ID:f.keys.keyId,
    HELM_CHANNEX_CLEANER_MODE:'retained-pilot-v1',HELM_CHANNEX_CLEANER_MANIFEST:JSON.stringify(f.manifest)};
  assert.equal(cleanerRuntimeConfiguration({}),null);assert.equal(cleanerRuntimeConfiguration({...env,HELM_CHANNEX_CLEANER_MODE:'off'}),null);
  assert.equal(cleanerRuntimeConfiguration(env)?.mode,'retained-pilot-v1');
  assert.equal(cleanerRuntimeConfiguration({...env,HELM_CHANNEX_CLEANER_MODE:'receipts-only',CHANNEX_PRODUCTION_API_KEY:''})?.mode,'receipts-only');
  for(const change of [{VERCEL_ENV:'preview'},{HELM_CHANNEX_CLEANER_MODE:'on'},{HELM_CHANNEX_CLEANER_RECEIPT_KEY:''},{HELM_CHANNEX_CLEANER_KEY_ID:'!'},
    {QUO_API_KEY:''},{CRON_SECRET:''},{CHANNEX_PRODUCTION_API_KEY:''},{HELM_ISOLATED_CALENDAR_ENABLED:'true'},
    {HELM_CHANNEX_CLEANER_MANIFEST:' '.repeat(4097)},{HELM_CHANNEX_CLEANER_MANIFEST:'{}'}])assert.throws(()=>cleanerRuntimeConfiguration({...env,...change}));
});
test('full tick registers two original times, idles, sends one due SMS and tracks delivery',async()=>{
  const f=fixture();const first=await f.tick();assert.equal(first.ok,true);assert.equal(first.stays[0].action,'schedule');assert.equal(f.jobs.size,2);
  assert.equal(f.counts().registrations,2);assert.equal(f.counts().posts,0);
  const idle=await f.tick();assert.equal(idle.ok,true);assert.equal(idle.stays[0].providerReads,0);
  f.time(due);const sent=await f.tick();assert.equal(sent.stays[0].state,'accepted');assert.equal(f.counts().posts,1);
  f.status('delivered');assert.equal((await f.tick()).stays[0].receiptState,'delivered');assert.equal(f.counts().posts,1);
  assert.ok(!JSON.stringify([first,idle,sent]).includes('12025550123'));assert.ok(!JSON.stringify(sent).includes(f.request.bookingId));
});
test('overlapping cleaner ticks have one claim winner and one provider POST',async()=>{
  const f=fixture();await f.tick();f.time(due);const results=await Promise.all([f.tick(),f.tick()]);
  assert.equal(results.filter(r=>r.stays[0].state==='accepted').length,1);assert.equal(f.counts().posts,1);
  await f.tick();assert.equal(f.counts().posts,1);
});
test('lost registration reply is recovered by deterministic job read, not another send',async()=>{
  const f=fixture(),rpc=f.deps.rpc;let lose=true;
  f.deps.rpc=async(n,a)=>{const out=await rpc(n,a);if(lose&&n==='helm_channex_cleaner_register'){lose=false;throw Error('PRIVATE');}return out;};
  assert.equal((await f.tick()).stays[0].state,'uncertain');assert.equal(f.jobs.size,1);
  await f.tick();assert.equal(f.jobs.size,2);assert.equal(f.counts().registrations,2);f.time(due);await f.tick();assert.equal(f.counts().posts,1);
});
test('unknown claim/provider outcome cannot be retried by later ticks',async()=>{
  for(const fail of ['claim','post']){
    const f=fixture();await f.tick();f.time(due);const rpc=f.deps.rpc,fetcher=f.deps.fetcher;
    f.deps.rpc=async(n,a)=>{const out=await rpc(n,a);if(fail==='claim'&&n==='helm_channex_cleaner_claim')throw Error('PRIVATE');return out;};
    f.deps.fetcher=async(u,i)=>{const out=await fetcher(u,i);if(fail==='post'&&i?.method==='POST')throw Error('PRIVATE');return out;};
    assert.equal((await f.tick()).ok,false);await f.tick();await f.tick();assert.equal(f.counts().claims,1);assert.equal(f.counts().posts,fail==='post'?1:0);
  }
});
test('recipient, source, template, route and provider changes stop dispatch',async()=>{
  for(const change of ['recipient','source','template','route','provider','hold']){
    const f=fixture();await f.tick();f.time(due);
    if(change==='recipient')f.enrollment.recipients[0].portal_token='f'.repeat(32);
    if(change==='source')f.enrollment.scopeEnabled=false;
    if(change==='template')f.enrollment.currentRules[0].body+=' changed';
    if(change==='route')f.enrollment.routeGeneration='00000000-0000-4000-8000-000000000009';
    if(change==='provider')f.provider.v2.plannedArrival='20:00';
    if(change==='hold')f.s.ledger[0].status='cancelled';
    assert.equal((await f.tick()).ok,false,change);assert.equal(f.counts().posts,0,change);
  }
});
test('receipt-only survives cancellation and revoked recipient without source credential loading',async()=>{
  const f=fixture();await f.tick();f.time(due);await f.tick();f.enrollment.recipients[0].enabled=false;
  f.deps.credentials=async()=>{throw Error('must not load provider credentials');};
  f.deps.rpc=((rpc)=>async(n,a)=>{assert.ok(!['helm_channex_message_schedule_inputs','helm_channex_cleaner_enrollment_snapshot'].includes(n));return rpc(n,a);})(f.deps.rpc);
  f.status('delivered');const out=await f.tick(true);assert.equal(out.ok,true);assert.equal(out.stays[0].receiptState,'delivered');assert.equal(f.counts().posts,1);
});
test('expired reminder is not resent; later arrival workflow remains dispatchable',async()=>{
  const f=fixture();await f.tick();f.time(Date.parse('2026-11-24T14:01:00Z'));const out=await f.tick();
  assert.equal(out.ok,false);assert.equal(out.stays[0].state,'accepted');assert.equal(f.counts().posts,1);
  assert.equal(f.jobs.get(retainedCleanerSendId(f.request.bookingId,'cleaner_reminder'))?.state,'prepared');
});
test('receipt-only mode continues reporting uncertain attempts and missing private jobs require review',async()=>{
  const f=fixture();await f.tick();f.time(due);const fetcher=f.deps.fetcher;
  f.deps.fetcher=async(u,i)=>{const out=await fetcher(u,i);if(i?.method==='POST')throw Error('Synthetic lost response');return out;};
  await f.tick();assert.equal((await f.tick(true)).ok,false);assert.equal(f.counts().posts,1);
  const orphan=fixture();await orphan.tick();orphan.jobs.clear();
  assert.equal((await orphan.tick()).stays[0].state,'review_required');assert.equal(orphan.counts().posts,0);
});
