// Actual canonical RPC + inventory capture + message-ledger integration.
// Reused by local PGlite and native PostgreSQL; only fictional rows and injected HTTP.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CALDERWOOD_STAGING } from '../src/lib/calderwood-readonly/channex.ts';
import { parseCanonicalRevision, ingestCanonicalRevisions } from '../src/lib/channex-staging/canonical-revisions.ts';
export async function verifyCanonicalRevisions(db, check) {
  const sql=readFileSync(new URL('../docs/guesty-exit/staging-storage/canonical-revisions.sql',import.meta.url),'utf8');
  const query=async(s,args=[]) => (await db.query(s,args)).rows;
  const p='HELMTEST-calderwood';
  const remote='80d4fed1-c4bc-4d30-b096-a19826da88c6';
  const make=(n,fields={})=>parseCanonicalRevision({
    id:'80d4fed1-c4bc-4d30-b096-'+String(n).padStart(12,'0'),bookingId:remote,
    propertyId:CALDERWOOD_STAGING.propertyId,roomTypeId:CALDERWOOD_STAGING.roomTypeId,ratePlanId:CALDERWOOD_STAGING.ratePlanId,
    code:'HELMTEST-canonical-integration',status:'new',checkIn:'2027-02-01',checkOut:'2027-02-04',
    receivedAt:'2026-10-19T14:00:'+String(n).padStart(2,'0')+'.000001Z',...fields,
  });
  const store={
    commit:async revision=>(await query('select helm_pilot_revision_commit($1) result',[revision]))[0].result,
    receipt:async id=>(await query('select helm_pilot_revision_receipt($1) result',[id]))[0].result,
  };
  let feed=[],acks=0,failAck=false;
  const client={inspect:async()=>{},feed:async()=>feed,revision:async()=>feed[0],
    acknowledge:async()=>{if(failAck)throw Error('simulated acknowledgement outage');acks++;}};
  const run=async rows=>{feed=rows;return ingestCanonicalRevisions(client,store);};
  const counts=async()=>(await query("select (select count(*) from bookings where property_id=$1)::int bookings, (select count(*) from helm_channex_revisions.receipts)::int receipts, (select count(*) from booking_events where booking_id in(select id from bookings where property_id=$1))::int audit, (select version::int from helm_inventory_capture_scopes where property_id=$1) version",[p]))[0];
  const current=async()=>(await query('select *,check_in::text as check_in,check_out::text as check_out from bookings where property_id=$1 order by created_at',[p]))[0];
  await db.exec(sql);
  await query("insert into properties(id,name,address,city,owner_last,owner_full,owner_greeting,management_fee_pct,calendar_authority) values($1,'Fictional canonical import','Fictional','Fictional','Fixture','Fixture','Fixture',0,'helm')",[p]);
  await query('insert into helm_inventory_capture_scopes(property_id) values($1)',[p]);
  await query('insert into helm_channex_revisions.scope(property_id) values($1)',[p]);
  await check('canonical import: disabled scope or missing capture refuses every write/ACK',async()=>{
    await assert.rejects(()=>run([make(1)]),/disabled/);
    await db.exec('update helm_channex_revisions.scope set enabled=true');
    await assert.rejects(()=>run([make(1)]),/capture_required/);
    assert.equal(acks,0);assert.equal((await counts()).bookings,0);
    await query('update helm_inventory_capture_scopes set enabled=true where property_id=$1',[p]);
  });
  await check('canonical import: new revision atomically creates calendar stay, audit, inventory event and receipt',async()=>{
    await db.exec('set role service_role');
    try {assert.equal((await run([make(1)])).acknowledged,1);} finally {await db.exec('reset role');}
    const c=await counts(); assert.deepEqual(c,{bookings:1,receipts:1,audit:1,version:2});
    const b=await current();assert.equal(b.status,'confirmed');assert.equal(b.source_ref,'channex-staging:'+remote);
  });
  await check('canonical import: delivery retry does not duplicate booking, capture or message history',async()=>{
    const before=await counts();await run([make(1)]);assert.deepEqual(await counts(),before);
  });
  await check('canonical import: date change reuses the same booking and invalidates availability',async()=>{
    const b=await current(); await run([make(2,{status:'modified',checkIn:'2027-02-05',checkOut:'2027-02-08'})]);
    const moved=await current();assert.equal(moved.id,b.id);assert.equal(String(moved.check_in).slice(0,10),'2027-02-05');
    assert.deepEqual(await counts(),{bookings:1,receipts:2,audit:2,version:3});
  });
  await check('canonical import: cancellation stops waiting messages and preserves sent/inflight history',async()=>{
    const b=await current();
    for(const status of ['scheduled','awaiting_approval','sent','sending','failed'])
      await query("insert into automation_sends(booking_id,property_id,fire_at,planned_check_in,planned_check_out,status) values($1,$2,now(),'2027-02-05','2027-02-08',$3)",[b.id,p,status]);
    await run([make(3,{status:'cancelled',checkIn:'2027-02-05',checkOut:'2027-02-08'})]);
    assert.equal((await current()).status,'cancelled');
    const states=(await query('select status,error from automation_sends where booking_id=$1',[b.id]));
    assert.equal(states.filter(s=>s.status==='cancelled'&&s.error==='stay cancelled').length,2);
    assert.deepEqual(states.filter(s=>s.status!=='cancelled').map(s=>s.status).sort(),['failed','sending','sent']);
  });
  await check('canonical import: stale revision is retained without resurrecting cancelled stay',async()=>{
    const before=await counts();const r=make(4,{receivedAt:'2026-10-19T14:00:02.000002Z',status:'modified'});
    assert.equal((await run([r])).stale,1);
    const after=await counts();assert.equal(after.version,before.version);assert.equal(after.audit,before.audit);
    assert.equal((await current()).status,'cancelled');
  });
  await check('canonical import: reused revision content and equal timestamps are refused before ACK',async()=>{
    const before=await counts(),a=acks;
    await assert.rejects(()=>run([make(1,{checkOut:'2027-02-06'})]),/identity_conflict/);
    await assert.rejects(()=>run([make(5,{receivedAt:make(3).receivedAt})]),/ambiguous_revision_order/);
    assert.deepEqual(await counts(),before);assert.equal(acks,a);
  });
  await check('canonical import: provider ACK outage retains one durable receipt for retry',async()=>{
    failAck=true;const r=make(6,{status:'modified',checkIn:'2027-02-10',checkOut:'2027-02-12'});
    await assert.rejects(()=>run([r]),/acknowledgement outage/);const before=await counts();
    failAck=false;await run([r]);assert.deepEqual(await counts(),before);
  });
  await check('canonical import: lost save response is recovered without duplicate canonical writes',async()=>{
    const r=make(7,{status:'modified',checkIn:'2027-02-13',checkOut:'2027-02-15'}),a=acks;
    feed=[r];
    await assert.rejects(()=>ingestCanonicalRevisions(client,{...store,commit:async v=>{await store.commit(v);throw Error('lost response');}}),/lost response/);
    assert.equal(acks,a);const before=await counts();await run([r]);assert.deepEqual(await counts(),before);
  });
  await check('canonical import: overlapping stay rejects revision and leaves no receipt',async()=>{
    const before=await counts(),a=acks;
    await assert.rejects(()=>run([make(8,{bookingId:'71fd4039-cef3-4495-aac8-1979cac9890b',code:'HELMTEST-overlap',checkIn:'2027-02-13',checkOut:'2027-02-14'})]),/booking_overlap/);
    assert.deepEqual(await counts(),before);assert.equal(acks,a);
  });
  await check('canonical import: receipt failure rolls back calendar, audit and inventory event',async()=>{
    await db.exec("create function helm_channex_revisions.fixture_fail() returns trigger language plpgsql as $$begin raise exception 'fixture_receipt_failure'; end$$; create trigger fixture_failure before insert on helm_channex_revisions.receipts for each row execute function helm_channex_revisions.fixture_fail()");
    const before=await counts(),a=acks;
    try {await assert.rejects(()=>run([make(9,{status:'cancelled'})]),/fixture_receipt_failure/);}
    finally {await db.exec('drop trigger fixture_failure on helm_channex_revisions.receipts; drop function helm_channex_revisions.fixture_fail()');}
    assert.deepEqual(await counts(),before);assert.equal(acks,a);
  });
  await check('canonical import: bad mapping and unexpected private fields fail at the SQL boundary too',async()=>{
    const before=await counts();
    for(const r of [{...make(10),propertyId:remote},{...make(10),customer:'private'},{...make(10),checkIn:'2027-02-30'}])
      await assert.rejects(()=>query('select helm_pilot_revision_commit($1)',[r]));
    assert.deepEqual(await counts(),before);
  });
  await check('canonical import: owner configuration is private; browser roles cannot read or import',async()=>{
    for(const role of ['anon','authenticated','service_role']){
      await db.exec('set role '+role);
      try {
        await assert.rejects(()=>query('select * from helm_channex_revisions.scope'),/permission denied/);
        await assert.rejects(()=>query('update helm_channex_revisions.scope set enabled=false'),/permission denied/);
        if(role!=='service_role'){
          await assert.rejects(()=>store.commit(make(10)),/permission denied/);
          await assert.rejects(()=>store.receipt(make(1).id),/permission denied/);
        }
      } finally {await db.exec('reset role');}
    }
  });
  await check('canonical import: repeat installation retains receipts and replay stays idempotent',async()=>{
    const before=await counts();await db.exec(sql);await run([make(7,{status:'modified',checkIn:'2027-02-13',checkOut:'2027-02-15'})]);
    assert.deepEqual(await counts(),before);
  });
  await check('canonical import: fresh database read returns the committed receipt without in-memory state',async()=>{
    const saved=(await query('select helm_pilot_revision_receipt($1) result',[make(1).id]))[0].result;
    assert.equal(saved.committed,true);assert.equal(saved.revision.id,make(1).id);
    assert.equal(saved.canonicalBookingId,(await current()).id);
  });
}
