import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAvailabilityRequest, validateAvailabilityRequest, availabilityRequestDigest } from '../channex-staging/availability-request.ts';
import { inventoryDigest, type InventoryJob } from '../channex-staging/inventory-outbox.ts';
import { emptyInventoryJournal, recordInventoryCommand, inventoryAttemptAudit } from '../channex-staging/inventory-journal.ts';
import type { InventoryJournal } from '../channex-staging/inventory-journal.ts';
const property_id = '11111111-1111-4111-8111-111111111111', room_type_id = '22222222-2222-4222-8222-222222222222';
const values = [{ property_id, room_type_id, date: '2027-02-01', availability: 0 as const }];
const days = [{ date: '2027-02-01', available: 0 as const, stopSell: true }, { date: '2027-02-02', available: 1 as const, stopSell: false }];
const job: InventoryJob = { id: 'fixture', environment: 'staging', connection: 'test', property: 'home', generation: 1, version: 1,
  days, digest: inventoryDigest(days), status: 'leased', attempts: 0, nextAttemptAt: 0, token: 'fixture:1', leaseUntil: 60000 };

test('exact delta accepts a valid subset of the desired date window', () => {
  const request = createAvailabilityRequest(values, 100);
  assert.deepEqual(validateAvailabilityRequest(request, job, 101), request);
  assert.equal(request.digest, availabilityRequestDigest(request.body));
  assert.equal(JSON.parse(request.body).values.length, 1);
});

test('unknown or non-availability fields are rejected even with a recomputed hash', () => {
  const request = createAvailabilityRequest(values, 100);
  for (const value of [{ ...values[0], rate: 100 }, { ...values[0], min_stay: 2 }, { ...values[0], guest: 'Fictional' },
    { ...values[0], availability: 2 }, { ...values[0], room_type_id: 'invalid' }]) {
    const body = JSON.stringify({ values: [value] });
    assert.throws(() => validateAvailabilityRequest({ ...request, body, digest: availabilityRequestDigest(body) }, job, 101));
  }
});

test('wrong dates, duplicate dates, ordering, mixed routes and values cannot bind to the plan', () => {
  for (const data of [[{ ...values[0], date: '2027-02-03' }], [{ ...values[0], availability: 1 as const }],
    [values[0], values[0]], [{ ...values[0], date: '2027-02-02', availability: 1 as const }, values[0]],
    [values[0], { ...values[0], date: '2027-02-02', availability: 1 as const, property_id: room_type_id }],
    [values[0], { ...values[0], date: '2027-02-02', availability: 1 as const, room_type_id: property_id }]]) {
    assert.throws(() => validateAvailabilityRequest(createAvailabilityRequest(data, 100), job, 101));
  }
});

test('duplicate JSON keys and noncanonical raw bytes are rejected rather than rewritten', () => {
  const request = createAvailabilityRequest(values, 100);
  for (const body of [' ' + request.body, request.body.replace('"availability":0', '"availability":1,"availability":0')]) {
    assert.throws(() => validateAvailabilityRequest({ ...request, body, digest: availabilityRequestDigest(body) }, job, 101));
  }
});

test('endpoint, digest, fields and request lifetime are validated on replay', () => {
  const request = createAvailabilityRequest(values, 100);
  for (const changed of [{ ...request, digest: '0'.repeat(64) }, { ...request, url: 'https://app.channex.io/api/v1/availability' },
    { ...request, expiresAt: 5200 }, { ...request, headers: { 'user-api-key': 'fictional' } }]) {
    assert.throws(() => validateAvailabilityRequest(changed as typeof request, job, 101));
  }
  for (const at of [99, 30100, NaN, Infinity]) assert.throws(() => validateAvailabilityRequest(request, job, at));
});

test('legacy dispatches remain readable and visibly lack request evidence', async () => {
  let journal: InventoryJournal = emptyInventoryJournal();
  const store = { read: async () => ({ version: journal.commands.length, journal }),
    append: async (_v: number, next: InventoryJournal) => { journal = next; return true; } };
  const intent = { id: job.id, environment: job.environment, property: job.property, connection: job.connection,
    generation: job.generation, version: job.version, days: job.days };
  await recordInventoryCommand(store, { kind: 'enqueue', intent, now: 0 });
  await recordInventoryCommand(store, { kind: 'claim', id: job.id, now: 0, leaseMs: 60000 });
  await recordInventoryCommand(store, { kind: 'dispatch', id: job.id, token: job.token!, now: 100,
    context: { environment: job.environment, connection: job.connection, property: job.property,
      generation: job.generation, version: job.version, digest: job.digest, authority: 'helm', enabled: true, complete: true, freshUntil: 60000 } });
  await recordInventoryCommand(store, { kind: 'accepted', id: job.id, token: job.token!, task: 'legacy-task' });
  const audit = inventoryAttemptAudit(journal)[0];
  assert.equal(audit.request, null); assert.deepEqual(audit.receipt, { task: 'legacy-task', binding: null });
  assert.equal(audit.canVerify, false);
});


test('500-day full availability request retains every date and rejects day 501', () => {
  const start = Date.parse('2026-11-01T00:00:00Z');
  const data = Array.from({length: 501}, (_, i) => ({ property_id, room_type_id,
    date: new Date(start + i * 86400000).toISOString().slice(0,10), availability: (i % 3 ? 1 : 0) as 0 | 1 }));
  const fullDays = data.slice(0,500).map(v => ({date:v.date, available:v.availability, stopSell:v.availability === 0}));
  const fullJob = {...job, days:fullDays, digest:inventoryDigest(fullDays)};
  const request = createAvailabilityRequest(data.slice(0,500),100);
  assert.equal(JSON.parse(validateAvailabilityRequest(request,fullJob,101).body).values.length,500);
  assert.throws(() => createAvailabilityRequest(data,100));
  const changed = structuredClone(fullJob); changed.days[499].available = changed.days[499].available ? 0 : 1;
  assert.throws(() => validateAvailabilityRequest(request,changed,101));
});


test('historical five-second requests replay only within their original lifetime', () => {
  const request = { ...createAvailabilityRequest(values, 100), expiresAt: 5100 };
  assert.deepEqual(validateAvailabilityRequest(request, job, 5099), request);
  assert.throws(() => validateAvailabilityRequest(request, job, 5100));
  for (const lifetime of [4999, 5001, 29999, 30001, 60000]) {
    assert.throws(() => validateAvailabilityRequest({...request, expiresAt:100+lifetime}, job,101));
  }
});
