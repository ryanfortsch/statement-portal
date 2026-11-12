/** Disposable synthetic PostgreSQL only. Run after test-channex-release-guards.
 * The actual reviewed template-release RPC is exercised below. Source handover
 * remains synthetic, and providers are fake. Run after test-channex-template-release.
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
// The real release requires dormant Guesty ownership. Remove only the synthetic
// handover, release under its exact retained receipt, then recreate the handover.
const savedScope = sql('select to_jsonb(s) from helm_channex_messages.scope s;');
sql(`delete from helm_channex_messages.timing_bindings;
 delete from helm_channex_messages.scope;
 update properties set calendar_authority='guesty',automations_enabled=false where id='65_calderwood';`);
const released = JSON.parse(sql(`set role service_role; select helm_channex_release_templates(
 '${randomUUID()}','${archive.id}','${archive.digest}','synthetic-runtime-owner');`));
assert.equal(released.guestRules, 4); assert.equal(released.reused, false);
assert.equal(sql("select count(*) from message_automations where audience='cleaner' and not enabled and migration_policy is not null;"), '2');
assert.equal(sql('select count(*) from automation_sends;'), '0');
sql(`update properties set calendar_authority='helm',automations_enabled=true where id='65_calderwood';
 insert into helm_channex_messages.scope select * from jsonb_populate_record(null::helm_channex_messages.scope,${str(savedScope)}::jsonb);`);
request.bindingId = randomUUID(); assert.equal((await bind()).state, 'created');
provider.v2.plannedArrival = '22:00'; assert.equal((await run()).state, 'unavailable'); assert.equal(writes, 0);
provider.v2.plannedArrival = null;
lostResponse = true; const uncertain = await run(); assert.equal(uncertain.state, 'uncertain'); assert.equal(writes, 1);
assert.equal(sql('select count(*) from helm_channex_messages.jobs;'), '1');
lostResponse = false; const completed = await run(); assert.equal(completed.state, 'complete');
assert.equal(writes, 3); assert.equal(sql('select count(*) from helm_channex_messages.jobs;'), '3');
assert.equal((await run()).outcomes.filter(o => o.state === 'created').length, 0); assert.equal(writes, 3);

// Old generic workers cannot reserve a missing migrated key, cancel active jobs
// as superseded, retime them, change the body, or claim their send rows.
const ledgerBefore = sql('select jsonb_agg(to_jsonb(s) order by id) from automation_sends s;');
sql(`insert into automation_sends(booking_id,property_id,automation_id,automation_key,fire_at,status,planned_check_in,planned_check_out)
 select '${bid}','65_calderwood',id,key,now()+interval '1 hour','scheduled',
 (select check_in from bookings where id='${bid}'),(select check_out from bookings where id='${bid}')
 from message_automations where key='booking_confirmed';
 update automation_sends set status='cancelled',error='rule superseded';
 update automation_sends set fire_at=fire_at+interval '1 hour';
 update automation_sends set body_rendered='synthetic changed body';
 update automation_sends set status='sending';`);
assert.equal(sql('select jsonb_agg(to_jsonb(s) order by id) from automation_sends s;'), ledgerBefore);

// The real worker can consume one registered due job; only a fake provider sees
// the synthetic rendered text. This proves release/plumbing, not live delivery or source clearance.
const sendId = sql("select send_id from helm_channex_messages.jobs where automation_key='checkin_day';");
sql(`begin; alter table automation_sends disable trigger channex_message_send_guard;
 update automation_sends set fire_at=now()-interval '1 minute' where id='${sendId}';
 update helm_channex_messages.jobs set fire_at=now()-interval '1 minute',expires_at=now()+interval '29 minutes',prepared_at=now()-interval '2 minutes'
 where send_id='${sendId}'; alter table automation_sends enable trigger channex_message_send_guard; commit;`);
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
// A replaced source-drain receipt cannot authorize a job created under the old one.
const proof = sql('select source_evidence_id from helm_channex_messages.scope;');
sql('update helm_channex_messages.scope set source_evidence_id=gen_random_uuid();');
const currentJob = (await jobStore.read(sendId))!;
assert.equal(await jobStore.claim(sendId, randomUUID(), currentJob), false);
assert.equal(sql(`select state from helm_channex_messages.jobs where send_id='${sendId}';`), 'prepared');
sql(`update helm_channex_messages.scope set source_evidence_id='${proof}';`);

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
console.log('PASS: real template release + immutable templates + retained clocks + provider revalidation + atomic runtime scheduling + one fake worker POST/receipt; frozen/dormant/drift/cancellation blocks, lost response and repeat safety');
