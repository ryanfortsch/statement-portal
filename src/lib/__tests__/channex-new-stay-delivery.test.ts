import test from 'node:test';
import assert from 'node:assert/strict';
import { newStayDeliveryConfiguration } from '../channex-messaging/new-stay-delivery-config.ts';
import { runNewStayDeliveryTick } from '../channex-messaging/new-stay-delivery-tick.ts';
import { dispatchNewStayGuest, dispatchNewStayCleaner } from '../channex-messaging/new-stay-delivery.ts';
import { readAutomationOperations } from '../channex-messaging/operations.ts';
import { operationsFixture } from './fixtures/channex-automation-operations.ts';
import { intakeId as id } from './fixtures/channex-booking-intake.ts';
import { PRODUCTION_DB_URL } from '../channex-production-runtime.ts';
const reference = { templateCaptureId: id(1), templateDigest: 'a'.repeat(64), cleanerReleaseId: id(2) };
const env = { VERCEL_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: PRODUCTION_DB_URL, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service',
 CRON_SECRET: 'synthetic-cron', CHANNEX_PRODUCTION_API_KEY: 'synthetic-channex', HELM_CHANNEX_CLEANER_RECEIPT_KEY: 'b'.repeat(64),
 HELM_CHANNEX_CLEANER_KEY_ID: 'synthetic-v1', HELM_CHANNEX_NEW_GUEST_MODE: 'calderwood-v1',
 HELM_CHANNEX_NEW_CLEANER_MODE: 'calderwood-v1', QUO_API_KEY: 'synthetic-quo',
 HELM_CHANNEX_NEW_STAY_SCHEDULE_REFERENCE: JSON.stringify(reference) };
const forbidden = async (): Promise<never> => { throw Error('unexpected IO'); };
const empty = { state: 'ready', jobs: [] };
test('both new senders are default-off with zero IO, independent of scheduling activation', async () => {
 for (const a of ['guest','cleaner'] as const) for (const mode of [undefined,'','off']) {
  const e = { ...env, HELM_CHANNEX_NEW_GUEST_MODE: mode, HELM_CHANNEX_NEW_CLEANER_MODE: mode };
  assert.equal(newStayDeliveryConfiguration(a,e),null);
  assert.equal((await runNewStayDeliveryTick(a,e,{rpc:forbidden})).state,'disabled');
 }
 for(const send of [dispatchNewStayGuest,dispatchNewStayCleaner])
  assert.deepEqual(await send({}, {rpc:forbidden,channexKey:forbidden,sms:forbidden}),{state:'disabled',providerReads:0,providerPosts:0});
});
test('audience activation is production-only with a strict reviewed reference', () => {
 for(const a of ['guest','cleaner'] as const) {
  assert.deepEqual(newStayDeliveryConfiguration(a,env)?.reference,reference);
  for(const patch of [{VERCEL_ENV:'preview'},{NEXT_PUBLIC_SUPABASE_URL:'https://staging.invalid'},
   {SUPABASE_SERVICE_ROLE_KEY:''},{CRON_SECRET:''},{CHANNEX_PRODUCTION_API_KEY:''},
   {HELM_ISOLATED_CALENDAR_ENABLED:'true'},{CHANNEX_WORKER_MODE:'isolated-staging'},
   {HELM_CHANNEX_NEW_STAY_SCHEDULE_REFERENCE:'{}'},
   {HELM_CHANNEX_NEW_STAY_SCHEDULE_REFERENCE:JSON.stringify({...reference,bookingId:id(3)})}])
   assert.throws(()=>newStayDeliveryConfiguration(a,{...env,...patch}));
 }
 assert.throws(()=>newStayDeliveryConfiguration('cleaner',{...env,QUO_API_KEY:''}));
 assert.throws(()=>newStayDeliveryConfiguration('cleaner',{...env,HELM_CHANNEX_CLEANER_RECEIPT_KEY:''}));
 assert.ok(newStayDeliveryConfiguration('guest',{...env,QUO_API_KEY:undefined,HELM_CHANNEX_CLEANER_RECEIPT_KEY:undefined}));
});
test('receipt-only recovery has no dependency on enrollment reference or competing sender credentials', async () => {
 const e = {...env, HELM_CHANNEX_NEW_GUEST_MODE:'receipts-only',HELM_CHANNEX_NEW_CLEANER_MODE:'receipts-only',
  HELM_CHANNEX_NEW_STAY_SCHEDULE_REFERENCE:undefined, CHANNEX_PRODUCTION_API_KEY:undefined};
 assert.ok(newStayDeliveryConfiguration('cleaner',e));
 assert.throws(()=>newStayDeliveryConfiguration('guest',e));
 let reads=0;
 const r=await runNewStayDeliveryTick('cleaner',e,{rpc:async(name)=>{
  reads++; assert.equal(name,'helm_channex_new_stay_delivery_worklist');
  return {data:{dispatch:{state:'overflow',jobs:[]},receipts:empty},error:null};
 },fetcher:forbidden});
 assert.equal(reads,1);assert.equal(r.ok,true);assert.deepEqual(r.dispatch,[]);
});
test('untrusted worklists cannot expand or duplicate the bounded jobs',async()=>{
 const job={bookingId:id(3),sendId:id(4)};
 for(const data of [{dispatch:{state:'ready',jobs:Array(5).fill(job)},receipts:empty},
  {dispatch:{state:'ready',jobs:[job,job]},receipts:empty},
  {dispatch:{state:'ready',jobs:[job]},receipts:{state:'ready',jobs:[job]}},
  {dispatch:{state:'overflow',jobs:[job]},receipts:empty},
  {dispatch:empty,receipts:empty,secret:'private'}])
  await assert.rejects(runNewStayDeliveryTick('guest',env,{rpc:async()=>({data,error:null}),fetcher:forbidden}));
});
test('failed dispatch reads leave receipt reads running and output contains only states and counts',async()=>{
 const calls:string[]=[];
 const out=await runNewStayDeliveryTick('guest',env,{rpc:async(name,args)=>{
  calls.push(name+':'+(args.p_send_id??''));
  if(name.endsWith('worklist'))return{data:{dispatch:{state:'ready',jobs:[{bookingId:id(3),sendId:id(4)}]},
   receipts:{state:'ready',jobs:[{bookingId:id(5),sendId:id(6)}]}},error:null};
  throw Error('PRIVATE');
 },fetcher:forbidden});
 assert.equal(out.ok,false);assert.equal(calls.length,3);
 assert.ok(calls.some(s=>s.endsWith(id(6))));
 for(const value of ['PRIVATE',id(3),id(4),id(5),id(6)])assert.ok(!JSON.stringify(out).includes(value));
});
test('owner sender status combines retained and new modes without exposing configuration',async()=>{
 for(const mode of ['off','calderwood-v1','receipts-only','typo']){
  const f=operationsFixture();const r=await readAutomationOperations({...env,HELM_CHANNEX_NEW_GUEST_MODE:mode,HELM_CHANNEX_NEW_CLEANER_MODE:mode},f.deps);
  const expected=mode==='off'?'off':mode==='calderwood-v1'?'configured':mode==='receipts-only'?'receipts_only':'invalid';
  assert.equal(r.guest.state,expected);assert.equal(r.cleaner.state,expected);assert.equal(r.guest.stays,null);
  assert.ok(!JSON.stringify(r).includes(reference.templateDigest));
 }
});
