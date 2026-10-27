// Local database only. Runs after verifyCanonicalRevisions; no external connections.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCanonicalSourceSnapshot, verifyCanonicalSource, renewCanonicalSourceCoverage } from '../src/lib/channex-staging/canonical-source.ts';
export async function verifyCanonicalSourceDatabase(db,check) {
  const sql=readFileSync(new URL('../docs/guesty-exit/staging-storage/canonical-source.sql',import.meta.url),'utf8');
  const query=async(s,args=[])=>(await db.query(s,args)).rows;
  const property='HELMTEST-calderwood',start='2027-01-01',end='2028-01-01';
  const configuration={environment:'staging',topology:'single-unit',connection:'calderwood-hosted-inventory',
    listing:'f795ae2c-f47d-4751-86ff-e883b6d30800',generation:1,publishEnabled:false,timeZone:'America/New_York',
    start,end,requiredSources:['channex-staging-bookings'],coverage:[]};
  await query('insert into helm_booking_inventory_consumers(property_id,configuration) values($1,$2)',[property,configuration]);
  await db.exec(sql);
  const read=async()=>parseCanonicalSourceSnapshot((await query('select helm_pilot_source_read() state'))[0].state);
  const certify=async(expected,bookings,observedAt,s=start,e=end)=>(await query('select helm_pilot_source_certify($1,$2,$3,$4,$5) ok',
    [JSON.stringify(expected),JSON.stringify(bookings),observedAt,s,e]))[0].ok;
  const state=async()=>(await query('select helm_booking_inventory_read($1) state',[property]))[0].state;
  const transaction=async(fn)=>{await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}};
  const initial=await read(),bookings=initial.bindings.map(b=>b.booking);
  const client={inspect:async()=>{},bookings:async()=>structuredClone(bookings),pending:async()=>false};
  const store={read,certify};
  await check('source: actual canonical receipt and row project exactly without private or financial columns',async()=>{
    assert.equal(initial.bindings.length,1);assert.equal(initial.bindings[0].valid,true);assert.equal(initial.unmappedRemoteRows,0);
    assert.doesNotMatch(JSON.stringify(initial),/guest_name|guest_email|gross_amount|PRIVATE/);
    assert.equal((await verifyCanonicalSource(client,store)).complete,true);
  });
  await check('source: service-only renewal changes coverage/version but never publish flag, stays, plan or journal',async()=>{
    const before=await state();await db.exec('set role service_role');
    try {assert.equal((await renewCanonicalSourceCoverage(client,store,{start,end})).status,'renewed');} finally {await db.exec('reset role');}
    const after=await state();assert.equal(after.configuration.publishEnabled,false);assert.equal(after.configurationVersion,before.configurationVersion+1);
    assert.deepEqual(after.journal,before.journal);assert.deepEqual(after.inputs,before.inputs);
    assert.equal(after.planVersion,before.planVersion);assert.equal(after.captureVersion,before.captureVersion);
    assert.equal(after.configuration.coverage[0].freshUntil-after.configuration.coverage[0].observedAt,900000);
    for(const role of ['anon','authenticated','service_role']) {
      const row=(await query("select has_function_privilege($1,'helm_pilot_source_read()','execute') r,has_function_privilege($1,'helm_pilot_source_certify(jsonb,jsonb,bigint,date,date)','execute') w",[role]))[0];
      assert.deepEqual(row,{r:role==='service_role',w:role==='service_role'});
    }
  });
  await check('source: lost-response replay and old/future proof timestamps cannot extend coverage',async()=>{
    const s=await read(),before=await state(),observed=before.configuration.coverage[0].observedAt;
    for(const stamp of [observed,Date.now()-60001,Date.now()+10000,null]) assert.equal(await certify(s,bookings,stamp),false);
    assert.deepEqual(await state(),before);
  });
  await check('source: stale capture/configuration, authority, importer, canonical ownership or missing receipt rejects proof',async()=>{
    for(const mutate of [
      ()=>query("update bookings set check_out=check_out+1 where property_id=$1",[property]),
      ()=>query("update bookings set source_ref='changed' where property_id=$1",[property]),
      ()=>query("update bookings set hold_kind='owner' where property_id=$1",[property]),
      ()=>query("update helm_booking_inventory_consumers set configuration=jsonb_set(configuration,'{publishEnabled}','true') where property_id=$1",[property]),
      ()=>query("update properties set calendar_authority='guesty' where id=$1",[property]),
      ()=>query('update helm_channex_revisions.scope set enabled=false'),
      ()=>query('delete from helm_channex_revisions.receipts where revision_id=(select latest_revision from helm_channex_revisions.bookings limit 1)')
    ]) await transaction(async()=>{
      const s=await read();await mutate();const before=await state();assert.equal(await certify(s,bookings,Date.now()),false);assert.deepEqual(await state(),before);
    });
  });
  await check('source: matching expected snapshot cannot legitimize tampered current booking or extra unmapped remote row',async()=>{
    await transaction(async()=>{
      await query("update bookings set source_ref='changed' where property_id=$1",[property]);
      const s=await read();assert.equal(s.bindings[0].valid,false);assert.equal(await certify(s,bookings,Date.now()),false);
    });
    await transaction(async()=>{
      await query("select * from helm_create_booking($1,'other','manual','cancelled','2027-08-01','2027-08-03',$2,'fixture',false)",[property,{source_ref:'channex-staging:unmapped'}]);
      const s=await read();assert.equal(s.unmappedRemoteRows,1);assert.equal(await certify(s,bookings,Date.now()),false);
    });
  });
  await check('source: incomplete remote list, altered latest revision and oversized coverage fail SQL independently',async()=>{
    const s=await read(),before=await state();
    for(const rows of [[],[...bookings,...bookings],[{...bookings[0],revisionId:bookings[0].bookingId}]]) assert.equal(await certify(s,rows,Date.now()),false);
    for(const window of [[start,start],[end,start],[start,'2029-01-01']]) assert.equal(await certify(s,bookings,Date.now(),...window),false);
    assert.deepEqual(await state(),before);
  });
  await check('source: valid cancelled local history is retained without hiding a missing active source stay',async()=>{
    await transaction(async()=>{
      await query("update bookings set status='cancelled' where property_id=$1",[property]);
      await query("update helm_channex_revisions.receipts set revision=jsonb_set(revision,'{status}','\"cancelled\"') where revision_id=(select latest_revision from helm_channex_revisions.bookings limit 1)");
      const s=await read();assert.equal(s.bindings[0].valid,true);assert.equal(await certify(s,[],Date.now()),true);
    });
  });
  await check('source: manual reviewed evidence cannot be silently promoted to automatic provider coverage',async()=>{
    await transaction(async()=>{
      await query("update helm_booking_inventory_consumers set configuration=jsonb_set(configuration,'{requiredSources}','[\"synthetic-canonical\"]') where property_id=$1",[property]);
      const s=await read();assert.equal(await certify(s,bookings,Date.now()),false);
    });
  });
  await check('source: reinstall preserves coverage, receipts and all queue history',async()=>{
    const before=await state(),snapshot=await read();await db.exec(sql);assert.deepEqual(await state(),before);assert.deepEqual(await read(),snapshot);
  });
  const upgrade=readFileSync(new URL('../docs/guesty-exit/staging-storage/canonical-source-500-day.sql',import.meta.url),'utf8');
  await check('source: 500-day upgrade preserves state and permissions and is repeatable',async()=>{
    const before=await state(),snapshot=await read();
    const permissions=async()=>query("select proacl::text,proowner from pg_proc where oid='helm_pilot_source_certify(jsonb,jsonb,bigint,date,date)'::regprocedure");
    const acl=await permissions();await db.exec(upgrade);await db.exec(upgrade);
    assert.deepEqual(await state(),before);assert.deepEqual(await read(),snapshot);assert.deepEqual(await permissions(),acl);
  });
  await check('source: upgraded SQL accepts 500 and 560 days but refuses 561',async()=>{
    for(const days of [500,560,561]) await transaction(async()=>{
      await query("update helm_booking_inventory_consumers set configuration=jsonb_set(configuration,'{coverage}','[]') where property_id=$1",[property]);
      const expected=await read(),before=await state();
      const edge=new Date(Date.parse(start)+days*86400000).toISOString().slice(0,10);
      assert.equal(await certify(expected,bookings,Date.now(),start,edge),days<=560);
      if(days>560) assert.deepEqual(await state(),before);
      else {const after=await state();assert.equal(after.configuration.publishEnabled,false);assert.deepEqual(after.journal,before.journal);}
    });
  });
  return {read,certify,state,bookings,start,end};
}
