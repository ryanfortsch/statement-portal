import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectProductionRuntime, ChannexRuntimeError, PRODUCTION_DB_URL } from '../channex-production-runtime.ts';
import { CALDERWOOD_PRODUCTION as m } from '../channex-production-preflight.ts';
const env = { VERCEL_ENV: 'production', CHANNEX_PRODUCTION_MODE: 'inspect',
  NEXT_PUBLIC_SUPABASE_URL: PRODUCTION_DB_URL, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-db',
  CHANNEX_PRODUCTION_API_KEY: 'synthetic-provider' };
function harness() {
  const storage = {propertyId:m.helmPropertyId,environment:'production',remotePropertyId:m.propertyId,
    roomTypeId:m.roomTypeId,ratePlanId:m.ratePlanId,generation:1,importEnabled:false,captureEnabled:false,
    calendarAuthority:'guesty',receipts:0,inventoryEvents:0};
  const inventory = { format: 1, planningEnabled: false, publishingEnabled: false, headVersion: 0, plans: 0, coverageSources: 0, maxDays: 500 };
  const delivery = { format: 1, enabled: false, attempts: 0, unresolved: 0, settlementEnabled: false };
  const calls: { name: string; args: Record<string,unknown> }[] = [];
  const urls: string[] = [];
  const relation = (id: string) => ({data:{id}});
  const rows = [
    {data:{id:m.propertyId,attributes:{title:m.propertyTitle,currency:'USD',timezone:'America/New_York',property_type:'holiday_home'}}},
    {data:{id:m.roomTypeId,attributes:{title:m.roomTitle,count_of_rooms:1,occ_adults:6,occ_children:0,occ_infants:0},relationships:{property:relation(m.propertyId)}}},
    {data:{id:m.ratePlanId,attributes:{title:m.rateTitle,currency:'USD',sell_mode:'per_room',rate_mode:'manual',stop_sell:Array(7).fill(true)},relationships:{property:relation(m.propertyId),room_type:relation(m.roomTypeId)}}},
    {data:[],meta:{total:0,page:1}},
  ];
  const rpc = async(name:string,args:Record<string,unknown>) => {
    calls.push({name,args});return {data:name==='helm_channex_storage_status'?storage:name==='helm_channex_inventory_status'?inventory:name==='helm_channex_delivery_status'?delivery:true,error:null};
  };
  const fetcher:typeof fetch = async(url,init) => {
    assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');
    urls.push(String(url));return Response.json(rows[urls.length-1]);
  };
  return {storage,inventory,delivery,calls,urls,rpc,fetcher};
}
test('explicit inspection off mode performs no checks and makes no active-worker health claim',async()=>{
 const h=harness();const r=await inspectProductionRuntime({...env,CHANNEX_PRODUCTION_MODE:'off'},h.rpc,h.fetcher);
 assert.deepEqual(r,{ok:true,mode:'inspect',state:'disabled',readyForCutover:false});
 assert.deepEqual(h.calls,[]);assert.deepEqual(h.urls,[]);
});
test('production runtime proves provider access and dormant storage, persists only bounded health',async()=>{
 const h=harness();const r=await inspectProductionRuntime(env,h.rpc,h.fetcher);
 assert.equal(r.storageVerified,true);assert.equal(r.readyForCutover,false);assert.equal(r.bookingsChanged,0);
 assert.equal(r.providerWrites,0);assert.equal(r.messagesSent,0);assert.equal(h.urls.length,4);
 assert.equal(h.urls.some(u=>u.includes('booking_revisions')),false);
 assert.deepEqual(h.calls,[{name:'helm_channex_storage_status',args:{}},
  {name:'helm_channex_inventory_status',args:{}},
  {name:'helm_channex_delivery_status',args:{}},
  {name:'helm_channex_runtime_checkpoint',args:{p_ok:true,p_code:'OK'}}]);
 assert.equal(JSON.stringify(r).includes('synthetic-'),false);
});

test('delivery attempts or unexpected enablement block inspection before provider IO',async()=>{
 for(const patch of [{enabled:true},{attempts:1},{unresolved:1},{settlementEnabled:true}]){
  const h=harness();Object.assign(h.delivery,patch);
  await assert.rejects(inspectProductionRuntime(env,h.rpc,h.fetcher),e=>e instanceof ChannexRuntimeError&&e.code==='STORAGE_NOT_READY');
  assert.equal(h.urls.length,0);assert.equal(h.calls.some(c=>c.name==='helm_channex_delivery_claim'),false);
 }
});
test('preview, wrong database, staging modes and missing credentials never read or write',async()=>{
 for(const patch of [{VERCEL_ENV:'preview'},{VERCEL_ENV:undefined},{CHANNEX_PRODUCTION_MODE:'consume'},
  {CHANNEX_PRODUCTION_MODE:undefined},{NEXT_PUBLIC_SUPABASE_URL:'https://staging.invalid'},
  {HELM_ISOLATED_CALENDAR_ENABLED:'true'},{CHANNEX_WORKER_MODE:'isolated-staging'},
  {SUPABASE_SERVICE_ROLE_KEY:''},{CHANNEX_PRODUCTION_API_KEY:''}]){
  const h=harness();await assert.rejects(inspectProductionRuntime({...env,...patch},h.rpc,h.fetcher),
   e=>e instanceof ChannexRuntimeError && e.code==='CONFIGURATION_REQUIRED');
  assert.equal(h.calls.length,0);assert.equal(h.urls.length,0);
 }
});
test('unexpected mapping, activation, authority or stored rows block provider reads',async()=>{
 for(const patch of [{generation:2},{propertyId:'other'},{remotePropertyId:'other'},
  {importEnabled:true},{captureEnabled:true},{calendarAuthority:'helm'},{receipts:1},{inventoryEvents:1}]){
  const h=harness();Object.assign(h.storage,patch);
  await assert.rejects(inspectProductionRuntime(env,h.rpc,h.fetcher),e=>e instanceof ChannexRuntimeError&&e.code==='STORAGE_NOT_READY');
  assert.equal(h.urls.length,0);assert.deepEqual(h.calls.at(-1)?.args,{p_ok:false,p_code:'STORAGE_NOT_READY'});
 }
});
test('provider failure records sanitized failure and never reports success',async()=>{
 const h=harness();await assert.rejects(inspectProductionRuntime(env,h.rpc,async()=>{throw Error('PRIVATE_SENTINEL');}),
 e=>e instanceof ChannexRuntimeError&&e.code==='PROVIDER_UNAVAILABLE'&&!String(e).includes('PRIVATE_SENTINEL'));
 assert.deepEqual(h.calls.at(-1)?.args,{p_ok:false,p_code:'PROVIDER_UNAVAILABLE'});
});
test('missing migration, bad status payload, and failed health storage are explicit failures',async()=>{
 for(const rpc of [async()=>({data:null,error:{message:'PRIVATE_SENTINEL'}}),async()=>({data:{},error:null})]){
  await assert.rejects(inspectProductionRuntime(env,rpc),e=>e instanceof ChannexRuntimeError&&!String(e).includes('PRIVATE_SENTINEL'));
 }
 const h=harness();await assert.rejects(inspectProductionRuntime(env,async(name,args)=>name==='helm_channex_runtime_checkpoint'
  ?{data:false,error:null}:h.rpc(name,args),h.fetcher),e=>e instanceof ChannexRuntimeError&&e.code==='CHECKPOINT_FAILED');
});

test('availability storage is checked without reading bookings or creating plans',async()=>{
 for(const patch of [{planningEnabled:true},{publishingEnabled:true},{plans:1},{headVersion:1},{coverageSources:1},{maxDays:366}]){
  const h=harness();Object.assign(h.inventory,patch);
  await assert.rejects(inspectProductionRuntime(env,h.rpc,h.fetcher),e=>e instanceof ChannexRuntimeError&&e.code==='STORAGE_NOT_READY');
  assert.equal(h.urls.length,0);assert.equal(h.calls.some(c=>c.name==='helm_channex_inventory_read'),false);
 }
});
