/** Disposable PostgreSQL + coordinator + real adapters/worker + fake provider only. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { registerCalderwoodStaySchedules } from '../src/lib/channex-messaging/schedule-coordinator.ts';
import { createChannexScheduleStore } from '../src/lib/channex-messaging/schedule-store.ts';
import { createChannexJobStore } from '../src/lib/channex-messaging/store.ts';
import { ChannexMessageWorker } from '../src/lib/channex-messaging/worker.ts';
import { ChannexMessageTransport } from '../src/lib/channex-messaging/transport.ts';
import { renderTemplate } from '../src/lib/automations-core.ts';
import { MESSAGE_RULE_FIELDS } from '../src/lib/channex-messaging/preparation-rules.ts';
import { MESSAGE_SCHEDULE_LEDGER_FIELDS } from '../src/lib/channex-messaging/schedule-plan.ts';
import { syntheticScheduleSnapshot, syntheticTimingEvidence, scheduleFixtureId as id } from '../src/lib/__tests__/fixtures/channex-schedule-snapshot.ts';

if (process.env.PGHOST !== '127.0.0.1' || process.env.PGDATABASE !== 'helm_synthetic_channex') throw Error('Synthetic loopback database required');
function sql(query: string) {
  const r = spawnSync(process.env.CHANNEX_TEST_PSQL || 'psql', ['-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8' });
  if (r.status) throw Error(r.stderr); return r.stdout.trim();
}
const str = (s: string) => "'" + s.replaceAll("'", "''") + "'";
let lost = false, mutateBeforeRegister = false, registrations = 0;
const rpc = async (name: string, args: Record<string, unknown>) => {
  const a = name === 'helm_channex_message_schedule_context' ? `${str(String(args.p_booking_id))}::uuid`
    : name === 'helm_channex_message_register' ? `${str(JSON.stringify(args.p_plan))}::jsonb`
    : name === 'helm_channex_message_read' ? `${str(String(args.p_send_id))}::uuid`
    : name === 'helm_channex_message_claim' ? `${str(String(args.p_send_id))}::uuid,${str(String(args.p_attempt_id))}::uuid,${str(JSON.stringify(args.p_attempt))}::jsonb`
    : name === 'helm_channex_message_finish' ? `${str(String(args.p_send_id))}::uuid,${str(String(args.p_attempt_id))}::uuid,${str(String(args.p_state))},${args.p_provider_id ? str(String(args.p_provider_id)) + '::uuid' : 'null'},${args.p_rejection_status ?? 'null'}` : null;
  assert.ok(a);
  if (name === 'helm_channex_message_register') {
    registrations++;
    if (mutateBeforeRegister) sql(`update bookings set status='cancelled' where id='${id(1)}';`);
  }
  const raw = sql(`set role service_role; select to_jsonb(public.${name}(${a}));`);
  if (name === 'helm_channex_message_register' && lost) throw Error('Synthetic lost committed response');
  return { data: raw ? JSON.parse(raw) : null, error: null };
};
const store = createChannexScheduleStore(rpc, { enabled: true }), jobs = createChannexJobStore(rpc);
let fixture = syntheticScheduleSnapshot(Date.now());
function setup() {
  fixture = syntheticScheduleSnapshot(Date.now());
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  fixture.booking.start = fixture.clocks.start = day(14); fixture.booking.end = fixture.clocks.end = day(18);
  fixture.clocks.confirmedAt = new Date(Date.now() - 1800_000 + 8000).toISOString();
  // Active rules here are independent SYNTHETIC fixture rows. There is no template
  // release operation, no bypass of the production frozen-template trigger, and no
  // assertion that source clocks have a production provenance loader yet.
  sql(`select channex_synthetic_message_setup(); delete from helm_channex_messages.jobs;
    delete from automation_sends; delete from message_automations;
    update bookings set check_in=${str(day(14))},check_out=${str(day(18))} where id='${id(1)}';
    update helm_airbnb_bookings.bookings set check_in=${str(day(14))},check_out=${str(day(18))} where canonical_id='${id(1)}';`);
  for (const r of fixture.currentRules.filter(r => r.audience === 'guest')) {
    sql(`insert into message_automations(${MESSAGE_RULE_FIELDS}) select ${MESSAGE_RULE_FIELDS}
      from jsonb_populate_record(null::message_automations,${str(JSON.stringify(r))}::jsonb);`);
  }
  const context = JSON.parse(sql(`select to_jsonb(helm_channex_message_schedule_context('${id(1)}'));`));
  fixture.timingEvidence = syntheticTimingEvidence(fixture, context, Date.now());
  registrations = 0;
}
const rows = (table: string, fields: string) => JSON.parse(sql(`select coalesce(jsonb_agg(x),'[]'::jsonb) from (select ${fields} from ${table}) x;`));
const load = async () => ({ ...structuredClone(fixture), observedAt: new Date().toISOString(),
  currentRules: rows('message_automations', MESSAGE_RULE_FIELDS),
  ledger: rows('automation_sends', MESSAGE_SCHEDULE_LEDGER_FIELDS) });
const run = () => registerCalderwoodStaySchedules(id(1), { store, load, now: Date.now }, { enabled: true, expiresAfterMs: 1800_000 });
const counts = () => sql("select (select count(*) from automation_sends)||':'||(select count(*) from helm_channex_messages.jobs);");
setup();
// Rejected source substitutes must not reach SQL registration at all.
const verifiedTiming = structuredClone(fixture.timingEvidence);
for (const evidence of [null, { ...verifiedTiming, kind: 'channex_raw_message' },
  { ...verifiedTiming, kind: 'channex_inserted_at' }]) {
  fixture.timingEvidence = evidence as typeof fixture.timingEvidence;
  assert.equal((await run()).state, 'timing_review'); assert.equal(counts(), '0:0'); assert.equal(registrations, 0);
}
fixture.timingEvidence = verifiedTiming;
const first = await run(); assert.equal(first.state, 'complete'); assert.equal(counts(), '4:4');
assert.ok(first.outcomes.every(o => o.state === 'created')); assert.equal(registrations, 4);
assert.equal(sql('select bool_and(body_rendered is null and to_address is null) from automation_sends;'), 't');
assert.equal(sql("select bool_and(automation_key not like 'cleaner_%') from automation_sends;"), 't');
assert.ok((await run()).outcomes.every(o => o.state === 'existing_schedule')); assert.equal(registrations, 4);

const sendId = first.outcomes[0].sendId!, text = renderTemplate(fixture.capturedRules[0].body, fixture.merge).text;
const fireAt = sql(`select fire_at from automation_sends where id=${str(sendId)}::uuid;`);
await setTimeout(Math.max(0, Date.parse(fireAt) - Date.now() + 100));
let posts = 0;
const messageId = randomUUID(), relation = (type: string, id: string) => ({ data: { type, id } });
const scope = { environment: 'production' as const, propertyId: '320c5cb5-91e0-46af-b9b3-a3fc20b4631e', channelId: id(4), provider: 'Airbnb' as const };
const transport = new ChannexMessageTransport({ scope, apiKey: 'synthetic-only', sendEnabled: true, fetcher: async (_url, init) => {
  const msg = { id: messageId, type: 'message', attributes: { message: text, sender: 'property', attachments: [] }, relationships: { message_thread: relation('message_thread', id(6)) } };
  if (init.method === 'POST') { posts++; assert.equal(JSON.parse(String(init.body)).message.message, text); return Response.json({ data: msg }); }
  if (_url.includes('/messages?')) return Response.json({ data: [msg], meta: { total: 1, page: 1, limit: 100 } });
  return Response.json({ data: { id: id(6), type: 'message_thread', attributes: { provider: 'Airbnb', is_closed: false },
    relationships: { property: relation('property', scope.propertyId), channel: relation('channel', id(4)), booking: relation('booking', id(5)) } } });
} });
const worker = new ChannexMessageWorker({ store: jobs, transport, enabled: true });
const context = (await store.context(id(1)))!;
assert.equal((await worker.dispatch(sendId, async () => ({ text, contextRevision: context.contextRevision }))).state, 'accepted');
assert.equal((await worker.dispatch(sendId, async () => ({ text, contextRevision: context.contextRevision }))).state, 'needs_reconciliation');
assert.equal((await worker.reconcile(sendId)).state, 'recorded'); assert.equal(posts, 1);
assert.equal((await run()).outcomes[0].state, 'already_sent'); assert.equal(counts(), '4:4');

setup(); lost = true;
assert.equal((await run()).state, 'uncertain'); assert.equal(registrations, 1); assert.equal(counts(), '1:1');
lost = false;
const recovered = await run(); assert.equal(recovered.state, 'complete');
assert.equal(recovered.outcomes[0].state, 'existing_schedule'); assert.equal(counts(), '4:4'); assert.equal(registrations, 4);

setup(); mutateBeforeRegister = true;
assert.equal((await run()).state, 'uncertain'); assert.equal(counts(), '0:0');
mutateBeforeRegister = false;

setup(); const concurrent = await Promise.all([run(), run()]);
assert.ok(concurrent.every(r => r.state === 'complete')); assert.equal(counts(), '4:4');
const heldId = sql("select id from automation_sends where automation_key='booking_confirmed';");
assert.equal(sql(`select helm_channex_message_set_hold(${str(heldId)},1,true,'synthetic');`), 't');
assert.equal((await run()).outcomes[0].state, 'existing_schedule');
assert.equal(sql(`select held from helm_channex_messages.jobs where send_id=${str(heldId)}::uuid;`), 't');
assert.equal((await worker.dispatch(heldId, async () => ({ text, contextRevision: context.contextRevision }))).state, 'blocked');
sql(`select helm_move_booking('${id(1)}',${str(fixture.booking.start)},${str(fixture.booking.end)},'cancelled','synthetic');`);
assert.equal((await run()).state, 'unavailable'); assert.equal(counts(), '4:4');
assert.equal(sql("select bool_and(status='cancelled') from automation_sends;"), 't');
assert.equal(posts, 1);
console.log('PASS: source-offset planner -> coordinator -> atomic SQL -> worker -> one fake POST/readback; restart, concurrent runs, holds and cancellation');
