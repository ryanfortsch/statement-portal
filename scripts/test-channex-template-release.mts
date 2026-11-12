/** Real PostgreSQL release transaction tests. Synthetic loopback database only. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
if (process.env.PGHOST !== '127.0.0.1' || process.env.PGDATABASE !== 'helm_synthetic_channex') throw Error('Synthetic loopback database required');
const psql = process.env.CHANNEX_TEST_PSQL || 'psql';
function sql(query: string) {
  const r = spawnSync(psql, ['-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], { input: `set statement_timeout='12s';\n${query}`, encoding: 'utf8' });
  if (r.status) throw Error(r.stderr); return r.stdout.trim();
}
const str = (s: string) => "'" + s.replaceAll("'", "''") + "'";
function blocked(q: string, reason: string) { assert.throws(() => sql(q), e => e instanceof Error && e.message.includes(reason)); }
const migration = readFileSync(new URL('../supabase/migrations/20261112233000_channex_template_release.sql', import.meta.url), 'utf8');
const scope = `insert into helm_channex_messages.scope(property_id,environment,remote_property,channel_id,provider)
 values('65_calderwood','production','320c5cb5-91e0-46af-b9b3-a3fc20b4631e',gen_random_uuid(),'Airbnb');`;
sql(scope); blocked(migration, 'template_release_install_requires_dormant_queue');
assert.equal(sql("select to_regclass('helm_channex_messages.template_releases') is null;"), 't');
sql('delete from helm_channex_messages.scope;');
const before = sql('select jsonb_agg(to_jsonb(r) order by id) from message_automations r;');
sql(migration);
assert.equal(sql('select jsonb_agg(to_jsonb(r) order by id) from message_automations r;'), before);
assert.equal(sql('select count(*) from helm_channex_messages.template_releases;'), '0');
assert.equal(sql(`select has_table_privilege('service_role','helm_channex_messages.template_releases','select,insert,update,delete')
 or has_function_privilege('anon','helm_channex_release_templates(uuid,uuid,text,text)','execute')
 or has_function_privilege('authenticated','helm_channex_release_templates(uuid,uuid,text,text)','execute')
 or has_function_privilege('service_role','helm_channex_messages.released_template_valid(message_automations)','execute');`), 'f');
const archive = JSON.parse(sql("select jsonb_build_object('id',id,'digest',rules_sha256) from helm_channex_messages.template_captures;"));
const releaseId = randomUUID();
const release = (id = releaseId, digest = archive.digest, actor = 'synthetic-owner') =>
 `select helm_channex_release_templates('${id}','${archive.id}',${str(digest)},${str(actor)});`;
blocked(release(releaseId, '0'.repeat(64)), 'template_release_capture_mismatch');
blocked(release(releaseId, archive.digest, ''), 'invalid_template_release');
for (const isolation of ['repeatable read', 'serializable']) blocked(`begin isolation level ${isolation}; ${release()}`, 'invalid_template_release');
for (const q of ["update properties set calendar_authority='helm' where id='65_calderwood';",
 "update properties set automations_enabled=true where id='65_calderwood';", scope])
 blocked(`begin; ${q} ${release()}`, 'template_release_not_dormant');
blocked('update message_automations set migration_policy=null;', 'prepared_template_frozen');
// Changed current rows never gain a release, even if a privileged maintenance job
// bypassed their freeze. Roll back this synthetic tamper after asserting refusal.
blocked(`begin; alter table message_automations disable trigger channex_prepared_rule_guard;
 update message_automations set body=body||'changed'; alter table message_automations enable trigger channex_prepared_rule_guard;
 ${release()}`, 'template_release_rules_changed');
assert.equal(sql('select count(*) from helm_channex_messages.template_releases;'), '0');
// Abort after the first updated row: the release receipt and all four edits roll back.
sql(`create function channex_synthetic_release_abort() returns trigger language plpgsql as $$begin
 if new.key='checkin_day' then raise exception 'synthetic_release_abort'; end if; return new; end$$;
 create trigger z_synthetic_release_abort after update on message_automations for each row execute function channex_synthetic_release_abort();`);
blocked(release(), 'synthetic_release_abort');
assert.equal(sql('select count(*) from helm_channex_messages.template_releases;'), '0');
assert.equal(sql('select jsonb_agg(to_jsonb(r) order by id) from message_automations r;'), before);
sql('drop trigger z_synthetic_release_abort on message_automations; drop function channex_synthetic_release_abort();');
// Two callers contend with identical IDs: one transaction creates the release,
// the other reuses it, without partial rules or duplicate audit records. Roll back
// after the test so the full runtime integration exercises a fresh real release.
const proc = spawn(psql, ['-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], { env: { ...process.env, PGAPPNAME: 'channex_release_race' }, stdio: ['pipe','pipe','pipe'] });
const done = new Promise<{ code: number | null; error: string }>(resolve => {
 let error = ''; proc.stdout.resume(); proc.stderr.on('data', d => { error += d; });
 proc.on('error', e => resolve({ code: -1, error: e.message })); proc.on('exit', code => resolve({ code, error }));
});
proc.stdin.end(`begin; ${release()} select pg_sleep(1.5); rollback;`);
try {
 let ready = false;
 for (let i=0; i<100; i++) {
  ready = sql("select count(*) from pg_stat_activity where application_name='channex_release_race' and wait_event='PgSleep';")==='1';
  if (ready) break; await new Promise(r=>setTimeout(r,20));
 }
 assert.ok(ready);
 // After the first rollback the waiting caller can create once, then an exact
 // replay in the same transaction reuses the receipt. All are rolled back here.
 const rows = sql(`begin; set local role service_role; ${release()} ${release()} rollback;`).split('\n').filter(Boolean).map(r=>JSON.parse(r));
 assert.equal(rows[0].reused, false); assert.equal(rows[1].reused, true);
} finally { const r = await done; assert.equal(r.code, 0, r.error); }
assert.equal(sql('select count(*) from helm_channex_messages.template_releases;'), '0');
// All subsequent assertions are inside rolled-back transactions, so the runtime
// test can perform its own committed release via the actual service RPC.
const success = JSON.parse(sql(`begin; set local role service_role; ${release()} rollback;`));
assert.equal(success.guestRules, 4); assert.equal(success.reused, false);
for (const q of ["update message_automations set body='changed' where audience='guest'",
 "update message_automations set enabled=false where audience='guest'", "delete from message_automations where audience='guest'",
 "update message_automations set migration_policy='{}'::jsonb where audience='guest'", "update message_automations set enabled=true where audience='cleaner'"])
 blocked(`begin; ${release()} ${q};`, 'prepared_template_frozen');
for (const q of ['delete from helm_channex_messages.template_releases', "update helm_channex_messages.template_releases set actor='changed'"])
 blocked(`begin; ${release()} ${q};`, 'template_capture_immutable');
for (const q of [release(randomUUID()), release(releaseId,archive.digest,'different-owner')])
 blocked(`begin; ${release()} ${q}`, 'template_release_conflict');
const untouched = sql(`begin; ${release()}
 select count(*) from message_automations where audience='guest' and helm_channex_messages.released_template_valid(message_automations);
 select count(*) from message_automations where audience='cleaner' and helm_channex_messages.prepared_template_valid(message_automations);
 select count(*) from automation_sends; select count(*) from helm_channex_messages.jobs;
 select calendar_authority||':'||automations_enabled from properties where id='65_calderwood'; rollback;`).split('\n');
assert.deepEqual(untouched.slice(1), ['4','2','0','0','guesty:false']);
console.log('PASS: actual template release, exact receipt replay, concurrency rollback, all-or-nothing update, permissions, tamper/freeze, dormant gates and unchanged source ownership');
