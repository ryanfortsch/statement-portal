import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
export async function verifyBookingInventoryCapacity(db, check) {
  const sql=readFileSync(new URL('../docs/guesty-exit/staging-storage/booking-inventory-capacity.sql',import.meta.url),'utf8');
  const q=async(s,args=[]) => (await db.query(s,args)).rows;
  await db.exec(sql);
  await db.exec("insert into properties(id,name,address,city,owner_last,owner_full,owner_greeting,management_fee_pct) values('capacity-home','Fictional','Fictional','Fictional','Fixture','Fixture','Fixture',0); insert into helm_inventory_capture_scopes(property_id) values('capacity-home'); insert into helm_booking_inventory_consumers(property_id,configuration) values('capacity-home','{}')");
  const history={format:1,commands:Array.from({length:9990},()=>({kind:'expire',now:0}))};
  await q("update helm_booking_inventory_consumers set journal=$1,journal_version=9990 where property_id='capacity-home'",[history]);
  const read=async()=>(await q("select journal_version,journal from helm_booking_inventory_consumers where property_id='capacity-home'"))[0];
  await check('capacity: database refuses new work while preserving ten settlement slots and the exact prefix',async()=>{
    for(const kind of ['enqueue','retire-pending','claim','dispatch']){
      await assert.rejects(()=>q("select helm_booking_inventory_append_internal('capacity-home',9990,$1)",[{...history,commands:[...history.commands,{kind}]}]),/inventory_history_capacity/);
      assert.equal(Number((await read()).journal_version),9990);
    }
    const next={...history,commands:[...history.commands,{kind:'expire',now:1}]};
    await db.exec('set role service_role');
    try {assert.equal((await q("select helm_booking_inventory_journal_append('capacity-home',9990,$1) ok",[next]))[0].ok,true);}
    finally {await db.exec('reset role');}
    assert.deepEqual((await read()).journal,next);
    assert.equal((await q("select helm_booking_inventory_journal_append('capacity-home',9990,$1) ok",[next]))[0].ok,false);
  });
  await check('capacity: neither rewriting history nor jumping the version can spend reserved slots',async()=>{
    const before=await read(),next={...before.journal,commands:[...before.journal.commands,{kind:'expire',now:2}]};
    next.commands[0]={kind:'expire',now:100};
    await assert.rejects(()=>q("select helm_booking_inventory_journal_append('capacity-home',9991,$1)",[next]),/history rewrite/);
    assert.deepEqual(await read(),before);
    for(const role of ['anon','authenticated','service_role']){
      await db.exec('set role '+role);
      try {await assert.rejects(()=>q("select helm_booking_inventory_append_internal('capacity-home',9991,$1)",[next]),/permission denied/);}
      finally {await db.exec('reset role');}
    }
  });
  await check('capacity: patch reinstall keeps all audit history',async()=>{
    const before=await read();await db.exec(sql);assert.deepEqual(await read(),before);
  });
}
