/** Disposable PostgreSQL only: real triggers/RPCs plus two-session ordering tests. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createCalderwoodTemplateCaptureReader } from '../src/lib/channex-messaging/template-retention.ts';
if (process.env.PGHOST !== '127.0.0.1' || process.env.PGDATABASE !== 'helm_synthetic_channex') throw Error('Synthetic loopback database required');
const psql = process.env.CHANNEX_TEST_PSQL || 'psql';
function sql(query: string) {
  const r = spawnSync(psql, ['-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], { input: `set statement_timeout='12s';\n${query}`, encoding: 'utf8' });
  if (r.status) throw Error(r.stderr); return r.stdout.trim();
}
const str = (s: string) => "'" + s.replaceAll("'", "''") + "'";
const id = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const bid = id(1), child = id(931), grandchild = id(932);
const history = `insert into automation_sends(booking_id,property_id,fire_at,status,planned_check_in,planned_check_out)
 values('${grandchild}','65_calderwood',now(),'cancelled','2035-01-01','2035-01-03')`;
const register = 'select helm_channex_message_register(payload) from channex_synthetic_registration_input';
function blocked(query: string, message: string) { assert.throws(() => sql(query), e => e instanceof Error && e.message.includes(message)); }
// Previous suite intentionally leaves immutable prepared rules. Reset only its
// disposable synthetic installation, never an operator or production workflow.
sql(`begin; alter table message_automations disable trigger channex_prepared_rule_guard;
 delete from message_automations; alter table message_automations enable trigger channex_prepared_rule_guard; commit;`);
// Legacy conflicting history present before the migration must prevent a claim.
sql(`select channex_synthetic_message_setup();
 insert into bookings(id,property_id,channel,status,check_in,check_out,duplicate_of)
 values('${child}','65_calderwood','airbnb','cancelled','2035-01-01','2035-01-03','${bid}'),
 ('${grandchild}','65_calderwood','airbnb','cancelled','2035-01-01','2035-01-03','${child}'); ${history};`);
const before = sql('select count(*) from automation_sends;');
for (const file of ['20261112230000_channex_message_family_guards.sql', '20261112231000_channex_template_retention.sql'])
  sql(readFileSync(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'));
assert.equal(sql('select count(*) from automation_sends;'), before);
assert.equal(sql(`select helm_channex_message_claim('${id(2)}',gen_random_uuid(),channex_synthetic_message_attempt());`), 'f');
assert.equal(sql('select count(*) from helm_channex_messages.template_captures;'), '0');
assert.equal(sql(`select has_function_privilege('service_role','helm_channex_messages.lock_family(uuid)','execute') or
 has_function_privilege('anon','helm_channex_capture_templates(text)','execute') or
 has_function_privilege('authenticated','helm_channex_read_template_capture(uuid,text)','execute') or
 has_table_privilege('service_role','helm_channex_messages.template_captures','select,insert,update,delete');`), 'f');

sql(`create function channex_synthetic_family_setup() returns void language plpgsql set timezone='UTC' as $$
 declare s helm_channex_messages.scope;
 begin
  if current_database()<>'helm_synthetic_channex' then raise exception 'synthetic_only'; end if;
  delete from helm_channex_messages.hold_events; delete from helm_channex_messages.jobs;
  delete from helm_channex_messages.scope; delete from automation_sends;
  delete from bookings where id in ('${child}','${grandchild}');
  perform channex_synthetic_message_setup();
  select * into s from helm_channex_messages.scope;
  delete from helm_channex_messages.jobs; delete from helm_channex_messages.scope; delete from automation_sends;
  insert into bookings(id,property_id,channel,status,check_in,check_out,duplicate_of)
  values('${child}','65_calderwood','airbnb','cancelled','2035-01-01','2035-01-03','${bid}'),
   ('${grandchild}','65_calderwood','airbnb','cancelled','2035-01-01','2035-01-03','${child}');
  insert into helm_channex_messages.scope select (s).*;
  update message_automations set delivery='ota_manual';
  update channex_synthetic_registration_input set payload=payload||helm_channex_message_schedule_context('${bid}')||
   jsonb_build_object('fireAt',to_char(clock_timestamp()+interval '1 hour','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'expiresAt',to_char(clock_timestamp()+interval '2 hours','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 end$$;`);
const setup = () => sql('select channex_synthetic_family_setup();');
setup();
for (const isolation of ['repeatable read', 'serializable']) {
 blocked(`begin isolation level ${isolation}; ${history}; commit`, 'message_read_committed_required');
 blocked(`begin isolation level ${isolation}; update bookings set check_out=check_out+1 where id='${bid}'; commit`, 'message_read_committed_required');
}
sql(history); blocked(register, 'message_registration_mismatch');
assert.equal(sql('select count(*) from helm_channex_messages.jobs;'), '0');
assert.equal(sql('select count(*) from automation_sends;'), '1');
blocked('delete from automation_sends', 'message_history_retained');
blocked(`update automation_sends set booking_id='${bid}'`, 'message_history_identity_immutable');
for (const query of [
 `update bookings set duplicate_of=null where id='${grandchild}'`,
 `update bookings set duplicate_of='${grandchild}' where id='${bid}'`,
 `delete from bookings where id='${child}'`,
 `update bookings set property_id='other_home' where id='${child}'`,
 `insert into bookings(id,property_id,channel,status,check_in,check_out,duplicate_of)
  values(gen_random_uuid(),'other_home','airbnb','confirmed','2035-01-01','2035-01-03','${child}')`,
]) blocked(query, 'message_family_reconciliation_required');
// Routine booking updates and unrelated homes remain writable.
sql(`update bookings set check_out=check_out+1 where id='${child}';
 insert into bookings(id,property_id,channel,status,check_in,check_out)
 values('${id(933)}','other_home','airbnb','confirmed','2035-01-01','2035-01-03');
 update bookings set duplicate_of='${id(934)}' where id='${id(933)}'; delete from bookings where id='${id(933)}';`);
setup(); sql(register); blocked(history, 'message_descendant_history_conflict');
blocked(`insert into automation_sends(booking_id,property_id,fire_at,planned_check_in,planned_check_out)
 values('${bid}','65_calderwood',now(),'2035-01-01','2035-01-03')`, 'message_history_conflict');
assert.equal(sql('select count(*) from automation_sends;'), '1');

async function holdTransaction(body: string, observer: () => void) {
 const proc = spawn(psql, ['-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], { env: { ...process.env, PGAPPNAME: 'channex_family_race' }, stdio: ['pipe','pipe','pipe'] });
 const done = new Promise<{ code: number | null; err: string }>(resolve => {
  let err = ''; proc.stderr.on('data', d => { err += d; }); proc.stdout.resume();
  proc.on('error', e => resolve({ code: -1, err: e.message })); proc.on('exit', code => resolve({ code, err }));
 });
 proc.stdin.end(`begin; set local statement_timeout='12s'; ${body}; select pg_sleep(1.5); commit;`);
 try {
  let ready = false;
  for (let i=0; i<100; i++) {
   ready = sql("select count(*) from pg_stat_activity where application_name='channex_family_race' and wait_event='PgSleep'")==='1';
   if (ready) break; await new Promise(r=>setTimeout(r,20));
  }
  assert.ok(ready, 'writer must acquire locks before contender starts'); observer();
 } finally { const result = await done; assert.equal(result.code, 0, result.err); }
}
setup();
await holdTransaction(history, () => blocked(register, 'message_registration_mismatch'));
assert.equal(sql('select count(*) from helm_channex_messages.jobs;'), '0');
assert.equal(sql('select count(*) from automation_sends;'), '1');
setup();
await holdTransaction(register, () => blocked(history, 'message_descendant_history_conflict'));
assert.equal(sql('select count(*) from helm_channex_messages.jobs;'), '1');
assert.equal(sql('select count(*) from automation_sends;'), '1');
// Registration-first can subsequently dispatch exactly once, despite a rejected import.
sql(`begin; update automation_sends set fire_at=now()-interval '1 minute';
 update helm_channex_messages.jobs set fire_at=now()-interval '1 minute',prepared_at=now()-interval '2 minutes',source_evidence_at=now()-interval '3 minutes'; commit;`);
const attempt = `select helm_channex_message_claim('${id(100)}',gen_random_uuid(),
 (helm_channex_message_read('${id(100)}')-array['sendId','contextRevision','state','attemptId','providerMessageId']))`;
await holdTransaction(attempt, () => blocked(history, 'message_descendant_history_conflict'));
assert.equal(sql('select state from helm_channex_messages.jobs;'), 'attempting');
assert.equal(sql(attempt), 'f');
// Cancellation still uses the same lock order after the new guards are installed.
setup(); sql(register);
sql(`begin; update automation_sends set fire_at=now()-interval '1 minute';
 update helm_channex_messages.jobs set fire_at=now()-interval '1 minute',prepared_at=now()-interval '2 minutes',source_evidence_at=now()-interval '3 minutes'; commit;`);
await holdTransaction(`select helm_move_booking('${bid}','2035-01-01','2035-01-03','cancelled','synthetic')`, () => assert.equal(sql(attempt), 'f'));
assert.equal(sql('select status from automation_sends;'), 'cancelled');
// Scope installation and a merge cannot pass one another with stale membership.
setup();
const scope = sql('select to_jsonb(s) from helm_channex_messages.scope s;');
const installScope = `insert into helm_channex_messages.scope select * from jsonb_populate_record(null::helm_channex_messages.scope,${str(scope)}::jsonb)`;
sql('delete from helm_channex_messages.scope;');
await holdTransaction(`update bookings set property_id='other_home' where id='${child}'`, () => blocked(installScope, 'message_family_invalid'));
assert.equal(sql('select count(*) from helm_channex_messages.scope;'), '0');
setup(); sql('delete from helm_channex_messages.scope;');
const newScope = sql(`select to_jsonb(s) from jsonb_populate_record(null::helm_channex_messages.scope,${str(scope)}::jsonb) s;`);
await holdTransaction(`insert into helm_channex_messages.scope select * from jsonb_populate_record(null::helm_channex_messages.scope,${str(newScope)}::jsonb)`,
 () => blocked(`update bookings set duplicate_of=null where id='${grandchild}'`, 'message_family_reconciliation_required'));
console.log('PASS: pre-existing history, both history/registration orders, one-use claim, cancellation, both scope-install/merge orders, retained history, isolation checks and unrelated-home behavior');

// Archive installed original rules, not a fabricated copy of current active rules.
sql(`delete from helm_channex_messages.jobs; delete from helm_channex_messages.scope; delete from automation_sends;
 delete from message_automations; update properties set calendar_authority='guesty',automations_enabled=false where id='65_calderwood';
 select helm_channex_prepare_templates(payload) from channex_synthetic_template_input;`);
const frozen = sql(`select jsonb_agg(to_jsonb(r) order by id) from message_automations r where property_id='65_calderwood';`);
const receipt = JSON.parse(sql("set role service_role; select helm_channex_capture_templates('synthetic-owner');"));
assert.equal(receipt.count, 6); assert.equal(receipt.reused, false);
const again = JSON.parse(sql("select helm_channex_capture_templates('synthetic-retry');"));
assert.equal(again.captureId, receipt.captureId); assert.equal(again.rulesSha256, receipt.rulesSha256); assert.equal(again.reused, true);
const reader = createCalderwoodTemplateCaptureReader(async(name,args)=>({ data: JSON.parse(sql(`set role service_role;
 select coalesce(public.${name}(${str(String(args.p_capture_id))}::uuid,${str(String(args.p_rules_sha256))}), 'null'::jsonb);`)), error: null }), { enabled: true });
const retained = await reader.load(receipt.captureId, receipt.rulesSha256); assert.equal(retained?.capturedRules.length, 6);
assert.equal(await reader.load(receipt.captureId, '0'.repeat(64)), null);
blocked('update helm_channex_messages.template_captures set actor=\'changed\'', 'template_capture_immutable');
blocked('delete from helm_channex_messages.template_captures', 'template_capture_immutable');
blocked('update message_automations set enabled=true', 'prepared_template_frozen');
assert.equal(sql(`select jsonb_agg(to_jsonb(r) order by id) from message_automations r where property_id='65_calderwood';`), frozen);
assert.equal(sql('select count(*) from automation_sends;'), '0');
assert.equal(sql('select count(*) from helm_channex_messages.jobs;'), '0');
assert.equal(sql('select count(*) from helm_channex_messages.scope;'), '0');
sql("update properties set calendar_authority='helm' where id='65_calderwood';");
blocked("select helm_channex_capture_templates('synthetic-owner')", 'template_capture_not_dormant');
assert.equal((await reader.load(receipt.captureId, receipt.rulesSha256))?.capturedRules.length, 6);
sql("update properties set calendar_authority='guesty' where id='65_calderwood';");
console.log('PASS: real retained bundle -> private production reader, exact retry, no latest fallback, immutable capture, role isolation; all six rules remain frozen and zero scope/jobs/messages');
