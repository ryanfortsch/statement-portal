/** Real PostgreSQL registration -> production worker -> fake provider. No live APIs. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createChannexScheduleStore, type ScheduleRegistration } from '../src/lib/channex-messaging/schedule-store.ts';
import { createChannexJobStore } from '../src/lib/channex-messaging/store.ts';
import { ChannexMessageWorker } from '../src/lib/channex-messaging/worker.ts';
import { ChannexMessageTransport } from '../src/lib/channex-messaging/transport.ts';
if (process.env.PGHOST !== '127.0.0.1' || process.env.PGDATABASE !== 'helm_synthetic_channex') throw Error('Synthetic loopback database required');
const psql = process.env.CHANNEX_TEST_PSQL || 'psql';
function sql(query: string) {
  const r = spawnSync(psql, ['-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8' });
  if (r.status) throw Error(r.stderr); return r.stdout.trim();
}
const str = (s: string) => "'" + s.replaceAll("'", "''") + "'";
const id = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const text = 'HELMTEST synthetic registered welcome', sha = createHash('sha256').update(text).digest('hex');
const revisionBefore = sql(`select helm_channex_messages.context('${id(2)}');`);
sql(readFileSync(new URL('../supabase/migrations/20261111190000_channex_schedule_registration.sql', import.meta.url), 'utf8'));
assert.equal(sql(`select helm_channex_messages.context('${id(2)}');`), revisionBefore);
assert.equal(sql(`select has_function_privilege('anon','helm_channex_message_register(jsonb)','execute') or
 has_function_privilege('authenticated','helm_channex_message_schedule_context(uuid)','execute') or
 has_function_privilege('service_role','helm_channex_messages.booking_context(uuid)','execute');`), 'f');
let lostRegister = false;
const rpc = async (name: string, args: Record<string, unknown>) => {
  const a = name === 'helm_channex_message_schedule_context' ? `${str(String(args.p_booking_id))}::uuid`
    : name === 'helm_channex_message_register' ? `${str(JSON.stringify(args.p_plan))}::jsonb`
    : name === 'helm_channex_message_read' ? `${str(String(args.p_send_id))}::uuid`
    : name === 'helm_channex_message_claim' ? `${str(String(args.p_send_id))}::uuid,${str(String(args.p_attempt_id))}::uuid,${str(JSON.stringify(args.p_attempt))}::jsonb`
    : name === 'helm_channex_message_finish' ? `${str(String(args.p_send_id))}::uuid,${str(String(args.p_attempt_id))}::uuid,${str(String(args.p_state))},${args.p_provider_id ? str(String(args.p_provider_id)) + '::uuid' : 'null'},${args.p_rejection_status ?? 'null'}` : null;
  assert.ok(a); const raw = sql(`set role service_role; select to_jsonb(public.${name}(${a}));`);
  if (name === 'helm_channex_message_register' && lostRegister) throw Error('Synthetic lost committed response');
  return { data: raw ? JSON.parse(raw) : null, error: null };
};
const schedules = createChannexScheduleStore(rpc, { enabled: true });
const jobs = createChannexJobStore(rpc);
function reset() {
  sql(`select channex_synthetic_message_setup(); delete from helm_channex_messages.jobs; delete from public.automation_sends;
   update public.message_automations set delivery='ota_manual';`);
}
async function intent(seconds = 3600): Promise<ScheduleRegistration> {
  const context = await schedules.context(id(1)); assert.ok(context);
  const fireAt = new Date(Date.now() + seconds * 1000).toISOString();
  return { ...context, sendId: id(100), bookingId: id(1), automationId: id(3), key: 'checkin_day',
    remoteBookingId: id(5), threadId: id(6), bodySha256: sha, fireAt,
    expiresAt: new Date(Date.parse(fireAt) + 3600000).toISOString() };
}
const counts = () => sql('select (select count(*) from automation_sends)||\':\'||(select count(*) from helm_channex_messages.jobs);');
// All four guest workflow identities use the same atomic path. These synthetic
// fire times exercise storage only, not the separate source-clock planner.
for (const key of ['booking_confirmed', 'pre_arrival', 'checkin_day', 'pre_checkout'] as const) {
  reset(); sql(`update message_automations set key=${str(key)},trigger=${str(key)};`);
  const candidate = { ...await intent(), key };
  assert.equal((await schedules.register(candidate)).state, 'created');
  assert.equal((await schedules.register(candidate)).state, 'existing');
  assert.equal(counts(), '1:1');
}
reset(); let plan = await intent();
assert.equal((await schedules.register(plan)).state, 'created'); assert.equal(counts(), '1:1');
assert.equal(sql(`select body_rendered is null and to_address is null and delivery_used='channex' from automation_sends;`), 't');
assert.equal((await schedules.register(plan)).state, 'existing'); assert.equal(counts(), '1:1');
assert.equal(sql(`select helm_channex_message_set_hold('${id(100)}',1,true,'synthetic');`), 't');
assert.equal((await schedules.register(plan)).state, 'existing');
assert.equal(sql('select held from helm_channex_messages.jobs;'), 't');
for (const patch of [{ sendId: id(101) }, { fireAt: new Date(Date.parse(plan.fireAt) + 1).toISOString() },
  { bodySha256: 'c'.repeat(64) }, { automationId: id(99) }, { routeGeneration: id(99) }]) {
  assert.equal((await schedules.register({ ...plan, ...patch })).state, 'uncertain'); assert.equal(counts(), '1:1');
}
reset(); plan = await intent(); lostRegister = true;
assert.equal((await schedules.register(plan)).state, 'uncertain'); lostRegister = false;
assert.equal(counts(), '1:1'); assert.equal((await schedules.register(plan)).state, 'existing');
// A failure of the second insert must roll back the first insert too.
reset(); plan = await intent();
sql(`create function public.channex_synthetic_reject_registration() returns trigger language plpgsql as $$begin raise exception 'synthetic job insert failure'; end$$;
 create trigger synthetic_reject_registration before insert on helm_channex_messages.jobs for each row execute function public.channex_synthetic_reject_registration();`);
assert.equal((await schedules.register(plan)).state, 'uncertain'); assert.equal(counts(), '0:0');
sql('drop trigger synthetic_reject_registration on helm_channex_messages.jobs; drop function public.channex_synthetic_reject_registration();');

for (const change of [
  "update helm_channex_messages.scope set enabled=false",
  "update helm_channex_messages.scope set generation=gen_random_uuid()",
  "update helm_channex_messages.scope set source_evidence_id=gen_random_uuid()",
  "update helm_channex_messages.scope set source_drained_at=clock_timestamp()",
  "update properties set calendar_authority='guesty' where id='65_calderwood'",
  "update properties set automations_enabled=false where id='65_calderwood'",
  `update bookings set status='cancelled' where id='${id(1)}'`,
  `update bookings set check_out='2035-01-04' where id='${id(1)}'`,
  `update bookings set duplicate_of=gen_random_uuid() where id='${id(1)}'`,
  "update message_automations set enabled=false",
  "update message_automations set configured_in_ota=true",
  "update message_automations set body='Changed synthetic template'",
  "update message_automations set audience='cleaner'",
  "update property_access set smart_lock_code='changed-synthetic'",
  `update helm_airbnb_bookings.bookings set check_out='2035-01-04' where canonical_id='${id(1)}'`,
]) {
  reset(); plan = await intent(); sql(change);
  assert.equal((await schedules.register(plan)).state, 'uncertain', change); assert.equal(counts(), '0:0');
}
for (const state of ['sent', 'sending', 'failed', 'cancelled', 'awaiting_approval', 'scheduled']) {
  reset(); plan = await intent();
  sql(`insert into automation_sends(booking_id,property_id,automation_key,fire_at,status,planned_check_in,planned_check_out)
   values('${id(1)}','65_calderwood','checkin_day',now(),'${state}','2035-01-01','2035-01-03');`);
  assert.equal((await schedules.register(plan)).state, 'uncertain', state); assert.equal(counts(), '1:0');
}
reset(); plan = await intent();
sql(`insert into automation_sends(booking_id,property_id,fire_at,planned_check_in,planned_check_out)
 values('${id(1)}','65_calderwood',now(),'2035-01-01','2035-01-03');`);
assert.equal((await schedules.register(plan)).state, 'uncertain'); assert.equal(counts(), '1:0');
reset(); plan = await intent();
for (const patch of [{ fireAt: '2000-01-01T00:00:00Z', expiresAt: '2000-01-01T01:00:00Z' },
  { sourceEvidenceAt: '2035-01-01T00:00:00Z' }, { threadId: 'invalid' }, { key: 'cleaner_reminder' },
  { fireAt: '2026-11-14 20:00:00' }, { extra: 'plaintext must not enter this RPC' }]) {
  await assert.rejects(rpc('helm_channex_message_register', { p_plan: { ...plan, ...patch } }));
  assert.equal(counts(), '0:0');
}
// Frozen migrated rules still cannot enter this path, even with an active synthetic scope.
reset(); plan = await intent();
sql(`begin; delete from helm_channex_messages.scope; delete from message_automations; update properties set calendar_authority='guesty',automations_enabled=false where id='65_calderwood';
 select helm_channex_prepare_templates(payload) from channex_synthetic_template_input; commit;`);
assert.equal(await schedules.context(id(1)), null);
assert.equal((await schedules.register(plan)).state, 'uncertain'); assert.equal(counts(), '0:0');
// Restore the fixture with its immutable prepared rules rolled back by removing only
// the synthetic installation in a disposable database, never in production.
sql('alter table message_automations disable trigger channex_prepared_rule_guard; delete from message_automations; alter table message_automations enable trigger channex_prepared_rule_guard;');
reset(); plan = await intent(2);
assert.equal((await schedules.register(plan)).state, 'created');
sql('select pg_sleep(2.1);');
assert.equal((await schedules.register(plan)).state, 'existing'); // due retry does not replay the insert
let posts = 0;
const messageId = randomUUID(), relation = (type: string, id: string) => ({ data: { type, id } });
const scope = { environment: 'production' as const, propertyId: '320c5cb5-91e0-46af-b9b3-a3fc20b4631e', channelId: id(4), provider: 'Airbnb' as const };
const transport = new ChannexMessageTransport({ scope, apiKey: 'synthetic-only', sendEnabled: true, fetcher: async (_url, init) => {
  const msg = { id: messageId, type: 'message', attributes: { message: text, sender: 'property', attachments: [] }, relationships: { message_thread: relation('message_thread', id(6)) } };
  if (init.method === 'POST') { posts++; return Response.json({ data: msg }); }
  if (_url.includes('/messages?')) return Response.json({ data: [msg], meta: { total: 1, page: 1, limit: 100 } });
  return Response.json({ data: { id: id(6), type: 'message_thread', attributes: { provider: 'Airbnb', is_closed: false },
    relationships: { property: relation('property', scope.propertyId), channel: relation('channel', id(4)), booking: relation('booking', id(5)) } } });
} });
const worker = new ChannexMessageWorker({ store: jobs, transport, enabled: true });
const render = async () => ({ text, contextRevision: plan.contextRevision });
assert.equal((await worker.dispatch(plan.sendId, render)).state, 'accepted');
assert.equal((await worker.dispatch(plan.sendId, render)).state, 'needs_reconciliation');
assert.equal((await schedules.register(plan)).state, 'existing');
assert.equal((await worker.reconcile(plan.sendId)).state, 'recorded'); assert.equal(posts, 1);
// Registration winning the race still cannot survive a later cancellation.
reset(); plan = await intent(2);
assert.equal((await schedules.register(plan)).state, 'created');
sql(`select helm_move_booking('${id(1)}','2035-01-01','2035-01-03','cancelled','synthetic'); select pg_sleep(2.1);`);
assert.equal((await schedules.register(plan)).state, 'existing');
assert.equal((await worker.dispatch(plan.sendId, render)).state, 'blocked');
assert.equal(posts, 1); assert.equal(sql('select status from automation_sends;'), 'cancelled');
// Leave one reusable, future intent for the two-process registration tests.
reset(); plan = await intent();
sql(`create table channex_synthetic_registration_input(payload jsonb); insert into channex_synthetic_registration_input values(${str(JSON.stringify(plan))}::jsonb);`);
console.log('PASS: atomic registration, exact retry, lost response, rollback, changed context, histories, source gates, due retry and register-to-worker one-use delivery');
