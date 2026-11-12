/** Disposable synthetic PostgreSQL only. Run after test-channex-release-guards.
 * This fixture establishes a hypothetical reviewed release directly. It is NOT
 * an implementation/test of a production release action, and never calls a provider.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { scheduleRetainedCalderwoodStay } from '../src/lib/channex-messaging/schedule-runtime.ts';
import { reviewCalderwoodTimingBinding } from '../src/lib/channex-messaging/timing-provider-review.ts';
import { createChannexTimingBindingStore } from '../src/lib/channex-messaging/timing-binding-store.ts';
import { createCalderwoodScheduleInputReader } from '../src/lib/channex-messaging/schedule-inputs.ts';
import { createChannexJobStore } from '../src/lib/channex-messaging/store.ts';
import { ChannexMessageWorker } from '../src/lib/channex-messaging/worker.ts';
import { ChannexMessageTransport } from '../src/lib/channex-messaging/transport.ts';
import { renderTemplate } from '../src/lib/automations-core.ts';
import { MESSAGE_RULE_FIELDS } from '../src/lib/channex-messaging/preparation-rules.ts';
import { syntheticTimingProvider } from '../src/lib/__tests__/fixtures/channex-timing-provider.ts';
if (process.env.PGHOST !== '127.0.0.1' || process.env.PGDATABASE !== 'helm_synthetic_channex') throw Error('Synthetic loopback database required');
const psql = process.env.CHANNEX_TEST_PSQL || 'psql';
function sql(query: string) {
  const r = spawnSync(psql, ['-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8' });
  if (r.status) throw Error(r.stderr); return r.stdout.trim();
}
const str = (s: string) => "'" + s.replaceAll("'", "''") + "'";
const bid = '90000000-0000-4000-8000-000000000901', remote = randomUUID(), thread = randomUUID();
sql(`delete from helm_channex_messages.timing_bindings;
 delete from helm_airbnb_bookings.bookings where canonical_id='${bid}';
 select channex_synthetic_timing_setup();
 update bookings set guest_name='Synthetic Guest' where id='${bid}';`);
// Reset only this disposable fixture's active rules from its immutable archive.
sql(`begin; alter table message_automations disable trigger channex_prepared_rule_guard;
 delete from message_automations;
 insert into message_automations(${MESSAGE_RULE_FIELDS}) select ${MESSAGE_RULE_FIELDS}
 from jsonb_populate_recordset(null::message_automations,(select rules from helm_channex_messages.template_captures));
 alter table message_automations enable trigger channex_prepared_rule_guard; commit;`);
const archive = JSON.parse(sql('select jsonb_build_object(\'id\',id,\'digest\',rules_sha256) from helm_channex_messages.template_captures;'));
const source = JSON.parse(sql(`set role service_role; select helm_channex_capture_source_timing(
 channex_synthetic_timing_plan(),clock_timestamp()-interval '5 seconds',clock_timestamp(),'synthetic-runtime-owner');`));
const request = { bookingId: bid, bindingId: randomUUID(), templateCaptureId: archive.id, templateDigest: archive.digest };
let lostResponse = false, writes = 0, reads = 0;
const rpc = async (name: string, args: Record<string, unknown>) => {
  const params = name === 'helm_channex_message_schedule_context' ? str(String(args.p_booking_id))+'::uuid'
    : name === 'helm_channex_message_schedule_inputs' ? str(String(args.p_booking_id))+'::uuid,'+str(String(args.p_binding_id))+'::uuid'
    : name === 'helm_channex_read_template_capture' ? str(String(args.p_capture_id))+'::uuid,'+str(String(args.p_rules_sha256))
    : name === 'helm_channex_timing_review_snapshot' ? str(String(args.p_capture_id))+'::uuid,'+str(String(args.p_booking_id))+'::uuid'
    : name === 'helm_channex_message_register' ? str(JSON.stringify(args.p_plan))+'::jsonb'
    : name === 'helm_channex_timing_binding_review' ? str(JSON.stringify(args.p_intent))+'::jsonb,'+str(String(args.p_actor))
    : name === 'helm_channex_message_read' ? str(String(args.p_send_id))+'::uuid'
    : name === 'helm_channex_message_claim' ? str(String(args.p_send_id))+'::uuid,'+str(String(args.p_attempt_id))+'::uuid,'+str(JSON.stringify(args.p_attempt))+'::jsonb'
    : name === 'helm_channex_message_finish' ? str(String(args.p_send_id))+'::uuid,'+str(String(args.p_attempt_id))+'::uuid,'+str(String(args.p_state))+','
      +(args.p_provider_id ? str(String(args.p_provider_id))+'::uuid' : 'null')+','+(args.p_rejection_status ?? 'null') : null;
  assert.ok(params, 'Only explicit service RPCs are allowed');
  const raw = sql(`set role service_role; select to_jsonb(public.${name}(${params}));`);
  if (name === 'helm_channex_message_register') { writes++; if (lostResponse) throw Error('Synthetic committed response lost'); }
  return { data: raw ? JSON.parse(raw) : null, error: null };
};
const credentials = async () => ({ guestyToken: 'synthetic-guesty', channexKey: 'synthetic-channex' });
let provider!: ReturnType<typeof syntheticTimingProvider>;
const fetcher: typeof fetch = async (url, init) => {
  reads++; assert.equal(init?.method, 'GET'); assert.equal(init.body, undefined);
  const path = new URL(String(url)).pathname;
  return Response.json(path.includes('/reservations/') ? provider.v2 : path.endsWith('/reservations-v3') ? provider.v3
    : path.includes('/bookings/') ? provider.booking : path.endsWith('/message_threads')
      ? { data: [provider.thread.data], meta: { page: 1, limit: 100, total: 1 } } : provider.thread);
};
const run = () => scheduleRetainedCalderwoodStay(request, { rpc, credentials, fetcher }, { enabled: true, expiresAfterMs: 1800_000 });
assert.equal((await run()).state, 'unavailable'); assert.equal(reads, 0); assert.equal(writes, 0);

// Synthetic handover fixture only. No corresponding production action ships.
sql(`update properties set calendar_authority='helm',automations_enabled=true where id='65_calderwood';
 insert into helm_channex_messages.scope(property_id,environment,remote_property,channel_id,provider,enabled,source_stopped_at,source_drained_at,source_evidence_id)
 values('65_calderwood','production','320c5cb5-91e0-46af-b9b3-a3fc20b4631e',gen_random_uuid(),'Airbnb',true,clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour',gen_random_uuid());
 insert into helm_airbnb_bookings.bookings(remote_id,canonical_id,code,environment,remote_property,generation,latest_at,latest_revision,check_in,check_out,status)
 select '${remote}',id,external_confirmation_code,'production','320c5cb5-91e0-46af-b9b3-a3fc20b4631e',1,clock_timestamp(),gen_random_uuid(),check_in,check_out,status from bookings where id='${bid}';`);
async function bind() {
  const load = async () => (await rpc('helm_channex_timing_review_snapshot', { p_capture_id: source.captureId, p_booking_id: bid })).data;
  const s = await load();
  provider = syntheticTimingProvider(s.capture.row, { ...s.route, threadId: thread, channelId: s.scope.channelId });
  return reviewCalderwoodTimingBinding({ bindingId: request.bindingId, captureId: source.captureId, bookingId: bid }, 'synthetic-runtime-owner',
    { load, credentials, fetcher, store: createChannexTimingBindingStore(rpc, { enabled: true }) }, { enabled: true });
}
assert.equal((await bind()).state, 'created');
const frozen = await run(); assert.equal(frozen.state, 'complete');
assert.ok(frozen.outcomes.filter(o => o.key !== 'booking_confirmed').every(o => o.state === 'release_required'));
assert.equal(writes, 0);
// Deliberate fixture transition of CURRENT rules; the actual immutable archive
// remains intact. Never use trigger bypasses for a production template release.
sql(`begin; alter table message_automations disable trigger channex_prepared_rule_guard;
 update message_automations set enabled=true,configured_in_ota=false,send_mode='auto',migration_policy=null
 where property_id='65_calderwood' and audience='guest';
 alter table message_automations enable trigger channex_prepared_rule_guard; commit;
 delete from helm_channex_messages.timing_bindings;`);
request.bindingId = randomUUID(); assert.equal((await bind()).state, 'created');
provider.v2.plannedArrival = '22:00'; assert.equal((await run()).state, 'unavailable'); assert.equal(writes, 0);
provider.v2.plannedArrival = null;
lostResponse = true; const uncertain = await run(); assert.equal(uncertain.state, 'uncertain'); assert.equal(writes, 1);
assert.equal(sql('select count(*) from helm_channex_messages.jobs;'), '1');
lostResponse = false; const completed = await run(); assert.equal(completed.state, 'complete');
assert.equal(writes, 3); assert.equal(sql('select count(*) from helm_channex_messages.jobs;'), '3');
assert.equal((await run()).outcomes.filter(o => o.state === 'created').length, 0); assert.equal(writes, 3);

// The real worker can consume one registered due job; only a fake provider sees
// the synthetic rendered text. This proves plumbing, not live delivery or release.
const sendId = sql("select send_id from helm_channex_messages.jobs where automation_key='checkin_day';");
sql(`begin; update automation_sends set fire_at=now()-interval '1 minute' where id='${sendId}';
 update helm_channex_messages.jobs set fire_at=now()-interval '1 minute',expires_at=now()+interval '29 minutes',prepared_at=now()-interval '2 minutes',source_evidence_at=now()-interval '3 minutes'
 where send_id='${sendId}'; commit;`);
const scope = JSON.parse(sql("select jsonb_build_object('environment',environment,'propertyId',remote_property,'channelId',channel_id,'provider',provider) from helm_channex_messages.scope;"));
const jobStore = createChannexJobStore(rpc); let posts = 0; const messageId = randomUUID(); let sent = '';
const transport = new ChannexMessageTransport({ scope, apiKey: 'synthetic-channex', sendEnabled: true, fetcher: async (url, init) => {
  const path = new URL(url).pathname;
  if (!path.endsWith('/messages')) return Response.json(provider.thread);
  if (init.method === 'POST') { posts++; sent = JSON.parse(String(init.body)).message.message; }
  const row = { id: messageId, type: 'message', attributes: { sender: 'property', message: sent, attachments: [] },
    relationships: { message_thread: { data: { type: 'message_thread', id: thread } } } };
  return Response.json(init.method === 'POST' ? { data: row } : { data: [row], meta: { page: 1, limit: 100, total: 1 } });
} });
const worker = new ChannexMessageWorker({ store: jobStore, transport, enabled: true });
const render = async () => {
  const s = await createCalderwoodScheduleInputReader(rpc, { enabled: true }).load(bid, request.bindingId); assert.ok(s);
  const rule = s.snapshot.currentRules.find(r => r.key === 'checkin_day')!;
  return { text: renderTemplate(rule.body, s.snapshot.merge).text, contextRevision: s.context.contextRevision };
};
assert.equal((await worker.dispatch(sendId, render)).state, 'accepted'); assert.equal(posts, 1);
assert.equal((await worker.dispatch(sendId, render)).state, 'needs_reconciliation'); assert.equal(posts, 1);
assert.equal((await worker.reconcile(sendId)).state, 'recorded'); assert.equal(posts, 1);
sql(`select helm_move_booking('${bid}',check_in,check_out,'cancelled','synthetic-runtime') from bookings where id='${bid}';`);
assert.equal((await run()).state, 'unavailable'); assert.equal(writes, 3);
console.log('PASS: real immutable templates + retained clocks + provider revalidation + atomic runtime scheduling + one fake worker POST/receipt; frozen/dormant/drift/cancellation blocks, lost response and repeat safety');
