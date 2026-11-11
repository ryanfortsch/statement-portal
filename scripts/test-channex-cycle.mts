/** Real planner, worker, service RPC adapters and transport; synthetic DB only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { runInventoryCycle } from '../src/lib/channex-inventory/cycle.ts';
import { createInventoryPlanningStore } from '../src/lib/channex-inventory/store.ts';
import { createInventoryDeliveryStore } from '../src/lib/channex-inventory/delivery-store.ts';
import { createUnmappedInventoryTransport } from '../src/lib/channex-inventory/delivery.ts';
import { readInventoryOperations } from '../src/lib/channex-inventory/operations.ts';
import { CALDERWOOD_PRODUCTION as m } from '../src/lib/channex-production-preflight.ts';
import { PRODUCTION_DB_URL } from '../src/lib/channex-production-runtime.ts';
if(process.env.PGHOST!=='127.0.0.1'||process.env.PGDATABASE!=='helm_synthetic_channex')throw Error('Synthetic loopback database required');
function sql(query:string){const r=spawnSync(process.env.CHANNEX_TEST_PSQL||'psql',['-X','-Atq','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8'});if(r.status)throw Error(r.stderr);return r.stdout.trim();}
const literal=(v:string)=>"'"+v.replaceAll("'","''")+"'";
const json=(v:unknown)=>literal(JSON.stringify(v))+'::jsonb';
assert.equal(sql('select current_database();'),'helm_synthetic_channex');
sql("select channex_synthetic_inventory_setup(); update helm_airbnb_bookings.delivery_scope set enabled=true,next_attempt_at='-infinity';");
let loseSelection=false,loseReceipt=false,timeout=false,reads=0,sends=0;
const rpcFetch:typeof fetch=async(url,init)=>{
  assert.ok(String(url).startsWith(PRODUCTION_DB_URL+'/rest/v1/rpc/'));
  const name=String(url).split('/').at(-1),p=JSON.parse(String(init?.body));
  const args=name==='helm_channex_inventory_read'?'':name==='helm_channex_inventory_plan_commit'?`${json(p.p_expected)},${json(p.p_plan)}`:
    name==='helm_channex_delivery_cycle_claim'||name==='helm_channex_delivery_claim'?`${literal(p.p_token)}::uuid`:
    name==='helm_channex_delivery_begin'?`${literal(p.p_token)}::uuid,${literal(p.p_digest)}`:
    name==='helm_channex_delivery_record'?`${literal(p.p_token)}::uuid,${literal(p.p_digest)},${json(p.p_outcome)}`:null;
  assert.notEqual(args,null);
  const result=JSON.parse(sql(`set role service_role; select to_jsonb(public.${name}(${args}));`));
  if(name==='helm_channex_delivery_cycle_claim'&&loseSelection){loseSelection=false;throw Error('lost selection response');}
  if(name==='helm_channex_delivery_record'&&loseReceipt){loseReceipt=false;throw Error('lost receipt response');}
  return Response.json(result);
};
const relation = (id: string) => ({ data: { id } });
const fixtures = [
 { data: { id:m.propertyId, attributes:{title:m.propertyTitle,currency:'USD',timezone:'America/New_York',property_type:'holiday_home'} } },
 { data: { id:m.roomTypeId, attributes:{title:m.roomTitle,count_of_rooms:1,occ_adults:6,occ_children:0,occ_infants:0},
   relationships:{property:relation(m.propertyId)} } },
 { data: { id:m.ratePlanId, attributes:{title:m.rateTitle,currency:'USD',sell_mode:'per_room',rate_mode:'manual',stop_sell:Array(7).fill(true)},
   relationships:{property:relation(m.propertyId),room_type:relation(m.roomTypeId)} } },
 { data:[],meta:{total:0,page:1} }
];
const provider:typeof fetch=async(_url,init)=>{
  if(init?.method==='GET')return Response.json(fixtures[reads++%4]);
  sends++;assert.equal(init?.body,sql("select request_body from helm_airbnb_bookings.delivery_attempts where state='submitting' and superseded_by is null;"));
  if(timeout){timeout=false;throw Error('synthetic timeout');}
  return Response.json({data:[{id:randomUUID(),type:'task'}],meta:{message:'Success',warnings:[]}});
};
const planning=createInventoryPlanningStore(PRODUCTION_DB_URL,'synthetic',rpcFetch);
const delivery=createInventoryDeliveryStore(PRODUCTION_DB_URL,'synthetic',rpcFetch);
const transport=createUnmappedInventoryTransport('synthetic',provider);
const run=()=>runInventoryCycle(planning,delivery,transport,randomUUID());
try{
  loseSelection=true;await assert.rejects(run(),/checkpoint uncertain/);assert.equal(sends,0);assert.equal(reads,0);
  const firstToken=sql('select token from helm_airbnb_bookings.delivery_attempts;');
  loseReceipt=true;await assert.rejects(run(),/checkpoint uncertain/);assert.equal(sends,1);
  assert.equal(sql('select token from helm_airbnb_bookings.delivery_attempts;'),firstToken);
  assert.equal((await run()).status,'already-accepted');assert.equal(sends,1);
  const date=sql("select day->>'date' from jsonb_array_elements((select days from helm_airbnb_bookings.inventory_plans order by version desc limit 1)) day where day->>'available'='1' limit 1;");
  assert.match(date,/^\d{4}-\d{2}-\d{2}$/);
  sql(`insert into property_rate_days(property_id,date,closed) values('65_calderwood',${literal(date)},true) on conflict(property_id,date) do update set closed=true;
    update helm_airbnb_bookings.delivery_scope set next_attempt_at='-infinity';`);
  timeout=true;assert.equal((await run()).status,'uncertain');assert.equal(sends,2);
  assert.equal((await run()).status,'blocked');assert.equal(sends,2);
  const oldBytes=sql("select request_body from helm_airbnb_bookings.delivery_attempts where state='uncertain' and superseded_by is null;");
  sql(`update property_rate_days set closed=false where property_id='65_calderwood' and date=${literal(date)};
    update helm_airbnb_bookings.delivery_attempts set expires_at=0,started_at=clock_timestamp()-interval '2 minutes' where state='uncertain';
    update helm_airbnb_bookings.delivery_scope set next_attempt_at='-infinity';`);
  loseSelection=true;await assert.rejects(run(),/checkpoint uncertain/);assert.equal(sends,2);
  assert.equal((await run()).status,'accepted');assert.equal(sends,3);
  const report=await readInventoryOperations(async(name)=>({data:JSON.parse(sql(`set role service_role; select public.${name}();`)),error:null}));
  assert.equal(report.counts.historicalUnknown,1);assert.equal(report.active,null);assert.equal(report.counts.accepted,2);
  assert.notEqual(sql("select request_body from helm_airbnb_bookings.delivery_attempts where superseded_by is null order by created_at desc limit 1;"),oldBytes);
  assert.equal((await run()).status,'already-accepted');assert.equal(sends,3);assert.equal(reads,12);
}finally{sql("delete from helm_airbnb_bookings.delivery_attempts; update helm_airbnb_bookings.delivery_scope set enabled=false,next_attempt_at='-infinity',consecutive_recoveries=0;");}
console.log('PASS: complete worker cycle resumes lost selections, recovers latest state and deduplicates lost receipts without duplicate IO');
