/** Full-chain prerequisite. Real SQL and application orchestration; synthetic
 * loopback fixtures and fake GETs only. Never uses production credentials. */
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { normalizeAirbnbBookingRevision } from '../src/lib/channex-bookings/revision.ts';
import { intakeRow } from '../src/lib/__tests__/fixtures/channex-booking-intake.ts';
import { CALDERWOOD_PRODUCTION as mapping } from '../src/lib/channex-production-preflight.ts';
import { registerNewStaySchedules } from '../src/lib/channex-messaging/new-stay-schedule-runtime.ts';
import { createNewStayScheduleInputReader, planAdmittedStay } from '../src/lib/channex-messaging/new-stay-schedule-inputs.ts';
import { parsePreparationRules } from '../src/lib/channex-messaging/preparation-rules.ts';
import { retainedGuestSendId } from '../src/lib/channex-messaging/schedule-coordinator.ts';
import { retainedCleanerSendId } from '../src/lib/channex-messaging/cleaner-runtime.ts';
import { runNewStayScheduleTick } from '../src/lib/channex-messaging/new-stay-schedule-tick.ts';
if (process.env.PGHOST !== '127.0.0.1' || process.env.PGDATABASE !== 'helm_synthetic_channex') throw Error('Synthetic loopback database required');
globalThis.fetch = async () => { throw Error('Real network disabled'); };
const psql = process.env.CHANNEX_TEST_PSQL || 'psql';
const quote = (v: unknown) => "'" + String(v).replaceAll("'", "''") + "'";
function sql(input: string) {
  const r = spawnSync(psql, ['-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8' });
  if (r.status) throw Error(r.stderr); return r.stdout.trim();
}
function asyncSql(input: string) {
  const child = spawn(psql, ['-X', '-Atq', '-v', 'ON_ERROR_STOP=1']); let out = '', err = '';
  child.stdout.on('data', c => { out += c; }); child.stderr.on('data', c => { err += c; });
  const done = new Promise<string>((resolve, reject) => { child.on('error', reject); child.on('close', code => code ? reject(Error(err)) : resolve(out.trim())); });
  child.stdin.end(input); return done;
}
const counts = () => sql('select (select count(*) from automation_sends)||\':\'||(select count(*) from helm_channex_messages.jobs)||\':\'||(select count(*) from helm_channex_messages.cleaner_jobs);');
const initial = counts();
const retainedContexts = () => sql(`select coalesce(jsonb_object_agg(b.id,helm_channex_messages.booking_context(b.id) order by b.id),'{}'::jsonb)
 from bookings b where not exists(select 1 from helm_channex_messages.new_stay_admissions a where a.booking_id=b.id);`);
const beforeRetainedContexts = retainedContexts();
sql(readFileSync('supabase/migrations/20261114020000_channex_new_stay_scheduling.sql', 'utf8'));
assert.equal(counts(), initial); assert.equal(retainedContexts(), beforeRetainedContexts);
for (const fn of ['helm_channex_new_stay_schedule_inputs(uuid)', 'helm_channex_new_stay_schedule_register(uuid,uuid,jsonb)', 'helm_channex_new_stay_schedule_worklist()']) {
  for (const role of ['anon', 'authenticated']) assert.equal(sql(`select has_function_privilege('${role}','${fn}','execute');`), 'f');
  assert.equal(sql(`select has_function_privilege('service_role','${fn}','execute');`), 't');
}
for (const role of ['anon','authenticated','service_role']) {
  assert.equal(sql(`select has_function_privilege('${role}','helm_channex_new_cleaner_register(jsonb)','execute');`),'f');
  assert.equal(sql(`select has_table_privilege('${role}','helm_channex_messages.cleaner_jobs','select,insert,update,delete');`),'f');
}
// Restore the SAME synthetic generation revoked by the preceding test. No epoch
// creator exists in the application and no production baseline is inferred here.
sql(`update helm_channex_messages.scope set generation=(select route_generation from helm_channex_messages.new_stay_epochs limit 1),enabled=true;
 update properties set automations_enabled=true where id='65_calderwood';
 update cleaner_schedule_recipients set enabled=true;`);
const ref = JSON.parse(sql(`select jsonb_build_object('templateCaptureId',t.id,'templateDigest',t.rules_sha256,'cleanerReleaseId',r.id)
 from helm_channex_messages.template_captures t join helm_channex_messages.cleaner_releases r on r.capture_id=t.id;`));
const rules = parsePreparationRules(JSON.parse(sql('select rules from helm_channex_messages.template_captures limit 1;')));
let n = 0;
function booking(startOverride?: string) {
  n++; const raw = intakeRow(), remote = randomUUID(); raw.id = randomUUID();
  const start = startOverride ?? new Date(Date.now() + (45 + n * 6) * 86400000).toISOString().slice(0,10);
  const end = new Date(Date.parse(start) + 3 * 86400000).toISOString().slice(0,10);
  Object.assign(raw.attributes, { booking_id: remote, ota_reservation_code: 'NEWSCHEDULE' + remote.replaceAll('-',''), status: 'new', arrival_date: start, departure_date: end });
  Object.assign(raw.attributes.rooms[0], { checkin_date: start, checkout_date: end });
  const revision = normalizeAirbnbBookingRevision(raw, { environment: 'production', propertyId: mapping.propertyId,
    roomTypeId: mapping.roomTypeId, ratePlanId: mapping.ratePlanId, generation: 1 });
  const receipt = JSON.parse(sql(`set role service_role; select helm_airbnb_revision_commit(${quote(JSON.stringify(revision))}::jsonb);`));
  sql('set role service_role; select helm_channex_new_stays_admit();');
  return { bookingId: receipt.canonicalBookingId as string, revision, threadId: randomUUID() };
}
const jsonRead = (query: string) => JSON.parse(sql(query) || 'null');
const batchSql = (args: Record<string, unknown>) => `set role service_role; select helm_channex_new_stay_schedule_register(${quote(args.p_booking)}::uuid,${quote(args.p_epoch)}::uuid,${quote(JSON.stringify(args.p_plans))}::jsonb);`;
let registrations = 0, reads = 0, saved: Record<string, unknown> | null = null;
const rpc = async (name: string, args: Record<string, unknown>) => {
  let query: string;
  if (name === 'helm_channex_new_stay_schedule_inputs') query = `select helm_channex_new_stay_schedule_inputs(${quote(args.p_booking_id)}::uuid);`;
  else if (name === 'helm_channex_read_template_capture') query = `select helm_channex_read_template_capture(${quote(args.p_capture_id)}::uuid,${quote(args.p_rules_sha256)});`;
  else if (name === 'helm_channex_cleaner_enrollment_snapshot') query = `select helm_channex_cleaner_enrollment_snapshot(${quote(args.p_capture_id)}::uuid,${quote(args.p_digest)});`;
  else if (name === 'helm_channex_new_stay_schedule_worklist') query = 'select helm_channex_new_stay_schedule_worklist();';
  else if (name === 'helm_channex_new_stay_schedule_register') { registrations++; saved = structuredClone(args); return { data: jsonRead(batchSql(args)), error: null }; }
  else throw Error('Unexpected RPC: ' + name);
  return { data: jsonRead('set role service_role; ' + query), error: null };
};
function provider(b: ReturnType<typeof booking>, mutate?: (payload: Record<string, unknown>, path: string) => void) {
  return async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(init?.method, 'GET'); assert.equal(init?.body, undefined); reads++;
    const u = new URL(String(url)); assert.equal(u.origin, 'https://app.channex.io');
    const relation = (type: string, id: string) => ({ data: { type, id } });
    const channel = sql("select channel_id from helm_channex_messages.scope where property_id='65_calderwood';");
    const thread = { id: b.threadId, type: 'message_thread', attributes: { provider: 'Airbnb', is_closed: false }, relationships: {
      booking: relation('booking', b.revision.bookingId), property: relation('property', mapping.propertyId), channel: relation('channel', channel) } };
    let payload: Record<string, unknown>;
    if (u.pathname === '/api/v1/bookings/' + b.revision.bookingId) payload = { data: { id: b.revision.bookingId, type: 'booking', attributes: {
      id: b.revision.bookingId, property_id: mapping.propertyId, ota_name: 'Airbnb', status: b.revision.status,
      revision_id: b.revision.revisionId, ota_reservation_code: b.revision.reservationCode, arrival_date: b.revision.checkIn,
      departure_date: b.revision.checkOut, rooms: [{ room_type_id: mapping.roomTypeId, rate_plan_id: mapping.ratePlanId,
        checkin_date: b.revision.checkIn, checkout_date: b.revision.checkOut }] } } };
    else if (u.pathname === '/api/v1/message_threads') payload = { data: [thread], meta: { page: 1, limit: 100, total: 1 } };
    else if (u.pathname === '/api/v1/message_threads/' + b.threadId) payload = { data: thread };
    else throw Error('Unexpected provider URL');
    mutate?.(payload, u.pathname); return new Response(JSON.stringify(payload));
  };
}
const smsProof = async () => ({ receiptKey: 'a'.repeat(64), keyId: 'synthetic-v1' });
const deps = (b: ReturnType<typeof booking>) => ({ rpc, smsProof, channexKey: async () => 'synthetic-key', fetcher: provider(b) });
const run = (b: ReturnType<typeof booking>, overrides = {}) => registerNewStaySchedules({ bookingId: b.bookingId, ...ref }, { ...deps(b), ...overrides }, { enabled: true });
assert.equal((await registerNewStaySchedules({}, { rpc, smsProof, channexKey: async () => { throw Error(); } })).state, 'disabled');
assert.equal((await runNewStayScheduleTick({}, { rpc })).state, 'disabled');
const first = booking();
const input = await createNewStayScheduleInputReader(rpc, { enabled: true }).load(first.bookingId); assert.ok(input);
assert.equal(input.merge.guest_first, 'Synthetic');
const originalInput = (await rpc('helm_channex_new_stay_schedule_inputs', { p_booking_id: first.bookingId })).data;
for (const changedInput of [{ ...originalInput, booking: { ...originalInput.booking, guestName: 'Different Person' } },
 { ...originalInput, admission: undefined }, { ...originalInput, ledger: [...originalInput.ledger, {}] },
 { ...originalInput, context: { ...originalInput.context, routeGeneration: randomUUID() } }]) {
 await assert.rejects(createNewStayScheduleInputReader(async () => ({ data: changedInput, error: null }), { enabled: true }).load(first.bookingId), /inputs unavailable/);
}
for (const p of planAdmittedStay(input, rules, Date.now())) {
  const db = sql(`select helm_channex_messages.new_stay_fire('${first.bookingId}',${quote(p.key)});`);
  assert.equal(db ? new Date(db).toISOString() : null, p.fireAt);
}
// An explicit clock edit changes the context and SQL clock; fixed-time copy
// refuses an override rather than making an incorrect promise. Rollback restores
// the pre-registration fixture; production writers do not bypass the CAS gate.
const exception = { id: randomUUID(), bookingId: first.bookingId, replaces: null,
 start: first.revision.checkIn, end: first.revision.checkOut, arrival: '13:00', departure: '12:00' };
const changed = jsonRead(`begin; set role service_role; do $test$ begin perform helm_channex_new_stay_clock_save(${quote(JSON.stringify(exception))}::jsonb,'synthetic-owner'); end $test$;
 reset role; select jsonb_build_object('revision',helm_channex_messages.booking_context('${first.bookingId}'),
 'confirmation',helm_channex_messages.new_stay_fire('${first.bookingId}','booking_confirmed'),
 'code',helm_channex_messages.new_stay_fire('${first.bookingId}','checkin_day')); rollback;`);
assert.notEqual(changed.revision, input.context.contextRevision); assert.equal(changed.confirmation, null);
assert.equal(Date.parse(changed.code), Date.parse(planAdmittedStay(input, rules, Date.now()).find(p => p.key === 'checkin_day')!.fireAt!) - 3 * 3600000);

assert.deepEqual(await run(first), { state: 'complete', registered: 6, canSend: false });
assert.equal(reads, 6); assert.equal(registrations, 1); assert.ok(saved);
const original = structuredClone(saved);
assert.equal(sql(`select count(*) from automation_sends where booking_id='${first.bookingId}';`), '6');
assert.equal(sql(`select count(*) from helm_channex_messages.cleaner_jobs where new_stay_id='${first.bookingId}' and binding_id is null;`), '2');
assert.equal((await run(first)).state, 'waiting'); assert.equal(registrations, 1);
assert.equal(jsonRead(batchSql(original)).results.every((r: { state: string }) => r.state === 'existing'), true);
// Concurrent retries reuse all six IDs. Never partially duplicate a workflow.
const concurrent = await Promise.all([asyncSql(batchSql(original)), asyncSql(batchSql(original))]);
assert.ok(concurrent.every(s => JSON.parse(s).results.every((r: { state: string }) => r.state === 'existing')));
assert.equal(sql(`select count(*) from automation_sends where booking_id='${first.bookingId}';`), '6');
// Exact retry is a receipt read, not a hold release.
const cleanerId = retainedCleanerSendId(first.bookingId, 'cleaner_arrival');
sql(`set role service_role; select helm_channex_cleaner_hold('${cleanerId}',true,'synthetic-owner');`);
jsonRead(batchSql(original)); assert.equal(sql(`select held from helm_channex_messages.cleaner_jobs where send_id='${cleanerId}';`), 't');
const second = booking();
const lost = await run(second, { rpc: async (name: string, args: Record<string, unknown>) => { const r = await rpc(name,args); if (name.endsWith('schedule_register')) throw Error('lost response'); return r; } });
assert.equal(lost.state, 'uncertain'); assert.equal((await run(second)).state, 'waiting');
assert.equal(sql(`select count(*) from automation_sends where booking_id='${second.bookingId}';`), '6');
// SQL rechecks every planned time. One bad cleaner plan rolls back earlier guest inserts.
const third = booking(); let captured: Record<string, unknown> | null = null;
assert.equal((await run(third, { rpc: async (name: string, args: Record<string, unknown>) => {
  if (name.endsWith('schedule_register')) { captured = structuredClone(args); throw Error(); } return rpc(name,args);
} })).state, 'uncertain');
assert.ok(captured);
const bad = structuredClone(captured) as { p_plans: Record<string, unknown>[] };
bad.p_plans[5].fireAt = new Date(Date.parse(String(bad.p_plans[5].fireAt)) + 60000).toISOString();
assert.throws(() => sql(batchSql(bad)), /cleaner_registration_not_ready/);
assert.equal(sql(`select count(*) from automation_sends where booking_id='${third.bookingId}';`), '0');
// Arbitrary early guest fire also fails independently of the TypeScript planner.
const badGuest = structuredClone(captured) as { p_plans: Record<string, unknown>[] };
badGuest.p_plans[0].fireAt = new Date(Date.parse(String(badGuest.p_plans[0].fireAt)) + 60000).toISOString();
assert.throws(() => sql(batchSql(badGuest)), /message_registration/);
const badExpiry = structuredClone(captured) as { p_plans: Record<string, unknown>[] };
badExpiry.p_plans[0].expiresAt = new Date(Date.parse(String(badExpiry.p_plans[0].fireAt)) + 3600000).toISOString();
assert.throws(() => sql(batchSql(badExpiry)), /message_registration/);
// Date changes, source revocation and cleaner access edits cannot commit stale plans.
for (const change of ["update properties set automations_enabled=false where id='65_calderwood'",
 "update helm_channex_messages.scope set enabled=false", "update cleaner_schedule_recipients set enabled=false"]) {
 assert.throws(() => sql('begin; ' + change + '; ' + batchSql(captured!) + ' rollback;'));
}
const tampered = booking();
assert.equal((await run(tampered, { fetcher: provider(tampered, (p, path) => { if(path.includes('/bookings/')) (p.data as { attributes: { status: string } }).attributes.status = 'cancelled'; }) })).state, 'unavailable');
assert.equal(sql(`select count(*) from automation_sends where booking_id='${tampered.bookingId}';`), '0');
// Both new cleaner claims use admission clocks, never a fabricated Guesty binding.
assert.equal(sql(`select bool_and(helm_channex_messages.cleaner_ready(release_id,booking_id,automation_id,binding_id,context_revision))
 from helm_channex_messages.cleaner_jobs where booking_id='${second.bookingId}';`), 't');
// DST ambiguity remains blocked in both independent clocks. This fixture is
// beyond the ordinary batch dates and is used for timing parity only.
const dst = booking('2031-03-09');
const dstInput = await createNewStayScheduleInputReader(rpc, { enabled: true }).load(dst.bookingId); assert.ok(dstInput);
for (const p of planAdmittedStay(dstInput, rules, Date.now())) {
 const db = sql(`select helm_channex_messages.new_stay_fire('${dst.bookingId}',${quote(p.key)});`);
 assert.equal(db ? new Date(db).toISOString() : null, p.fireAt);
}
assert.equal(planAdmittedStay(dstInput, rules, Date.now()).find(p => p.key === 'pre_arrival')!.state, 'dst_review');
for (const [day,clock] of [['2031-03-09','02:30'],['2031-11-02','01:30']])
 assert.equal(sql(`select helm_channex_messages.new_stay_instant('${day}', '${clock}') is null;`),'t');
// Real importer cancellation changes both canonical state and complete history.
const cancel = { ...first.revision, revisionId: randomUUID(), status: 'cancelled', providerReceivedAt: '2030-01-01T00:00:00.000001Z' };
sql(`set role service_role; select helm_airbnb_revision_commit(${quote(JSON.stringify(cancel))}::jsonb);`);
assert.equal((await run(first)).state, 'unavailable');
assert.equal(await createNewStayScheduleInputReader(rpc, { enabled: true }).load(first.bookingId), null);
assert.equal(sql(`select count(*) from automation_sends where booking_id='${first.bookingId}' and status='scheduled';`), '0');
assert.equal(sql(`select helm_channex_messages.new_stay_fire('${first.bookingId}','booking_confirmed') is null;`), 't');
assert.equal(sql(`select helm_channex_message_claim('${retainedGuestSendId(first.bookingId,'booking_confirmed')}','${randomUUID()}','{}');`), 'f');
console.log('PASS: atomic six-workflow new-stay schedules, real SQL clock parity, duplicate races, lost replies, hold preservation, invalid-time rollback, source/recipient revocation, live-provider mismatch and cancellation; zero provider POSTs');
