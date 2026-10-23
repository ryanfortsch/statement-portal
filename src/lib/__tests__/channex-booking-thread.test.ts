import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAirbnbThreadReader,registerAirbnbThread,discoverAirbnbThreads,type ThreadScope} from '../channex-bookings/thread.ts';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scope={environment:'staging' as const,propertyId:id(1),channelId:id(2),routeGeneration:id(3),bookingId:id(4),canonicalBookingId:id(5),mappingGeneration:1};
const rel=(id:string)=>({data:{id}});
const booking=()=>({id:id(4),type:'booking',attributes:{property_id:id(1),ota_name:'Airbnb'},relationships:{message_thread:rel(id(6))}});
const thread=()=>({id:id(6),type:'message_thread',attributes:{provider:'Airbnb',is_closed:false,title:'PRIVATE'},relationships:{booking:rel(id(4)),property:rel(id(1)),channel:rel(id(2))}});
test('thread discovery verifies both directions and emits identity-only proof',async()=>{
 const urls:string[]=[];
 const read=createAirbnbThreadReader('synthetic',async(url,init)=>{urls.push(String(url));assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');return Response.json({data:urls.length===2?thread():booking()});});
 let calls=0;
 await registerAirbnbThread(scope,read,async(name,args)=>{calls++;assert.equal(name,'helm_airbnb_thread_register');assert.equal(JSON.stringify(args).includes('PRIVATE'),false);return {data:true,error:null};});
 assert.equal(calls,1);assert.deepEqual(urls.map(x=>new URL(x).pathname),['/api/v1/bookings/'+id(4),'/api/v1/message_threads/'+id(6),'/api/v1/bookings/'+id(4)]);
});
test('inquiry, wrong property/channel/provider and closed threads cannot register',async()=>{
 for(const mutate of [(t:ReturnType<typeof thread>)=>{t.relationships.booking=rel(id(9));},(t:ReturnType<typeof thread>)=>{t.relationships.property=rel(id(9));},(t:ReturnType<typeof thread>)=>{t.relationships.channel=rel(id(9));},(t:ReturnType<typeof thread>)=>{t.attributes.provider='BookingCom';},(t:ReturnType<typeof thread>)=>{t.attributes.is_closed=true;}]){
  const bad=thread();mutate(bad);let calls=0;
  const read=createAirbnbThreadReader('synthetic',async()=>Response.json({data:++calls===2?bad:booking()}));
  await assert.rejects(()=>registerAirbnbThread(scope,read,async()=>{throw Error('must not register');}),/ownership/);
 }
});
test('changed forward link, HTTP failure and warnings fail closed',async()=>{
 for(const mode of ['changed','http','warning']){
  let calls=0;const read=createAirbnbThreadReader('synthetic',async()=>{
   calls++;if(mode==='http') return new Response('PRIVATE',{status:403});
   const b=booking();if(calls===3)b.relationships.message_thread=rel(id(9));
   return Response.json({data:calls===2?thread():b,...(mode==='warning'?{meta:{warnings:['PRIVATE']}}:{})});
  });await assert.rejects(()=>read(scope),/^Error: Airbnb conversation ownership could not be verified$/);
 }
});

test('discovery isolates a failed conversation and retries it on a later batch',async()=>{
 const other={...scope,bookingId:id(7),canonicalBookingId:id(8)};let reads=0,fail=true;const saved:string[]=[];
 const read=async(s:ThreadScope)=>{reads++;if(s.bookingId===scope.bookingId&&fail)throw Error('unavailable');return {...s,threadId:id(6),verifiedAt:new Date().toISOString()};};
 const rpc=async(name:string,args:Record<string,unknown>)=>{
  if(name==='helm_airbnb_thread_candidates')return {data:[scope,other].filter(s=>!saved.includes(s.bookingId)),error:null};
  saved.push((args.p_proof as typeof scope).bookingId);return {data:true,error:null};
 };
 const mapping={environment:'staging',propertyId:id(1),generation:1};
 assert.deepEqual(await discoverAirbnbThreads(mapping,read,rpc),{scanned:2,linked:1,blocked:1,canSend:false});
 fail=false;assert.deepEqual(await discoverAirbnbThreads(mapping,read,rpc),{scanned:1,linked:1,blocked:0,canSend:false});
 assert.equal(reads,3);assert.equal(new Set(saved).size,2);
});
test('out-of-scope or duplicate discovery batch makes no provider reads',async()=>{
 let reads=0;const read=async(s:ThreadScope)=>{reads++;return {...s,threadId:id(6),verifiedAt:new Date().toISOString()};};
 for(const data of [[scope,scope],[scope,{...scope,propertyId:id(9)}],null])
  await assert.rejects(()=>discoverAirbnbThreads({environment:'staging',propertyId:id(1),generation:1},read,async()=>({data,error:null})),/discovery incomplete/);
 assert.equal(reads,0);
});
