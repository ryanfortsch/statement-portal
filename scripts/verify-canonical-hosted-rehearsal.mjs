import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {buildCanonicalPilotInstall} from './build-canonical-pilot-install.mjs';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),db=new PGlite();
const sql=readFileSync(new URL('../docs/guesty-exit/staging-storage/canonical-hosted-rehearsal.sql',import.meta.url),'utf8');
try {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema helm_cleaner_rehearsal; create table helm_cleaner_rehearsal.delivery(id int,version int); insert into helm_cleaner_rehearsal.delivery values(1,6);');
  await db.exec(buildCanonicalPilotInstall().sql);
  // A late assertion failure must roll back even the property/scope seeds.
  await assert.rejects(()=>db.exec(sql.replace("if cleaner_after is distinct from cleaner_before then","if true then")),/cleaner rehearsal changed/);
  await db.exec('rollback');
  assert.equal((await db.query('select count(*)::int n from properties')).rows[0].n,0);
  const first=await db.exec(sql),repeat=await db.exec(sql);
  assert.deepEqual(repeat.at(-1).rows,first.at(-1).rows);
  assert.deepEqual(first.at(-1).rows[0],{check_name:'Fictional database cycle',final_booking_status:'cancelled',durable_receipts:4,cancelled_test_messages:6,enabled_senders:0});
  assert.equal((await db.query('select version from helm_cleaner_rehearsal.delivery')).rows[0].version,6);
  assert.equal((await db.query('select count(*)::int n from automation_sends where to_address is not null or body_rendered is not null or provider_message_id is not null')).rows[0].n,0);
  await db.exec("update properties set automations_enabled=true where id='HELMTEST-calderwood'");
  await assert.rejects(()=>db.exec(sql),/fictional-only/);await db.exec('rollback');
  console.log('PASS: hosted rehearsal artifact; late rollback, create/change/cancel, duplicate/stale replay, six cancelled waiting rows, repeatability, preserved cleaner state, no contacts/sends, enabled-sender refusal. Local only.');
} catch(error){console.error('FAIL:',error.message);process.exitCode=1;} finally {await db.close();}
