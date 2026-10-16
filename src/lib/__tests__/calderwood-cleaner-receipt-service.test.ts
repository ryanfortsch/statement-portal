import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { handleCleanerReceipt } from '../calderwood-rehearsal/cleaner-receipt-http.ts';
import { cleanerReceiptsEnabled, createCleanerReceiptRuntime, cleanerReceiptTestKey } from '../calderwood-rehearsal/cleaner-receipt-runtime.ts';
import { runCleanerReceiptScheduler, createCleanerReceiptPageRunner } from '../calderwood-rehearsal/cleaner-receipt-scheduler.ts';
const key = Buffer.alloc(32, 4).toString('base64');
const now = Date.parse('2030-01-10T14:00:00Z');
const env = { CHANNEX_CLEANER_RECEIPTS_ENABLED: 'true', CHANNEX_STAGING_ENABLED: 'true', VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: 'codex/channex-staging-pilot', CHANNEX_STAGING_DB_PROJECT_REF: 'jgkblfozftcvymvwhhii',
  CHANNEX_STAGING_DB_URL: 'https://jgkblfozftcvymvwhhii.supabase.co', CHANNEX_STAGING_DB_SERVICE_KEY: 'synthetic',
  CHANNEX_CLEANER_RECEIPT_TEST_SIGNING_KEY: key };
const workerEnv = { ...env, VERCEL_ENV: undefined, CHANNEX_WORKER_MODE: 'isolated-staging' };
const body = { id: 'HELMTEST-http-receipt', type: 'message.delivered', data: { object: { id: 'HELMTEST-http-provider',
  phoneNumberId: 'HELMTEST-ops-line', direction: 'outgoing', status: 'delivered', to: ['HELMTEST-cleaner-a'], text: 'discard this body' } } };
function request(raw = JSON.stringify(body), signedAt = now, headers: Record<string, string> = {}) {
  const signature = createHmac('sha256', Buffer.from(key, 'base64')).update(`${signedAt}.${raw}`).digest('base64');
  return new Request('https://rehearsal.example/api/webhooks/cleaner-rehearsal', { method: 'POST', body: raw,
    headers: { 'content-type': 'application/json', 'x-helm-rehearsal-signature': `hmac;1;${signedAt};${signature}`, ...headers } });
}
const forbidden = async () => { assert.fail('storage must not be reached'); return 'stored' as const; };
const page = (nextCursor = 0) => ({ scanned: 1, applied: 0, duplicate: 0, unmatched: 1, stale: 0, nextCursor, canSend: false as const });

test('HTTP receipt intake fails closed outside its explicit staging environment', async () => {
  for (const change of [{ CHANNEX_CLEANER_RECEIPTS_ENABLED: undefined }, { VERCEL_ENV: 'production' },
    { VERCEL_GIT_COMMIT_REF: 'main' }, { CHANNEX_STAGING_DB_PROJECT_REF: 'other' },
    { CHANNEX_STAGING_DB_URL: 'https://production.example' }, { CHANNEX_STAGING_ENABLED: 'false' }]) {
    const response = await handleCleanerReceipt(request(), { env: { ...env, ...change }, save: forbidden });
    assert.equal(response.status, 404); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
});
test('test key cannot fall back to the live provider key; wrong method and media type do not save', async () => {
  assert.throws(() => cleanerReceiptTestKey({ QUO_WEBHOOK_SECRET: key }));
  const missing = await handleCleanerReceipt(request(), { env: { ...env, CHANNEX_CLEANER_RECEIPT_TEST_SIGNING_KEY: undefined }, save: forbidden });
  assert.equal(missing.status, 503);
  assert.equal((await handleCleanerReceipt(new Request('https://rehearsal.example'), { env, save: forbidden })).status, 405);
  assert.equal((await handleCleanerReceipt(request('{}', now, { 'content-type': 'text/plain' }), { env, save: forbidden })).status, 415);
});
test('invalid, stale and non-fictional signatures cannot reach storage', async () => {
  const cases = [request(undefined, now - 300001), request(undefined, now, { 'x-helm-rehearsal-signature': 'bad' }),
    request(JSON.stringify({ ...body, id: 'real-provider-event' })), request('{broken')];
  for (const input of cases) assert.equal((await handleCleanerReceipt(input, { env, now: () => now, save: forbidden })).status, 401);
});
test('body size is enforced using actual bytes even if content-length lies', async () => {
  for (const input of [request('x'.repeat(65537)), request('é'.repeat(33000), now, { 'content-length': '2' }),
    request('{}', now, { 'content-length': '65537' })]) {
    assert.equal((await handleCleanerReceipt(input, { env, save: forbidden })).status, 413);
  }
  assert.equal((await handleCleanerReceipt(request('{}', now, { 'content-length': 'broken' }), { env, save: forbidden })).status, 400);
});
test('slow bodies and aborted requests are cancelled without storage', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const slow = new Request('https://rehearsal.example', { method: 'POST', body: stream, duplex: 'half',
    headers: { 'content-type': 'application/json' } } as RequestInit);
  assert.equal((await handleCleanerReceipt(slow, { env, save: forbidden, bodyTimeoutMs: 10 })).status, 408);
  assert.equal(cancelled, true);
  const controller = new AbortController(); controller.abort();
  const aborted = new Request(request(), { signal: controller.signal });
  assert.equal((await handleCleanerReceipt(aborted, { env, save: forbidden })).status, 400);
});
test('acknowledgement waits for durable normalized evidence and duplicates are successful', async () => {
  let release!: () => void, settled = false;
  const barrier = new Promise<void>(r => { release = r; });
  const result = handleCleanerReceipt(request(), { env, now: () => now, save: async (receipt, signal) => {
    assert.equal(signal.aborted, false);
    assert.deepEqual(receipt, { id: body.id, providerId: body.data.object.id, recipientId: 'HELMTEST-cleaner-a' });
    await barrier; return 'stored';
  } }).then(response => { settled = true; return response; });
  await new Promise(r => setImmediate(r)); assert.equal(settled, false); release();
  const response = await result; assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'stored', canSend: false });
  const duplicate = await handleCleanerReceipt(request(), { env, now: () => now, save: async () => 'duplicate' });
  assert.deepEqual(await duplicate.json(), { status: 'duplicate', canSend: false });
});
test('uncertain saves return retryable failure with no payload or exception disclosure', async () => {
  let calls = 0;
  const response = await handleCleanerReceipt(request(), { env, now: () => now, save: async () => { calls++; throw Error('private details'); } });
  assert.equal(response.status, 503); assert.equal(response.headers.get('retry-after'), '60'); assert.equal(calls, 1);
  assert.equal(JSON.stringify(await response.json()).includes('private details'), false);
});
test('runtime uses explicit staging storage and forwards shutdown cancellation to RPC fetch', async () => {
  assert.equal(cleanerReceiptsEnabled(workerEnv, 'worker'), true);
  assert.equal(cleanerReceiptsEnabled(env, 'worker'), false);
  assert.throws(() => createCleanerReceiptPageRunner({ ...workerEnv, CHANNEX_WORKER_MODE: 'production' }));
  assert.throws(() => createCleanerReceiptRuntime({ ...env, CHANNEX_STAGING_DB_SERVICE_KEY: undefined }, 'preview'));
  const controller = new AbortController(); let forwarded: AbortSignal | undefined;
  const runtime = createCleanerReceiptRuntime(workerEnv, 'worker', controller.signal, async (_url, init) => {
    forwarded = init?.signal ?? undefined; return Response.json([]);
  });
  await runtime.inbox.pending(); controller.abort(); assert.equal(forwarded?.aborted, true);
});
test('scheduled pages are serial, bounded and sweep back to zero for earlier unmatched receipts', async () => {
  const controller = new AbortController(), cursors: number[] = [], waits: number[] = [];
  let active = 0, peak = 0;
  const result = await runCleanerReceiptScheduler({ signal: controller.signal, log: () => {},
    drainPage: async (cursor, signal) => { assert.equal(signal.aborted, false); cursors.push(cursor); active++; peak = Math.max(peak, active);
      await Promise.resolve(); active--; return page(cursors.length === 1 ? 25 : 0); },
    wait: async delay => { waits.push(delay); if (waits.length === 3) controller.abort(); } });
  assert.deepEqual(cursors, [0, 25, 0]); assert.deepEqual(waits, [5000, 60000, 60000]); assert.equal(peak, 1);
  assert.equal(result.cycles, 3); assert.equal(result.canSend, false);
});
test('scheduler failures back off, reset cursor, and recover without logging receipt content', async () => {
  const controller = new AbortController(), cursors: number[] = [], waits: number[] = [], logs: unknown[] = [];
  const result = await runCleanerReceiptScheduler({ signal: controller.signal, log: entry => logs.push(entry),
    drainPage: async cursor => { cursors.push(cursor); if (cursors.length === 2 || cursors.length === 3) throw Error('private payload'); return page(cursors.length === 1 ? 25 : 0); },
    wait: async delay => { waits.push(delay); if (waits.length === 4) controller.abort(); } });
  assert.deepEqual(cursors, [0, 25, 0, 0]); assert.deepEqual(waits, [5000, 60000, 120000, 60000]);
  assert.equal(result.failed, false); assert.equal(JSON.stringify(logs).includes('private payload'), false);
});
test('one-shot and shutdown stop processing, and telemetry cannot retry a successful page', async () => {
  const controller = new AbortController(); let calls = 0;
  const run = (once: boolean) => runCleanerReceiptScheduler({ signal: controller.signal, once,
    drainPage: async () => { calls++; return page(); }, log: () => { throw Error('logging unavailable'); } });
  assert.equal((await run(true)).cycles, 1); controller.abort(); assert.equal((await run(false)).cycles, 0); assert.equal(calls, 1);
  assert.equal((await runCleanerReceiptScheduler({ signal: new AbortController().signal, once: true,
    drainPage: async () => { throw Error('unknown commit'); }, log: () => {} })).failed, true);
});
