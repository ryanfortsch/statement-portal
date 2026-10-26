import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStagingProviderRunner } from '../channex-bookings/staging-runner.ts';
import { CALDERWOOD_STAGING as m } from '../calderwood-readonly/channex.ts';
const env = { CHANNEX_AIRBNB_REHEARSAL_ENABLED:'true', CHANNEX_WORKER_MODE:'isolated-staging',
 CHANNEX_STAGING_DB_URL:'https://jgkblfozftcvymvwhhii.supabase.co',
 CHANNEX_STAGING_DB_PROJECT_REF:'jgkblfozftcvymvwhhii', CHANNEX_AIRBNB_MAPPING_GENERATION:'1',
 CHANNEX_AIRBNB_ACK_ENABLED:'true', CHANNEX_STAGING_API_KEY:'test-provider',CHANNEX_STAGING_DB_SERVICE_KEY:'test-storage' };
test('provider rehearsal is default-off and refuses unsafe or incomplete configuration before network',()=>{
 let calls=0;const fetcher:typeof fetch=async()=>{calls++;throw Error();};
 assert.equal(createStagingProviderRunner({},fetcher),null);
 for(const override of [{VERCEL_ENV:'preview'},{CHANNEX_WORKER_MODE:'production'},
  {CHANNEX_STAGING_DB_URL:'https://other.supabase.co'},{CHANNEX_STAGING_DB_PROJECT_REF:'other'},
  {CHANNEX_CANONICAL_POLLING_ENABLED:'true'},{CHANNEX_AIRBNB_ACK_ENABLED:'false'},
  {CHANNEX_AIRBNB_MAPPING_GENERATION:'1.5'},{CHANNEX_AIRBNB_MAPPING_GENERATION:'0'},
  {CHANNEX_STAGING_API_KEY:''},{CHANNEX_STAGING_DB_SERVICE_KEY:''}])
  assert.throws(()=>createStagingProviderRunner({...env,...override},fetcher));
 assert.equal(calls,0);
});
test('empty provider rehearsal binds staging resources and performs only recovery and provider reads',async()=>{
 const paths:string[]=[];
 const fetcher:typeof fetch=async(url,init)=>{
  const u=new URL(String(url));paths.push(u.pathname);
  assert.equal(init?.redirect,'error');assert.equal(init?.cache,'no-store');assert.ok(init?.signal);
  if(u.origin===env.CHANNEX_STAGING_DB_URL){
   assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer test-storage');
   if(u.pathname.endsWith('thread_candidates'))return Response.json([]);
   assert.ok(u.pathname.endsWith('messages_tick'));
   return Response.json({scanned:0,prepared:0,refreshed:0,blocked:0,canSend:false});
  }
  assert.equal(u.origin,'https://staging.channex.io');assert.equal(init?.method,'GET');
  const relationship=(id:string)=>({data:{id}});
  if(u.pathname.endsWith('/properties/'+m.propertyId))return Response.json({data:{id:m.propertyId}});
  if(u.pathname.endsWith('/room_types/'+m.roomTypeId))return Response.json({data:{id:m.roomTypeId,relationships:{property:relationship(m.propertyId)}}});
  if(u.pathname.endsWith('/rate_plans/'+m.ratePlanId))return Response.json({data:{id:m.ratePlanId,relationships:{property:relationship(m.propertyId),room_type:relationship(m.roomTypeId)}}});
  assert.equal(u.pathname,'/api/v1/booking_revisions/feed');
  return Response.json({data:[],meta:{page:1,total:0,limit:100}});
 };
 const run=createStagingProviderRunner(env,fetcher)!;
 // Configuration is captured: later caller mutation cannot retarget a run.
 const result=await run(new AbortController().signal);
 assert.equal(result.canSend,false);assert.equal(result.ingestion.received,0);
 assert.equal(paths.filter(p=>p.endsWith('messages_tick')).length,2);
 assert.equal(paths.filter(p=>p.endsWith('thread_candidates')).length,2);
 assert.ok(!paths.some(p=>p.endsWith('/ack')));
});
test('aborted and failed staging reads reveal no credential or raw provider error',async()=>{
 let calls=0;
 const run=createStagingProviderRunner(env,async()=>{calls++;throw Error('PRIVATE');})!;
 const controller=new AbortController();controller.abort();
 await assert.rejects(run(controller.signal),e=>e instanceof Error&&!e.message.includes('PRIVATE'));
 assert.equal(calls,0);
 await assert.rejects(run(new AbortController().signal),e=>e instanceof Error&&!e.message.includes('PRIVATE'));
 assert.equal(calls,1);
});
