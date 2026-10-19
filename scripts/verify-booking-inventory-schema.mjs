// Behavioral checks against the repository DDL subset. Synthetic rows only.
import assert from 'node:assert/strict';
export async function verifyBookingInventorySchema(db, check) {
  const query = async (sql, args = []) => (await db.query(sql, args)).rows;
  const version = async () => Number((await query("select version from helm_inventory_capture_scopes where property_id='schema_probe'"))[0].version);
  const create = async () => (await query(`select * from helm_create_booking('schema_probe','manual','manual',
    'confirmed','2028-01-10','2028-01-12','{}','fixture',true)`))[0];
  const cancel = id => query("select * from helm_cancel_booking($1,'fixture','fixture')", [id]);
  const booking = async id => (await query('select * from bookings where id=$1', [id]))[0];
  const addSend = async (id, status = 'scheduled', automationId = null) => (await query(`insert into automation_sends
    (booking_id,property_id,fire_at,planned_check_in,planned_check_out,status,automation_id)
    select id,property_id,'2028-01-09',check_in,check_out,$2,$3 from bookings where id=$1 returning *`, [id,status,automationId]))[0];
  const rejected = (fn, code) => assert.rejects(fn, error => error.code === code);
  await db.exec(`insert into properties(id,name,address,city,owner_last,owner_full,owner_greeting,management_fee_pct)
    values('schema_probe','Fixture','123 Fictional Street','Fixture','Fixture','Fixture','Fixture',0);
    insert into helm_inventory_capture_scopes(property_id,enabled) values('schema_probe',true);
    insert into property_rate_plans(property_id,base_nightly_cents) values('schema_probe',10000);
    insert into property_calendar_days(property_id,date,status,price,min_nights) values('schema_probe','2028-01-10','available',100,3);`);
  const mirror = await query("select * from property_calendar_days where property_id='schema_probe'");
  await check('schema: real booking foreign keys reject invalid references without capture', async () => {
    const row = await create(), before = await version();
    for (const column of ['guest_id','duplicate_of','channel_listing_id']) {
      await rejected(() => query(`update bookings set ${column}='ffffffff-ffff-4fff-8fff-ffffffffffff' where id=$1`, [row.id]), '23503');
    }
    await rejected(() => query("update bookings set property_id='missing-fixture' where id=$1", [row.id]), '23503');
    assert.equal(await version(), before);
    assert.equal((await booking(row.id)).property_id, 'schema_probe');
  });
  await check('schema: deleting the canonical row captures the duplicate becoming canonical', async () => {
    const original = await create(), duplicate = await create();
    await query('update bookings set duplicate_of=$1 where id=$2', [original.id,duplicate.id]);
    const before = await version();
    await query('delete from bookings where id=$1', [original.id]);
    assert.equal((await booking(duplicate.id)).duplicate_of, null);
    const events = await query("select booking_id,reason from helm_booking_inventory_events where property_id='schema_probe' and version>$1", [before]);
    assert.equal(events.length, 2);
    assert.ok(events.some(e => e.booking_id === original.id && e.reason === 'booking_delete'));
    assert.ok(events.some(e => e.booking_id === duplicate.id && e.reason === 'booking_update'));
  });
  await check('schema: mapping removal invalidates inventory; guest identity removal does not', async () => {
    const row = await create();
    const guest = (await query("insert into guests(email) values('fixture@example.invalid') returning id"))[0].id;
    const listing = (await query("insert into channel_listings(property_id,channel) values('schema_probe','airbnb') returning id"))[0].id;
    await query('update bookings set guest_id=$1,channel_listing_id=$2 where id=$3', [guest,listing,row.id]);
    const before = await version();
    await query('delete from guests where id=$1', [guest]);
    assert.equal((await booking(row.id)).guest_id, null);
    assert.equal(await version(), before);
    await query('delete from channel_listings where id=$1', [listing]);
    assert.equal((await booking(row.id)).channel_listing_id, null);
    assert.equal(await version(), before + 1);
  });
  await check('schema: cancellation pauses waiting messages and preserves sent/in-flight records', async () => {
    const row = await create();
    const statuses = ['scheduled','awaiting_approval','sending','sent','failed'];
    const sends = [];
    for (const status of statuses) sends.push(await addSend(row.id,status));
    const before = await version();
    await cancel(row.id);
    assert.equal(await version(), before + 1);
    for (const send of sends) {
      const actual = (await query('select * from automation_sends where id=$1', [send.id]))[0];
      if (['scheduled','awaiting_approval'].includes(send.status)) {
        assert.equal(actual.status,'cancelled'); assert.equal(actual.error,'stay cancelled');
        assert.deepEqual(actual.planned_check_in,send.planned_check_in);
        assert.deepEqual(actual.planned_check_out,send.planned_check_out);
      } else assert.deepEqual(actual,send);
    }
  });
  await check('schema: message ledger enforces required fields, statuses, references and deduplication', async () => {
    const row = await create();
    const rule = (await query("insert into message_automations(key,property_id,trigger,body) values('fixture','schema_probe','pre_arrival','Fictional message') returning id"))[0].id;
    await addSend(row.id,'scheduled',rule);
    await rejected(() => addSend(row.id,'scheduled',rule), '23505');
    await rejected(() => addSend(row.id,'unrecognized'), '23514');
    await rejected(() => addSend(row.id,'scheduled','ffffffff-ffff-4fff-8fff-ffffffffffff'), '23503');
    await rejected(() => query('insert into automation_sends(booking_id) values($1)', [row.id]), '23502');
  });
  await check('schema: deleting a message rule preserves its send history and inventory version', async () => {
    const rule = (await query("select id from message_automations where key='fixture'"))[0].id;
    const before = await query('select * from automation_sends where automation_id=$1', [rule]);
    const v = await version();
    await query('delete from message_automations where id=$1', [rule]);
    const after = await query('select * from automation_sends where id=$1', [before[0].id]);
    assert.equal(after.length,1); assert.equal(after[0].automation_id,null);
    assert.equal(after[0].status,before[0].status);
    assert.equal(await version(),v);
  });
  await check('schema: ledger constraint failure rolls back cancellation, audit and capture together', async () => {
    const row = await create(); const send = await addSend(row.id);
    const v = await version();
    const audit = await query('select * from booking_events where booking_id=$1 order by at,id', [row.id]);
    await db.exec("alter table automation_sends add constraint fixture_reject_cancel check(property_id <> 'schema_probe' or status <> 'cancelled') not valid");
    try {
      await rejected(() => cancel(row.id), '23514');
      assert.equal((await booking(row.id)).status,'confirmed');
      assert.deepEqual((await query('select * from automation_sends where id=$1', [send.id]))[0],send);
      assert.equal(await version(),v);
      assert.deepEqual(await query('select * from booking_events where booking_id=$1 order by at,id', [row.id]),audit);
    } finally { await db.exec('alter table automation_sends drop constraint fixture_reject_cancel'); }
  });
  await check('schema: repository timestamps and property insert trigger coexist with capture', async () => {
    const property = (await query("select * from properties where id='schema_probe'"))[0];
    assert.equal(property.listing_match,'123 fictional street');
    const v = await version();
    await db.exec("update properties set calendar_authority='helm',updated_at='2001-01-01' where id='schema_probe'");
    assert.equal(await version(),v+1);
    assert.ok(new Date((await query("select updated_at from properties where id='schema_probe'"))[0].updated_at).getUTCFullYear() > 2001);
    await db.exec("update property_rate_plans set base_nightly_cents=10100,updated_at='2001-01-01' where property_id='schema_probe'");
    assert.equal(await version(),v+1);
    assert.ok(new Date((await query("select updated_at from property_rate_plans where property_id='schema_probe'"))[0].updated_at).getUTCFullYear() > 2001);
  });
  await check('schema: service role can write real source tables while browser roles cannot', async () => {
    const roles = await query("select rolname,rolsuper,rolbypassrls from pg_roles where rolname in ('anon','authenticated','service_role')");
    assert.ok(roles.every(r => !r.rolsuper));
    assert.deepEqual(roles.filter(r => r.rolbypassrls).map(r => r.rolname),['service_role']);
    const row = await create(), v = await version();
    await db.exec('set role service_role');
    try {
      await query('update bookings set check_out=check_out+1 where id=$1', [row.id]);
      await db.exec("update property_rate_plans set turnover_buffer_days=1 where property_id='schema_probe'");
      assert.ok((await query('select * from automation_sends')).length);
    } finally { await db.exec('reset role'); }
    assert.equal(await version(),v+2);
    for (const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      try {
        for (const table of ['bookings','guests','automation_sends','property_rate_plans','property_rate_days']) {
          await rejected(() => query(`select * from ${table}`), '42501');
        }
        await rejected(() => cancel(row.id),'42501');
      } finally { await db.exec('reset role'); }
    }
  });
  await check('schema: canonical mutations leave the Guesty calendar mirror unchanged', async () => {
    assert.deepEqual(await query("select * from property_calendar_days where property_id='schema_probe'"),mirror);
  });
}
