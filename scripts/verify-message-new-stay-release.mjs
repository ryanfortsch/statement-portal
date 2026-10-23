import { verifyAirbnbMessageQueue } from './verify-airbnb-message-queue.mjs';
// Disposable PostgreSQL only. Release never enables a sender or calls a provider.
import assert from 'node:assert/strict';
import { verifyNewStayWorkers } from './verify-message-new-stay-workers.mjs';
import { readFileSync } from 'node:fs';
export async function verifyNewStayRelease({db,scalar,fresh,tick}) {
 let count=0;const pass=s=>{count++;console.log('PASS new stay release: '+s);};
 await db.query(readFileSync(new URL('../docs/guesty-exit/staging-storage/message-new-stay-release.sql',import.meta.url),'utf8'));
 const snapshot=f=>scalar('select automation_new_stay_queue_snapshot($1) data',[f.booking]);
 const release=(f,token)=>scalar("select automation_new_stay_queue_release($1,$2,'HELMTEST-owner') data",[f.booking,token]);
 const states=f=>scalar('select jsonb_agg(to_jsonb(s) order by id) data from automation_sends s where booking_id=$1',[f.booking]);
 const f=await fresh(),token=await snapshot(f),before=await states(f);
 assert.equal(await release(f,token),true);
 const after=await states(f);assert.equal(after.length,6);assert.ok(after.every(s=>s.status==='scheduled'));
 assert.deepEqual(after.map(s=>[s.id,s.fire_at,s.delivery_used]),before.map(s=>[s.id,s.fire_at,s.delivery_used]));
 assert.equal(await scalar("select count(*)::int data from automation_hold_events h join automation_sends s on s.id=h.send_id where s.booking_id=$1 and h.action='release'",[f.booking]),6);
 assert.equal(await release(f,token),false);assert.equal(await release(f,await snapshot(f)),false);await tick();assert.deepEqual(await states(f),after);
 pass('initial release preserves all six schedules and rails; replay and preparation retry cannot release twice');
 const key=after.find(s=>s.automation_key==='new-key_code');
 assert.equal(await scalar("select automation_set_hold($1,'HELMTEST-calderwood','HELMTEST-owner',true,$2) data",[key.id,key.updated_at]),true);
 const held=await states(f);await release(f,await snapshot(f));await tick();assert.deepEqual(await states(f),held);
 pass('operator key-code hold survives later release and preparation retries');
 const stale=await fresh(),old=await snapshot(stale);
 await db.query("update automation_sends set updated_at=clock_timestamp() where booking_id=$1",[stale.booking]);
 const changed=await states(stale);assert.equal(await release(stale,old),false);assert.deepEqual(await states(stale),changed);
 pass('stale reviewed snapshot releases none of the six');
 const operator=await fresh(),jobs=await states(operator);
 const opkey=jobs.find(s=>s.automation_key==='new-key_code');
 assert.equal(await scalar("select automation_set_hold($1,'HELMTEST-calderwood','HELMTEST-owner',false,$2) data",[opkey.id,opkey.updated_at]),true);
 const updated=await scalar('select updated_at::text data from automation_sends where id=$1',[opkey.id]);
 assert.equal(await scalar("select automation_set_hold($1,'HELMTEST-calderwood','HELMTEST-owner',true,$2) data",[opkey.id,updated]),true);
 const manual=await states(operator);assert.equal(await release(operator,await snapshot(operator)),false);assert.deepEqual(await states(operator),manual);
 pass('an operator hold before initial release blocks the entire batch without clearing it');
 const expired=await fresh();await db.query("update helm_channex_revisions.message_timing_policies set expires_at=clock_timestamp()-interval '1 second' where booking_id=$1",[expired.booking]);
 assert.equal(await release(expired,await snapshot(expired)),false);assert.ok((await states(expired)).every(s=>s.status==='held'));
 const cancelled=await fresh();await db.query("update bookings set status='cancelled' where id=$1",[cancelled.booking]);assert.equal(await release(cancelled,await snapshot(cancelled)),false);
 pass('expired timing and cancellation prevent release even with a fresh snapshot');
 const fail=await fresh(),ftoken=await snapshot(fail),initial=await states(fail);
 await db.query(`create function helmtest_fail_release() returns trigger language plpgsql as $$ begin if new.booking_id='${fail.booking}'::uuid and new.released_at is not null then raise exception 'HELMTEST release failure'; end if; return new; end $$;
 create trigger helmtest_fail_release before update on helm_channex_revisions.message_new_stay_queues for each row execute function helmtest_fail_release();`);
 await assert.rejects(release(fail,ftoken),/HELMTEST release failure/);assert.deepEqual(await states(fail),initial);
 assert.equal(await scalar('select count(*)::int data from automation_hold_events h join automation_sends s on s.id=h.send_id where s.booking_id=$1',[fail.booking]),0);
 await db.query('drop trigger helmtest_fail_release on helm_channex_revisions.message_new_stay_queues; drop function helmtest_fail_release()');assert.equal(await release(fail,ftoken),true);
 pass('final journal failure rolls back all releases and audit entries; retry succeeds once');
 for(const role of ['anon','authenticated','service_role']){
  await db.query('set role '+role);try{
   await assert.rejects(db.query('select automation_new_stay_queue_snapshot($1)',[f.booking]),/permission denied/);
   await assert.rejects(db.query("select automation_new_stay_queue_release($1,$2,'HELMTEST')",[f.booking,token]),/permission denied/);
  }finally{await db.query('reset role');}
 }
 assert.equal(await scalar("select enabled data from automation_channex_routes where property_id='HELMTEST-calderwood'"),false);
 assert.equal(await scalar("select automations_enabled data from properties where id='HELMTEST-calderwood'"),false);
 assert.equal(await scalar("select count(*)::int data from automation_cleaner_batches where property_id='HELMTEST-calderwood' and enabled"),0);
 pass('release remains owner-only and cannot activate any provider or cleaner sender');
 console.log(`PASS ${count} additional new-stay release PostgreSQL scenarios; no live sends`);
 await verifyNewStayWorkers({db,scalar,fresh});
 await verifyAirbnbMessageQueue({db,scalar});
}
