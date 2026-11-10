import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAirbnbAcknowledgmentReader, inspectAirbnbAcknowledgment } from '../channex-bookings/acknowledgment.ts';
import { normalizeAirbnbBookingRevision, type AirbnbBookingMapping } from '../channex-bookings/revision.ts';
import { ingestAirbnbBookingRevisions, type AirbnbBookingReceipt, type AirbnbRevisionReader } from '../channex-bookings/ingestion.ts';

const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mapping: AirbnbBookingMapping = { environment: 'production', propertyId: id(1), roomTypeId: id(2), ratePlanId: id(3), generation: 1 };
function row() {
  return { type: 'booking_revision', id: id(4), attributes: { id: id(4), booking_id: id(5),
    property_id: id(1), ota_name: 'Airbnb', ota_reservation_code: 'SYNTHETICACK123', status: 'new',
    arrival_date: '2027-02-01', departure_date: '2027-02-04', inserted_at: '2026-11-10T12:00:00.123456Z',
    acknowledge_status: 'acknowledged', notes: 'Synthetic arrival preference',
    customer: { name: 'Synthetic', surname: 'Guest', mail: 'guest@example.invalid', phone: '+1 202 555 0100',
      address: null, city: 'Fictional', state: 'CT', country: 'US', zip: null },
    rooms: [{ room_type_id: id(2), rate_plan_id: id(3), checkin_date: '2027-02-01', checkout_date: '2027-02-04' }] } };
}
function harness() {
  const original = row();
  const saved: AirbnbBookingReceipt = { revision: normalizeAirbnbBookingRevision(original, mapping),
    canonicalBookingId: id(9), outcome: 'applied', committed: true,
    committedAt: '2026-11-10T13:00:00.000001Z', firstReceivedAt: '2026-11-10T13:00:00.000001Z' };
  const events: string[] = [];
  const remote = structuredClone(original);
  const client = { inspect: async () => { events.push('inspect'); }, revision: async () => { events.push('provider'); return remote; } };
  const store = { receipt: async () => { events.push('receipt'); return structuredClone(saved); } };
  const run = () => inspectAirbnbAcknowledgment(client, store, mapping, id(4));
  return { original, remote, saved, client, store, events, run };
}
function mask(remote: ReturnType<typeof row>) {
  Object.assign(remote.attributes.customer, { mail: '***', phone: '***', city: '***', state: '***', country: '***' });
  remote.attributes.notes = '***';
}
test('explicit acknowledgment matches an unmasked durable receipt without mutation', async () => {
  const h = harness(), saved = structuredClone(h.saved);
  const result = await h.run();
  assert.equal(result.status, 'confirmed'); assert.equal(result.reason, 'PROVIDER_ACKNOWLEDGED');
  assert.deepEqual(h.events, ['receipt', 'inspect', 'provider', 'receipt']);
  assert.deepEqual(h.saved, saved);
  assert.deepEqual({ ...result, status: undefined, reason: undefined }, {
    status: undefined, reason: undefined, providerWrites: 0, bookingsChanged: 0, messagesSent: 0,
    canRetryAcknowledgment: false, canSend: false, completeCoverage: false,
  });
  assert.ok(!JSON.stringify(result).includes('example.invalid'));
});
test('documented post-ACK masks resolve a lost response while preserving original contact values', async () => {
  const h = harness(), saved = structuredClone(h.saved);
  mask(h.remote);
  const remote = structuredClone(h.remote);
  assert.equal((await h.run()).status, 'confirmed');
  assert.deepEqual(h.saved, saved); assert.deepEqual(h.remote, remote);
});
test('notes-only post-ACK masking preserves explicit null contacts', async () => {
  const h = harness();
  for (const field of ['mail', 'phone', 'address', 'city', 'state', 'country', 'zip']) {
    Object.assign(h.saved.revision.guestDetails, { [field]: null });
    Object.assign(h.remote.attributes.customer, { [field]: null });
  }
  h.remote.attributes.notes = '***';
  assert.throws(() => normalizeAirbnbBookingRevision(h.remote, mapping));
  assert.equal((await h.run()).status, 'confirmed');
  assert.equal(h.saved.revision.guestDetails.notes, 'Synthetic arrival preference');
  assert.equal(h.remote.attributes.notes, '***');
});
test('a lost successful ACK can be inspected without repeating commit or ACK', async () => {
  const h = harness(); let commits = 0, acknowledgments = 0;
  const client: AirbnbRevisionReader = { inspect: h.client.inspect, feed: async () => [h.remote],
    revision: h.client.revision, acknowledge: async () => { acknowledgments++; mask(h.remote); throw Error('lost response'); } };
  const store = { ...h.store, commit: async () => { commits++; return structuredClone(h.saved); } };
  await assert.rejects(() => ingestAirbnbBookingRevisions(client, store, mapping));
  assert.equal((await inspectAirbnbAcknowledgment(h.client, store, mapping, id(4))).status, 'confirmed');
  assert.equal(commits, 1); assert.equal(acknowledgments, 1);
});
test('missing or unknown ACK status is unconfirmed even when data matches', async () => {
  for (const status of ['', 'pending', 'unknown', 'ACKNOWLEDGED']) {
    const h = harness(); h.remote.attributes.acknowledge_status = status;
    assert.equal((await h.run()).status, 'unconfirmed');
  }
  const h = harness(); Reflect.deleteProperty(h.remote.attributes, 'acknowledge_status');
  assert.equal((await h.run()).status, 'unconfirmed');
});
test('masked data without explicit ACK, names masked, or null changed to mask require review', async () => {
  for (const change of [
    (r: ReturnType<typeof row>) => { mask(r); r.attributes.acknowledge_status = 'pending'; },
    (r: ReturnType<typeof row>) => { r.attributes.customer.name = '***'; },
    (r: ReturnType<typeof row>) => { Object.assign(r.attributes.customer, { address: '***' }); },
    (r: ReturnType<typeof row>) => { r.attributes.customer.mail = 'part***'; },
    (r: ReturnType<typeof row>) => { r.attributes.customer.mail = 'other@example.invalid'; },
    (r: ReturnType<typeof row>) => { Reflect.deleteProperty(r.attributes.customer, 'state'); },
  ]) {
    const h = harness(); change(h.remote);
    assert.equal((await h.run()).reason, 'REVISION_MISMATCH');
  }
});
test('optional state absence and explicit null stay distinct', async () => {
  const h = harness(); Reflect.deleteProperty(h.remote.attributes.customer, 'state');
  Reflect.deleteProperty(h.saved.revision.guestDetails, 'state');
  assert.equal((await h.run()).status, 'confirmed');
  Object.assign(h.remote.attributes.customer, { state: null });
  assert.equal((await h.run()).reason, 'REVISION_MISMATCH');
  h.saved.revision.guestDetails.state = null;
  assert.equal((await h.run()).status, 'confirmed');
});
test('wrong resource, booking, revision, mapping, origin, dates, or receipt time cannot confirm ACK', async () => {
  for (const change of [
    (r: ReturnType<typeof row>) => { r.type = 'booking'; },
    (r: ReturnType<typeof row>) => { r.id = id(10); },
    (r: ReturnType<typeof row>) => { r.attributes.booking_id = id(10); },
    (r: ReturnType<typeof row>) => { r.attributes.property_id = id(10); },
    (r: ReturnType<typeof row>) => { r.attributes.rooms[0].rate_plan_id = id(10); },
    (r: ReturnType<typeof row>) => { r.attributes.ota_name = 'Offline'; },
    (r: ReturnType<typeof row>) => { r.attributes.ota_reservation_code = 'HELMTEST-fake'; },
    (r: ReturnType<typeof row>) => { r.attributes.departure_date = '2027-02-05'; },
    (r: ReturnType<typeof row>) => { r.attributes.inserted_at = '2026-11-10T12:00:00.123457Z'; },
  ]) {
    const h = harness(); change(h.remote); assert.equal((await h.run()).reason, 'REVISION_MISMATCH');
  }
});
test('missing, legacy, invalid or differently scoped receipts stop before provider IO', async () => {
  for (const change of [
    (h: ReturnType<typeof harness>) => { h.store.receipt = async () => { throw Error('PRIVATE_SENTINEL'); }; },
    (h: ReturnType<typeof harness>) => { Reflect.deleteProperty(h.saved.revision, 'guestDetails'); },
    (h: ReturnType<typeof harness>) => { h.saved.firstReceivedAt = '2026-11-11T00:00:00Z'; },
    (h: ReturnType<typeof harness>) => { h.saved.revision.mappingGeneration++; },
    (h: ReturnType<typeof harness>) => { h.saved.revision.environment = 'staging'; },
    (h: ReturnType<typeof harness>) => { h.saved.revision.revisionId = id(10); },
  ]) {
    const h = harness(); change(h);
    const result = await h.run(); assert.equal(result.status, 'needs_review');
    assert.ok(!h.events.includes('provider')); assert.ok(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));
  }
});
test('independent receipt changes and disappeared readback require review', async () => {
  for (const field of ['contact', 'booking', 'outcome', 'committedAt', 'missing']) {
    const h = harness(), read = h.store.receipt; let reads = 0;
    h.store.receipt = async () => {
      const r = await read(); if (++reads === 1) return r;
      if (field === 'missing') throw Error('PRIVATE_SENTINEL');
      if (field === 'contact') r.revision.guestDetails.mail = null;
      if (field === 'booking') r.canonicalBookingId = id(10);
      if (field === 'outcome') r.outcome = 'stale';
      if (field === 'committedAt') r.committedAt = '2026-11-10T13:00:01Z';
      return r;
    };
    assert.equal((await h.run()).status, 'needs_review');
  }
});
test('invalid input performs no reads, and caller mapping mutation cannot alter the snapshot', async () => {
  const h = harness();
  assert.equal((await inspectAirbnbAcknowledgment(h.client, h.store, { ...mapping, generation: 0 }, id(4))).reason, 'INVALID_SCOPE');
  assert.equal((await inspectAirbnbAcknowledgment(h.client, h.store, mapping, '../bad')).reason, 'INVALID_SCOPE');
  assert.deepEqual(h.events, []);
  const mutable = { ...mapping }, read = h.store.receipt;
  h.store.receipt = async () => { mutable.generation = 2; return read(); };
  assert.equal((await inspectAirbnbAcknowledgment(h.client, h.store, mutable, id(4))).status, 'confirmed');
});
test('real reader uses bounded fresh GETs on the fixed host, without a feed or ACK call', async () => {
  const h = harness(), calls: { url: string; init: RequestInit | undefined }[] = [];
  mask(h.remote);
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input); calls.push({ url, init });
    if (url.includes('/booking_revisions/')) return Response.json({ data: h.remote });
    const relation = (n: number) => ({ data: { id: id(n) } });
    if (url.includes('/properties/')) return Response.json({ data: { id: id(1) } });
    if (url.includes('/room_types/')) return Response.json({ data: { id: id(2), relationships: { property: relation(1) } } });
    return Response.json({ data: { id: id(3), relationships: { property: relation(1), room_type: relation(2) } } });
  };
  const client = createAirbnbAcknowledgmentReader({ mapping, apiKey: 'chx_synthetic_only' }, fetcher);
  assert.equal((await inspectAirbnbAcknowledgment(client, h.store, mapping, id(4))).status, 'confirmed');
  assert.equal(calls.length, 4);
  assert.equal(new Set(calls.map(c => c.init?.signal)).size, 4);
  for (const c of calls) {
    assert.equal(new URL(c.url).origin, 'https://app.channex.io');
    assert.equal(c.init?.method, 'GET'); assert.equal(c.init?.redirect, 'error'); assert.equal(c.init?.cache, 'no-store');
    assert.ok(c.init?.signal); assert.ok(!c.url.includes('chx_')); assert.ok(!c.url.includes('/feed')); assert.ok(!c.url.endsWith('/ack'));
  }
});
test('HTTP failures, redirects, wrong resources and warnings fail without retry or leaked responses', async () => {
  for (const response of [
    () => new Response('PRIVATE_SENTINEL', { status: 401 }),
    () => new Response('PRIVATE_SENTINEL', { status: 403 }),
    () => new Response('PRIVATE_SENTINEL', { status: 429 }),
    () => new Response('PRIVATE_SENTINEL', { status: 503 }),
    () => Response.json({ data: { ...row(), id: id(20) } }),
    () => Response.json({ data: row(), meta: { warnings: ['PRIVATE_SENTINEL'] } }),
    () => Response.json({ data: row(), errors: ['PRIVATE_SENTINEL'] }),
    () => { throw Error('PRIVATE_SENTINEL'); },
    () => { const r = Response.json({ data: row() }); Object.defineProperty(r, 'redirected', { value: true }); return r; },
  ]) {
    let requests = 0;
    const client = createAirbnbAcknowledgmentReader({ mapping: { ...mapping, environment: 'staging' }, apiKey: 'synthetic' }, async input => {
      requests++; assert.equal(new URL(String(input)).origin, 'https://staging.channex.io'); return response();
    });
    await assert.rejects(() => client.revision(id(4)), e => e instanceof Error && !e.message.includes('PRIVATE_SENTINEL'));
    assert.equal(requests, 1);
  }
});
test('credential and path validation reject before any request', async () => {
  let calls = 0; const fetcher: typeof fetch = async () => { calls++; return Response.json({}); };
  for (const apiKey of ['', ' ', 'synthetic\nkey']) assert.throws(() => createAirbnbAcknowledgmentReader({ mapping, apiKey }, fetcher));
  const client = createAirbnbAcknowledgmentReader({ mapping, apiKey: 'synthetic' }, fetcher);
  await assert.rejects(() => client.revision('../bad')); assert.equal(calls, 0);
});
