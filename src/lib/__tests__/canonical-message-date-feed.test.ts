import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALDERWOOD_STAGING as mapping } from '../calderwood-readonly/channex.ts';
import { runMappedCanonicalRevisions, messageDateRefreshSchema } from '../channex-staging/canonical-revision-mapped.ts';
import { parseCanonicalRevision } from '../channex-staging/canonical-revisions.ts';
import { createCanonicalRevisionPageRunner, runCanonicalRevisionScheduler } from '../channex-staging/canonical-revision-scheduler.ts';
const url='https://jgkblfozftcvymvwhhii.supabase.co';
const route={...mapping,environment:'staging',helmProperty:'HELMTEST-calderwood',connection:'fixture',generation:1,
  propertyTitle:'65 Calderwood - Isolated Staging',ratePlanTitle:'TEST ONLY - Calderwood - CLOSED - $100 placeholder',adults:6,children:0,infants:0,reviewedAt:'2026-10-22T14:00:00Z'};
const revision=parseCanonicalRevision({...mapping,id:'11111111-1111-4111-8111-111111111111',bookingId:'22222222-2222-4222-8222-222222222222',
  code:'HELMTEST-dates',status:'modified',checkIn:'2027-02-01',checkOut:'2027-02-04',receivedAt:'2026-10-22T14:00:00Z'});
const result={scanned:1,refreshed:1,unchanged:0,blocked:0,inactive:0,canSend:false};
const input={url,storageKey:'fixture',providerKey:'fixture'};
function fixture(options:{rows?:boolean;timing?:unknown;failReceipt?:boolean;failTiming?:boolean}={}) {
  const calls:string[]=[];
  const raw={id:revision.id,attributes:{booking_id:revision.bookingId,property_id:mapping.propertyId,ota_name:'Offline',ota_reservation_code:revision.code,
    status:revision.status,arrival_date:revision.checkIn,departure_date:revision.checkOut,inserted_at:revision.receivedAt,
    rooms:[{room_type_id:mapping.roomTypeId,rate_plan_id:mapping.ratePlanId}]}};
  const receipt={revision,canonicalBookingId:'33333333-3333-4333-8333-333333333333',outcome:'applied',committed:true};
  const fetcher:typeof fetch=async(input,init)=>{
    const u=new URL(String(input));calls.push(u.pathname);
    if(u.origin===url){
      const name=u.pathname.split('/').at(-1);
      if(name==='helm_pilot_revision_route')return Response.json(route);
      const args=JSON.parse(String(init?.body));assert.equal(args.p_connection,route.connection);assert.equal(args.p_generation,route.generation);
      if(name==='helm_pilot_message_times_refresh'){
        assert.deepEqual(args,{p_connection:route.connection,p_generation:route.generation,p_limit:100});
        if(options.failTiming)throw Error('HELMTEST private transport details');
        return Response.json(options.timing===undefined?result:options.timing);
      }
      assert.ok(['helm_pilot_revision_observe_mapped','helm_pilot_revision_receipt_mapped'].includes(name!));
      if(name==='helm_pilot_revision_receipt_mapped'&&options.failReceipt)return Response.json({message:'HELMTEST'},{status:400});
      return Response.json(receipt);
    }
    assert.equal(u.origin,'https://staging.channex.io');const rel=(id:string)=>({data:{id}});
    if(u.pathname.endsWith('/ack')){assert.equal(init?.method,'POST');return Response.json({meta:{message:'Success'}});}
    assert.equal(init?.method,'GET');
    if(u.pathname.includes('/booking_revisions/'))return u.pathname.endsWith('/feed')?
      Response.json({data:options.rows?[raw]:[],meta:{page:1,total:options.rows?1:0,limit:100}}):Response.json({data:raw});
    if(u.pathname.includes('/properties/'))return Response.json({data:{id:mapping.propertyId,attributes:{title:route.propertyTitle,currency:'USD',timezone:'America/New_York'}}});
    if(u.pathname.includes('/room_types/'))return Response.json({data:{id:mapping.roomTypeId,attributes:{count_of_rooms:1,occ_adults:6,occ_children:0,occ_infants:0},relationships:{property:rel(mapping.propertyId)}}});
    if(u.pathname.includes('/rate_plans/'))return Response.json({data:{id:mapping.ratePlanId,attributes:{title:route.ratePlanTitle,currency:'USD',sell_mode:'per_room',stop_sell:Array(7).fill(true)},relationships:{property:rel(mapping.propertyId),room_type:rel(mapping.roomTypeId)}}});
    if(u.pathname.endsWith('/channels'))return Response.json({data:[],meta:{total:0,page:1,limit:100}});
    assert.ok(u.pathname.endsWith('/availability')||u.pathname.endsWith('/restrictions'));return Response.json({data:{}});
  };
  return {fetcher,calls};
}
test('existing revision processing remains unchanged when automatic timing is off',async()=>{
  const f=fixture({rows:true});const page=await runMappedCanonicalRevisions(input,f.fetcher);
  assert.equal(page.acknowledged,1);assert.equal('timing' in page,false);
  assert.equal(f.calls.some(p=>p.includes('message_times')),false);
});
test('automatic date refresh follows the durable receipt and ACK, including signed specific-revision delivery',async()=>{
  const f=fixture({rows:true});const page=await runMappedCanonicalRevisions({...input,revisionId:revision.id,bookingId:revision.bookingId,refreshMessageDates:true},f.fetcher);
  assert.deepEqual('timing' in page&&page.timing,result);
  const ack=f.calls.findIndex(p=>p.endsWith('/ack')),refresh=f.calls.findIndex(p=>p.endsWith('/helm_pilot_message_times_refresh'));
  assert.ok(ack>f.calls.findIndex(p=>p.endsWith('/helm_pilot_revision_receipt_mapped')));assert.ok(refresh>ack);
});
test('empty backup polling refreshes durable timing after an event was already ACKed',async()=>{
  const f=fixture();const run=createCanonicalRevisionPageRunner({CHANNEX_CANONICAL_POLLING_ENABLED:'true',CHANNEX_WORKER_MODE:'isolated-staging',
    CHANNEX_STAGING_DB_PROJECT_REF:'jgkblfozftcvymvwhhii',CHANNEX_STAGING_DB_URL:url,CHANNEX_STAGING_API_KEY:'fixture',CHANNEX_STAGING_DB_SERVICE_KEY:'fixture',
    CHANNEX_CANONICAL_MESSAGE_TIMING_ENABLED:'true'},f.fetcher);
  const page=await run(new AbortController().signal);assert.equal(page.received,0);assert.deepEqual('timing' in page&&page.timing,result);
  assert.equal(f.calls.some(p=>p.endsWith('/ack')),false);
});
test('unverified canonical receipt prevents both ACK and timing refresh',async()=>{
  const f=fixture({rows:true,failReceipt:true});await assert.rejects(runMappedCanonicalRevisions({...input,refreshMessageDates:true},f.fetcher));
  assert.equal(f.calls.some(p=>p.endsWith('/ack')||p.includes('message_times')),false);
});
test('lost refresh and malformed results report uncertainty without replaying a booking within the request',async()=>{
  for(const options of [{failTiming:true},{timing:null},{timing:{...result,refreshed:0}},{timing:{...result,canSend:true}},{timing:{...result,private:'HELMTEST'}}]){
    const f=fixture({rows:true,...options});await assert.rejects(runMappedCanonicalRevisions({...input,refreshMessageDates:true},f.fetcher),/Message date refresh unconfirmed; canonical receipts retained/);
    assert.equal(f.calls.filter(p=>p.endsWith('/ack')).length,1);assert.equal(f.calls.filter(p=>p.endsWith('/helm_pilot_message_times_refresh')).length,1);
  }
});
test('counts reject missing, excessive, fractional and inconsistent results',()=>{
  for(const raw of [{...result,scanned:101},{...result,blocked:-1},{...result,refreshed:0.5},{...result,scanned:0},{...result,unchanged:undefined}])assert.throws(()=>messageDateRefreshSchema.parse(raw));
});
test('scheduler emits only aggregate date-feed outcomes and uses the existing retry path',async()=>{
  const logs:unknown[]=[];
  await runCanonicalRevisionScheduler({once:true,signal:new AbortController().signal,now:()=>0,log:e=>logs.push(e),
    drainPage:async()=>({received:0,applied:0,stale:0,acknowledged:0,completeCoverage:false,canSend:false,timing:{...result,refreshed:0,blocked:1}})});
  assert.deepEqual((logs[0] as {timing:unknown}).timing,{...result,refreshed:0,blocked:1});
});
