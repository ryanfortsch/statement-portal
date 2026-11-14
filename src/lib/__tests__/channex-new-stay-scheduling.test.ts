import test from 'node:test';
import assert from 'node:assert/strict';
import { newStayScheduleConfiguration } from '../channex-messaging/new-stay-schedule-config.ts';
import { registerNewStaySchedules } from '../channex-messaging/new-stay-schedule-runtime.ts';
import { runNewStayScheduleTick } from '../channex-messaging/new-stay-schedule-tick.ts';
import { createNewStayScheduleInputReader } from '../channex-messaging/new-stay-schedule-inputs.ts';
import { intakeId as id } from './fixtures/channex-booking-intake.ts';
import { PRODUCTION_DB_URL } from '../channex-production-runtime.ts';
const reference = { templateCaptureId: id(1), templateDigest: 'a'.repeat(64), cleanerReleaseId: id(2) };
const env = { VERCEL_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: PRODUCTION_DB_URL, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service',
 CRON_SECRET: 'synthetic-cron', CHANNEX_PRODUCTION_API_KEY: 'synthetic-channex', HELM_CHANNEX_CLEANER_RECEIPT_KEY: 'b'.repeat(64),
 HELM_CHANNEX_CLEANER_KEY_ID: 'synthetic-v1', HELM_CHANNEX_NEW_STAY_SCHEDULE_MODE: 'calderwood-v1',
 HELM_CHANNEX_NEW_STAY_SCHEDULE_REFERENCE: JSON.stringify(reference) };
const forbidden = async (): Promise<never> => { throw Error('unexpected IO'); };

test('new scheduling is dormant with zero IO unless explicitly configured', async () => {
 for (const mode of [undefined, '', 'off']) {
  assert.equal(newStayScheduleConfiguration({ ...env, HELM_CHANNEX_NEW_STAY_SCHEDULE_MODE: mode }), null);
  assert.deepEqual(await runNewStayScheduleTick({ ...env, HELM_CHANNEX_NEW_STAY_SCHEDULE_MODE: mode }, { rpc: forbidden }),
   { state: 'disabled', ok: true, stays: [] });
 }
 assert.deepEqual(await registerNewStaySchedules({}, { rpc: forbidden, smsProof: forbidden, channexKey: forbidden }),
  { state: 'disabled', registered: 0, canSend: false });
 assert.equal(await createNewStayScheduleInputReader(forbidden).load('invalid'), null);
});
test('only the production database and reviewed references may select the automatic lane', () => {
 assert.deepEqual(newStayScheduleConfiguration(env)?.reference, reference);
 for (const patch of [{ VERCEL_ENV: 'preview' }, { NEXT_PUBLIC_SUPABASE_URL: 'https://staging.invalid' },
  { HELM_CHANNEX_NEW_STAY_SCHEDULE_MODE: 'send' }, { SUPABASE_SERVICE_ROLE_KEY: '' }, { CRON_SECRET: '' },
  { HELM_ISOLATED_CALENDAR_ENABLED: 'true' }, { CHANNEX_WORKER_MODE: 'isolated-staging' },
  { HELM_CHANNEX_CLEANER_RECEIPT_KEY: '' }, { HELM_CHANNEX_NEW_STAY_SCHEDULE_REFERENCE: '{}' },
  { HELM_CHANNEX_NEW_STAY_SCHEDULE_REFERENCE: JSON.stringify({ ...reference, bookingId: id(3) }) }])
  assert.throws(() => newStayScheduleConfiguration({ ...env, ...patch }));
 // Scheduling uses HMAC proofs only; it does not require a Quo sending credential.
 assert.ok(newStayScheduleConfiguration({ ...env, QUO_API_KEY: undefined }));
});
test('worklist overflow, duplicates, errors and unexpected data never turn into guessed stays', async () => {
 for (const data of [{ state: 'overflow', bookingIds: [] }, { state: 'ready', bookingIds: [id(3), id(3)] }]) {
  const out = await runNewStayScheduleTick(env, { rpc: async (name, args) => {
   assert.equal(name, 'helm_channex_new_stay_schedule_worklist'); assert.deepEqual(args, {}); return { data, error: null };
  } }); assert.deepEqual(out, { state: 'review_required', ok: false, stays: [] });
 }
 for (const data of [{ state: 'ready', bookingIds: Array.from({ length: 5 }, (_, n) => id(n + 3)) },
  { state: 'ready', bookingIds: [], secret: 'private' }, { state: 'ready' }])
  await assert.rejects(runNewStayScheduleTick(env, { rpc: async () => ({ data, error: null }) }));
 await assert.rejects(runNewStayScheduleTick(env, { rpc: async () => ({ data: null, error: { message: 'private' } }) }));
});
test('an empty authoritative worklist performs one read and no provider or write', async () => {
 let reads = 0;
 const out = await runNewStayScheduleTick(env, { rpc: async () => { reads++; return { data: { state: 'ready', bookingIds: [] }, error: null }; }, fetcher: forbidden });
 assert.equal(reads, 1); assert.deepEqual(out, { state: 'complete', ok: true, stays: [] });
});
test('malformed caller input cannot select a retained binding or activate sending', async () => {
 for (const raw of [{ bookingId: 'wrong', ...reference }, { bookingId: id(3), ...reference, bindingId: id(4) },
  { bookingId: id(3), ...reference, sendEnabled: true }])
  assert.deepEqual(await registerNewStaySchedules(raw, { rpc: forbidden, channexKey: forbidden, smsProof: forbidden }, { enabled: true }),
   { state: 'invalid', registered: 0, canSend: false });
});
test('private failure details never reach the public schedule result', async () => {
 const out = await registerNewStaySchedules({ bookingId: id(3), ...reference },
  { rpc: async () => { throw Error('PRIVATE_SENTINEL'); }, channexKey: forbidden, smsProof: forbidden }, { enabled: true });
 assert.deepEqual(out, { state: 'unavailable', registered: 0, canSend: false });
 assert.ok(!JSON.stringify(out).includes('PRIVATE_SENTINEL'));
});
