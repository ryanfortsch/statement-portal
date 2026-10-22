// New local PostgreSQL cluster only, called by the concurrency harness.
// Exercises real signed handler, polling runner, provider adapter and service RPCs.
// Every provider response is simulated; only fictional Offline stays are used.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CALDERWOOD_STAGING as mapping } from '../src/lib/calderwood-readonly/channex.ts';
import { runMappedCanonicalRevisions } from '../src/lib/channex-staging/canonical-revision-mapped.ts';
import { createCanonicalRevisionPageRunner } from '../src/lib/channex-staging/canonical-revision-scheduler.ts';
import { handleCanonicalRevisionWebhook } from '../src/lib/channex-staging/canonical-revision-webhook.ts';
export async function verifyCanonicalRevisionRouting(db,check,race) {
 const p='HELMTEST-calderwood',url='https://jgkblfozftcvymvwhhii.supabase.co';
 const query=(sql,args=[])=>db.query(sql,args);
 const sql=readFileSync(new URL('../docs/guesty-exit/staging-storage/canonical-revision-routing.sql',import.meta.url),'utf8');
 await db.exec(sql);
 await query('update helm_channex_revisions.scope set enabled=true');
 const c=(await query('select configuration from helm_booking_inventory_consumers where property_id=$1',[p])).rows[0].configuration;
 assert.equal(c.listing,mapping.roomTypeId);assert.equal(c.publishEnabled,false);
 const binding=[c.connection,c.generation];
 const readRoute=async()=> (await query('select helm_pilot_revision_route() r')).rows[0].r;
 await check('routed import: absent review blocks even the legacy pilot before provider IO',async()=>{
   await assert.rejects(readRoute,/reviewed_revision_route_required/);
 });
 await query(`insert into helm_staging_inventory_routes(property_id,connection,generation,provider_property_id,room_type_id,rate_plan_id,
   property_title,rate_plan_title,adults,children,infants) values($1,$2,$3,$4,$5,$6,'65 Calderwood - Isolated Staging',
   'TEST ONLY - Calderwood - CLOSED - $100 placeholder',6,0,0)`,[p,...binding,mapping.propertyId,mapping.roomTypeId,mapping.ratePlanId]);
 const make=(n,fields={})=>({id:'78eac239-8faa-40d0-882a-'+String(n).padStart(12,'0'),bookingId:'78eac239-8faa-40d0-882b-000000000001',
   ...mapping,code:'HELMTEST-route-import',status:'new',checkIn:'2027-08-01',checkOut:'2027-08-04',
   receivedAt:'2026-10-22T15:00:'+String(n).padStart(2,'0')+'.000001Z',...fields});
 const raw=r=>({id:r.id,attributes:{booking_id:r.bookingId,property_id:r.propertyId,ota_name:'Offline',ota_reservation_code:r.code,
   status:r.status,arrival_date:r.checkIn,departure_date:r.checkOut,inserted_at:r.receivedAt,
   rooms:[{room_type_id:r.roomTypeId,rate_plan_id:r.ratePlanId}],customer:{name:'MUST NOT RETAIN'},amount:'MUST NOT RETAIN'}});
 const observe=(r,conn=binding[0],gen=binding[1])=>query('select helm_pilot_revision_observe_mapped($1,$2,$3) r',[r,conn,gen]);
 const readReceipt=id=>query('select helm_pilot_revision_receipt_mapped($1,$2,$3) r',[id,...binding]);
 const counts=async()=> (await query(`select (select count(*) from bookings where property_id=$1)::int bookings,
   (select count(*) from helm_channex_revisions.receipts)::int receipts,
   (select count(*) from booking_events where booking_id in(select id from bookings where property_id=$1))::int audit,
   (select version::int from helm_inventory_capture_scopes where property_id=$1) capture`,[p])).rows[0];
 let revision=make(1),acks=0,providerCalls=0,failAfterCommit=false,denyReceipt=false;
 const calls=[];
 const functions={helm_pilot_revision_route:[],helm_pilot_revision_observe_mapped:['p_revision','p_connection','p_generation'],
   helm_pilot_revision_receipt_mapped:['p_id','p_connection','p_generation']};
 const fetcher=async(input,init)=>{
   const u=new URL(String(input));
   if(u.origin===url) {
     const fn=u.pathname.split('/').at(-1),names=functions[fn],args=JSON.parse(init.body);calls.push(fn);
     assert.ok(names,`Unexpected RPC ${fn}`);assert.deepEqual(Object.keys(args).sort(),[...names].sort());
     if(fn==='helm_pilot_revision_receipt_mapped'&&denyReceipt)return Response.json({message:'simulated mapping read outage'},{status:400});
     await db.exec('set role service_role');let result;
     try {result=(await query(`select public.${fn}(${names.map((_,i)=>'$'+(i+1)).join(',')}) r`,names.map(n=>args[n]))).rows[0].r;}
     catch {return Response.json({message:'simulated RPC refusal'},{status:400});}
     finally {await db.exec('reset role');}
     if(fn==='helm_pilot_revision_observe_mapped'&&failAfterCommit)throw Error('simulated lost response');
     return Response.json(result);
   }
   assert.equal(u.origin,'https://staging.channex.io');providerCalls++;
   if(u.pathname.endsWith('/ack')) {
     assert.equal(init.method,'POST');assert.ok(u.pathname.includes(revision.id));
     assert.equal((await readReceipt(revision.id)).rows[0].r.committed,true);acks++;return Response.json({meta:{message:'Success'}});
   }
   assert.equal(init.method,'GET');const rel=id=>({data:{id}});
   if(u.pathname.includes('/booking_revisions/')) {
     if(u.pathname.endsWith('/feed')) {
       assert.equal(u.searchParams.get('filter[property_id]'),mapping.propertyId);
       return Response.json({data:[raw(revision)],meta:{page:1,total:1,limit:100}});
     }
     assert.ok(u.pathname.endsWith(revision.id));return Response.json({data:raw(revision)});
   }
   if(u.pathname.includes('/properties/'))return Response.json({data:{id:mapping.propertyId,attributes:{title:'65 Calderwood - Isolated Staging',currency:'USD',timezone:'America/New_York'}}});
   if(u.pathname.includes('/room_types/'))return Response.json({data:{id:mapping.roomTypeId,attributes:{count_of_rooms:1,occ_adults:6,occ_children:0,occ_infants:0},relationships:{property:rel(mapping.propertyId)}}});
   if(u.pathname.includes('/rate_plans/'))return Response.json({data:{id:mapping.ratePlanId,attributes:{title:'TEST ONLY - Calderwood - CLOSED - $100 placeholder',currency:'USD',sell_mode:'per_room',stop_sell:Array(7).fill(true)},relationships:{property:rel(mapping.propertyId),room_type:rel(mapping.roomTypeId)}}});
   assert.equal(u.searchParams.get('filter[property_id]'),mapping.propertyId);
   if(u.pathname.endsWith('/channels'))return Response.json({data:[],meta:{total:0,page:1,limit:100}});
   assert.ok(u.pathname.endsWith('/availability')||u.pathname.endsWith('/restrictions'));return Response.json({data:{}});
 };
 const input={url,storageKey:'fixture',providerKey:'fixture'};
 const env={CHANNEX_CANONICAL_POLLING_ENABLED:'true',CHANNEX_WORKER_MODE:'isolated-staging',CHANNEX_STAGING_DB_PROJECT_REF:'jgkblfozftcvymvwhhii',
   CHANNEX_STAGING_DB_URL:url,CHANNEX_STAGING_API_KEY:'fixture',CHANNEX_STAGING_DB_SERVICE_KEY:'fixture'};
 const poll=createCanonicalRevisionPageRunner(env,fetcher);
 const signed=async()=>{
   const now=Date.now(),ts=String(Math.floor(now/1000)),secret='fixture-only';
   const body=JSON.stringify({event:'booking',property_id:mapping.propertyId,payload:{property_id:mapping.propertyId,revision_id:revision.id,booking_id:revision.bookingId}});
   return handleCanonicalRevisionWebhook(new Request('https://example.invalid/webhook',{method:'POST',body,headers:{'content-type':'application/json',
     'x-hmac-timestamp':ts,'x-hmac-signature-256':createHmac('sha256',secret).update(ts+'.'+body).digest('hex')}}),{
     enabled:true,secret,now:()=>now,run:(revisionId,bookingId)=>runMappedCanonicalRevisions({...input,revisionId,bookingId},fetcher)});
 };
 await check('routed import: signed webhook saves canonical stay/capture/receipt before simulated ACK',async()=>{
   const before=await counts();assert.equal((await signed()).status,200);assert.equal(acks,1);
   const after=await counts();assert.deepEqual(after,{bookings:before.bookings+1,receipts:before.receipts+1,audit:before.audit+1,capture:before.capture+1});
   assert.deepEqual(calls,['helm_pilot_revision_route','helm_pilot_revision_observe_mapped','helm_pilot_revision_receipt_mapped']);
   assert.doesNotMatch(JSON.stringify((await readReceipt(revision.id)).rows[0].r),/MUST NOT RETAIN/);
 });
 await check('routed import: backup polling replays signed notice without duplicate booking or capture',async()=>{
   const before=await counts();assert.equal((await poll(new AbortController().signal)).acknowledged,1);assert.equal(acks,2);
   assert.deepEqual(await counts(),before);
 });
 await check('routed import: lost commit response and failed independent read do not ACK; retry retains one save',async()=>{
   revision=make(2,{status:'modified',checkIn:'2027-08-06',checkOut:'2027-08-09'});failAfterCommit=true;
   assert.equal((await signed()).status,503);assert.equal(acks,2);const saved=await counts();failAfterCommit=false;denyReceipt=true;
   assert.equal((await signed()).status,503);assert.equal(acks,2);assert.deepEqual(await counts(),saved);
   denyReceipt=false;assert.equal((await signed()).status,200);assert.equal(acks,3);assert.deepEqual(await counts(),saved);
 });
 await check('routed import: cancellation retains normal waiting-message cancellation',async()=>{
   const id=(await readReceipt(revision.id)).rows[0].r.canonicalBookingId;
   await query("insert into automation_sends(booking_id,property_id,fire_at,planned_check_in,planned_check_out,status) values($1,$2,now(),'2027-08-06','2027-08-09','scheduled')",[id,p]);
   revision=make(3,{status:'cancelled',checkIn:'2027-08-06',checkOut:'2027-08-09'});
   assert.equal((await poll(new AbortController().signal)).acknowledged,1);
   assert.equal((await query('select status from automation_sends where booking_id=$1',[id])).rows[0].status,'cancelled');
 });
 await check('routed import: disabled scope blocks provider IO and stale binding cannot read old receipts',async()=>{
   const before=providerCalls;await query('update helm_channex_revisions.scope set enabled=false');
   assert.equal((await signed()).status,503);assert.equal(providerCalls,before);
   await assert.rejects(()=>readReceipt(revision.id),/revision_import_disabled/);
   await query('update helm_channex_revisions.scope set enabled=true');
   const saved=await counts();await assert.rejects(()=>observe(make(4),binding[0],binding[1]+1),/reviewed_revision_route_required/);
   await assert.rejects(()=>observe(make(4),'wrong-connection'),/reviewed_revision_route_required/);assert.deepEqual(await counts(),saved);
 });
 await check('routed import: another property cannot borrow Calderwood receipts or room identity',async()=>{
   const saved=await counts();await assert.rejects(()=>observe(make(4,{propertyId:'21111111-1111-4111-8111-111111111111'})),/invalid_synthetic_revision/);
   assert.deepEqual(await counts(),saved);
   const id=(await readReceipt(revision.id)).rows[0].r.canonicalBookingId;
   await db.exec('begin');
   try {await query("update bookings set source_ref='different' where id=$1",[id]);await assert.rejects(()=>readReceipt(revision.id),/canonical_booking_ownership_changed/);}
   finally {await db.exec('rollback');}
 });
 await check('routed import: browser cannot resolve, import or acknowledge; service cannot call private helpers',async()=>{
   for(const role of ['anon','authenticated','service_role']) {
     await db.exec(`set role ${role}`);
     try {
       await assert.rejects(()=>query('select helm_channex_revisions.lock_route($1,$2)',binding),/permission denied/);
       if(role!=='service_role') {
         await assert.rejects(readRoute,/permission denied/);await assert.rejects(()=>observe(make(4)),/permission denied/);
         await assert.rejects(()=>readReceipt(revision.id),/permission denied/);
       } else assert.equal((await readRoute()).generation,binding[1]);
     } finally {await db.exec('reset role');}
   }
 });
 await check('routed import: reinstall preserves old receipts and control state',async()=>{
   const saved=await counts(),route=await readRoute();await db.exec(sql);
   assert.deepEqual(await counts(),saved);assert.deepEqual(await readRoute(),route);
   const old=(await query('select revision_id from helm_channex_revisions.receipts order by committed_at limit 1')).rows[0].revision_id;
   assert.equal((await readReceipt(old)).rows[0].r.committed,true);
 });
 const {a,b,blocked,pidA,pidB}=race;
 await check('routed import race: completed import fences configuration until transaction commits',async()=>{
   const r=make(4,{status:'modified',checkIn:'2027-08-11',checkOut:'2027-08-13'});
   await a.query('begin');await a.query('select helm_pilot_revision_observe_mapped($1,$2,$3)',[r,...binding]);
   await b.query('begin');const pending=b.query("update helm_booking_inventory_consumers set configuration=jsonb_set(configuration,'{generation}',to_jsonb($1::bigint)) where property_id=$2",[binding[1]+1,p]);
   await blocked(pending,pidB,pidA);await a.query('commit');await pending;await b.query('rollback');
   assert.equal((await readReceipt(r.id)).rows[0].r.committed,true);
 });
 await check('routed import race: concurrent mapping withdrawal rolls back booking, audit, capture and receipt',async()=>{
   const before=await counts(),r=make(5,{status:'modified',checkIn:'2027-08-15',checkOut:'2027-08-18'});
   await a.query('begin');await a.query("update helm_booking_inventory_consumers set configuration=jsonb_set(configuration,'{generation}',to_jsonb($1::bigint)) where property_id=$2",[binding[1]+1,p]);
   const pending=b.query('select helm_pilot_revision_observe_mapped($1,$2,$3)',[r,...binding]);
   const rejected=assert.rejects(pending,/reviewed_revision_route_required/);
   await blocked(pending,pidB,pidA);await a.query('commit');await rejected;
   assert.deepEqual(await counts(),before);assert.equal((await query('select helm_pilot_revision_receipt($1) r',[r.id])).rows[0].r,null);
   await assert.rejects(()=>readReceipt(make(4).id),/reviewed_revision_route_required/);
 });
}
