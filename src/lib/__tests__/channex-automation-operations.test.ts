import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readAutomationOperations } from '../channex-messaging/operations.ts';
import { PRODUCTION_DB_URL } from '../channex-production-runtime.ts';
import { syntheticAutomationOperations, operationsFixture } from './fixtures/channex-automation-operations.ts';

test('off senders still expose accepted and uncertain attempts, including a cancelled canonical row', async () => {
  const f = operationsFixture();
  f.rows[0].status = 'cancelled'; f.guest.state = 'unknown'; f.guest.providerMessageId = null;
  const report = await readAutomationOperations({}, f.deps);
  assert.equal(report.guest.state, 'off'); assert.equal(report.cleaner.state, 'off');
  assert.equal(report.rows[0].state, 'Message outcome uncertain');
  assert.equal(report.rows[1].state, 'SMS accepted · receipt pending');
  assert.deepEqual(new Set(f.calls), new Set(['helm_channex_message_read', 'helm_channex_cleaner_read']));
});
test('accepted, provider readback and delivered are deliberately different', async () => {
  const f = operationsFixture(); f.guest.state = 'recorded'; f.cleaner.state = 'delivered';
  f.cleaner.providerStatus = 'delivered'; f.cleaner.providerUpdatedAt = f.now;
  const report = await readAutomationOperations({}, f.deps);
  assert.deepEqual(report.rows.map(r => r.state), ['Message found at provider', 'SMS delivered']);
  assert.match(report.rows[0].note, /not proof the guest received/);
});
test('canonical sent with no private receipt never becomes delivered', async () => {
  const f = operationsFixture(); f.rows.forEach(r => { r.status = 'sent'; r.sent_at = f.now; });
  f.deps.rpc = async () => ({ data: null, error: null });
  assert.ok((await readAutomationOperations({}, f.deps)).rows.every(r => r.category === 'attention'));
});
test('one failed receipt lookup preserves the other row and hides provider exception data', async () => {
  const f = operationsFixture(), original = f.deps.rpc;
  f.deps.rpc = async (name, args) => { if (name.includes('cleaner')) throw Error('private-provider-secret'); return original(name, args); };
  const report = await readAutomationOperations({}, f.deps);
  assert.equal(report.history, 'available'); assert.equal(report.rows.length, 2);
  assert.equal(report.rows.find(r => r.audience === 'cleaner')?.state, 'Delivery record unavailable');
  assert.ok(!JSON.stringify(report).includes('private-provider-secret'));
});
test('changed canonical history discards the mixed observation', async () => {
  const f = operationsFixture(); let reads = 0;
  f.deps.history = async () => ({ data: f.rows.map(r => ({ ...r, status: ++reads > 2 ? 'cancelled' : r.status })), total: 2 });
  const report = await readAutomationOperations({}, f.deps);
  assert.equal(report.history, 'unavailable'); assert.deepEqual(report.rows, []);
});
test('unavailable, malformed and silently truncated history are never empty success', async () => {
  for (const mode of ['error', 'malformed', 'truncated']) {
    const f = operationsFixture();
    f.deps.history = async () => { if (mode === 'error') throw Error('private-data');
      return { data: mode === 'malformed' ? [{ wrong: true }] : f.rows, total: mode === 'truncated' ? 3 : 1 }; };
    const report = await readAutomationOperations({}, f.deps);
    assert.equal(report.history, 'unavailable'); assert.deepEqual(report.rows, []); assert.deepEqual(f.calls, []);
  }
});
test('empty canonical history is shown only after two successful reads', async () => {
  const f = operationsFixture(); let reads = 0;
  f.deps.history = async () => { reads++; return { data: [], total: 0 }; };
  const report = await readAutomationOperations({}, f.deps);
  assert.equal(report.history, 'available'); assert.equal(report.total, 0); assert.equal(reads, 2); assert.deepEqual(f.calls, []);
});
test('slow or regressing observations do not present stale receipts as current', async () => {
  for (const offset of [25_001, -1]) {
    const f = operationsFixture(); let reads = 0;
    f.deps.clock = () => Date.parse(f.now) + (reads++ ? offset : 0);
    const report = await readAutomationOperations({}, f.deps);
    assert.equal(report.history, 'unavailable'); assert.deepEqual(report.rows, []); assert.deepEqual(f.calls, []);
  }
});
test('oversized histories are explicitly partial and private lookups stay bounded', async () => {
  const f = operationsFixture(); const rows = Array.from({ length: 100 }, (_, i) => ({ ...f.rows[0],
    id: `90000000-0000-4000-8000-${(i + 1).toString().padStart(12, '0')}` }));
  let concurrent = 0, peak = 0, calls = 0;
  f.deps.history = async () => ({ data: rows, total: 101 });
  f.deps.rpc = async () => { concurrent++; calls++; peak = Math.max(concurrent, peak); await Promise.resolve(); concurrent--; return { data: null, error: null }; };
  const report = await readAutomationOperations({}, f.deps);
  assert.equal(report.history, 'partial'); assert.equal(report.rows.length, 100); assert.equal(calls, 100); assert.ok(peak <= 4);
});
test('cleaner identity and clock mismatches cannot display a delivery receipt', async () => {
  const f = operationsFixture(); f.cleaner.bookingId = f.cleaner.automationId;
  f.cleaner.state = 'delivered'; f.cleaner.providerStatus = 'delivered'; f.cleaner.providerUpdatedAt = f.now;
  assert.equal((await readAutomationOperations({}, f.deps)).rows.find(r => r.audience === 'cleaner')?.state, 'Delivery record unavailable');
});
test('prepared schedules distinguish future, due, expired and cancelled without claiming send eligibility', async () => {
  for (const [offset, status, expected] of [[60_000, 'scheduled', 'Scheduled'], [-60_000, 'scheduled', 'Due · awaiting sender'],
    [-1800000, 'scheduled', 'Send window elapsed'], [60_000, 'cancelled', 'Stopped or awaiting review']] as const) {
    const f = operationsFixture(); f.rows = f.rows.slice(0, 1); f.guest.state = 'prepared'; f.guest.attemptId = null; f.guest.providerMessageId = null;
    f.rows[0].fire_at = new Date(Date.parse(f.now) + offset).toISOString(); f.rows[0].status = status;
    f.deps.history = async () => ({ data: f.rows, total: 1 });
    assert.equal((await readAutomationOperations({}, f.deps)).rows[0].state, expected);
  }
});
test('invalid activation is visible and never enables a sender or suppresses history', async () => {
  const f = operationsFixture();
  const report = await readAutomationOperations({ HELM_CHANNEX_MESSAGES_MODE: 'retained-pilot-v1', HELM_CHANNEX_CLEANER_MODE: 'typo' }, f.deps);
  assert.equal(report.guest.state, 'invalid'); assert.equal(report.cleaner.state, 'invalid'); assert.equal(report.rows.length, 2);
});
test('read-only report never exposes secrets, source addresses, provider IDs or manifest references', async () => {
  const f = operationsFixture(), json = JSON.stringify(await readAutomationOperations({}, f.deps));
  for (const value of [f.guest.threadId, f.guest.channelId, f.guest.providerMessageId!, f.cleaner.providerMessageId!,
    f.cleaner.targetHmac, f.cleaner.recipientHmac, f.cleaner.keyId, f.cleaner.releaseId]) assert.ok(!json.includes(value), value);
});
test('real configured guest lane counts retained stays without calling any provider', async () => {
  const f = operationsFixture();
  const env = { HELM_CHANNEX_MESSAGES_MODE: 'retained-pilot-v1', VERCEL_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: PRODUCTION_DB_URL,
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic', CHANNEX_PRODUCTION_API_KEY: 'synthetic', CRON_SECRET: 'synthetic',
    HELM_CHANNEX_MESSAGES_MANIFEST: JSON.stringify({ format: 1, stays: [{ bookingId: f.rows[0].booking_id,
      bindingId: f.cleaner.releaseId, templateCaptureId: f.cleaner.automationId, templateDigest: 'b'.repeat(64) }] }) };
  assert.deepEqual((await readAutomationOperations(env, f.deps)).guest, { state: 'configured', stays: 1 });
});
test('browser fixture comes from the actual operations reader', async () => {
  const report = await syntheticAutomationOperations(); assert.equal(report.history, 'available'); assert.equal(report.rows.length, 2);
});
test('owner and production boundaries precede private reads; no mutation or provider endpoint is introduced', () => {
  const page = readFileSync(new URL('../../app/channels/65_calderwood/message-status/page.tsx', import.meta.url), 'utf8');
  assert.ok(page.indexOf('if (!await isOwnerSession())') < page.indexOf('const scope ='));
  const server = readFileSync(new URL('../channex-messaging/operations.server.ts', import.meta.url), 'utf8');
  assert.ok(server.indexOf('await requireOwnerEmail()') < server.indexOf('return readAutomationOperations'));
  assert.match(server, /process.env.VERCEL_ENV === 'production'/); assert.match(server, /NEXT_PUBLIC_SUPABASE_URL === PRODUCTION_DB_URL/);
  assert.match(server, /\['helm_channex_message_read', 'helm_channex_cleaner_read'\]/);
  assert.doesNotMatch(server, /\.insert\(|\.update\(|\.delete\(|fetch\(/);
});
