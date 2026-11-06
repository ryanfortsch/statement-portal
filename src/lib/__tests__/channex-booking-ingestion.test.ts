import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingestAirbnbBookingRevisions, type AirbnbBookingReceipt, type AirbnbBookingStore, type AirbnbRevisionReader } from '../channex-bookings/ingestion.ts';
import type { AirbnbBookingMapping } from '../channex-bookings/revision.ts';
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mapping: AirbnbBookingMapping = { environment: 'production', propertyId: id(1), roomTypeId: id(2), ratePlanId: id(3), generation: 1 };
function row(n = 4, status = 'new') {
  return { id: id(n), attributes: { booking_id: id(5), property_id: id(1), ota_name: 'Airbnb', ota_reservation_code: 'SYNTHETIC123', status,
    arrival_date: '2027-02-01', departure_date: '2027-02-04', inserted_at: `2026-10-23T12:00:00.${String(n).padStart(6, '0')}Z`,
    rooms: [{ room_type_id: id(2), rate_plan_id: id(3), checkin_date: '2027-02-01', checkout_date: '2027-02-04' }] } };
}
function harness(rows = [row()]) {
  const events: string[] = [], receipts = new Map<string, AirbnbBookingReceipt>();
  const client: AirbnbRevisionReader = {
    inspect: async () => { events.push('inspect'); }, feed: async () => rows,
    revision: async () => rows[0], acknowledge: async r => { events.push(`ack:${r.revisionId}`); },
  };
  const store: AirbnbBookingStore = {
    commit: async revision => {
      events.push(`commit:${revision.revisionId}`);
      if (!receipts.has(revision.revisionId)) receipts.set(revision.revisionId, { revision, canonicalBookingId: id(9),
        outcome: 'applied', committed: true, committedAt: '2026-10-23T13:00:00.000001Z', firstReceivedAt: '2026-10-23T13:00:00.000001Z' });
      return structuredClone(receipts.get(revision.revisionId));
    },
    receipt: async key => { events.push(`read:${key}`); return structuredClone(receipts.get(key)); },
  };
  return { client, store, events, receipts };
}
test('provider revisions are validated and ordered before commit/read/ACK', async () => {
  const h = harness([row(6, 'cancelled'), row(4)]);
  const result = await ingestAirbnbBookingRevisions(h.client, h.store, mapping);
  assert.deepEqual(h.events, ['inspect', `commit:${id(4)}`, `read:${id(4)}`, `ack:${id(4)}`, `commit:${id(6)}`, `read:${id(6)}`, `ack:${id(6)}`]);
  assert.deepEqual(result, { received: 2, applied: 2, stale: 0, acknowledged: 2, completeCoverage: false, canSend: false });
});
test('malformed batch, duplicate IDs and wrong webhook selection perform no writes', async () => {
  const bad = row(6); bad.attributes.property_id = id(8);
  for (const rows of [[row(), bad], [row(), row()], Array.from({ length: 101 }, () => row())]) {
    const h = harness(rows);
    await assert.rejects(() => ingestAirbnbBookingRevisions(h.client, h.store, mapping));
    assert.deepEqual(h.events, ['inspect']);
  }
  const h = harness();
  await assert.rejects(() => ingestAirbnbBookingRevisions(h.client, h.store, mapping, { revisionId: id(7), bookingId: id(5) }));
  assert.deepEqual(h.events, ['inspect']);
});
test('missing or changed durable receipt prevents ACK, including timestamp changes', async () => {
  for (const field of ['missing', 'canonicalBookingId', 'outcome', 'committedAt', 'firstReceivedAt', 'revision']) {
    const h = harness(), read = h.store.receipt;
    h.store.receipt = async key => {
      const r = await read(key) as AirbnbBookingReceipt;
      if (field === 'missing') return null;
      if (field === 'canonicalBookingId') r.canonicalBookingId = id(8);
      if (field === 'outcome') r.outcome = 'stale';
      if (field === 'committedAt') r.committedAt = '2026-10-23T13:00:01Z';
      if (field === 'firstReceivedAt') r.firstReceivedAt = '2026-10-23T12:59:00Z';
      if (field === 'revision') r.revision.checkOut = '2027-02-05';
      return r;
    };
    await assert.rejects(() => ingestAirbnbBookingRevisions(h.client, h.store, mapping));
    assert.equal(h.events.some(e => e.startsWith('ack:')), false);
  }
});
test('lost commit response and lost ACK are replayable without changing the first receipt', async () => {
  for (const stage of ['commit', 'ack']) {
    const h = harness(), commit = h.store.commit, ack = h.client.acknowledge;
    let first = true;
    if (stage === 'commit') h.store.commit = async r => { const saved = await commit(r); if (first) { first = false; throw Error('lost'); } return saved; };
    else h.client.acknowledge = async r => { if (first) { first = false; throw Error('lost'); } await ack(r); };
    await assert.rejects(() => ingestAirbnbBookingRevisions(h.client, h.store, mapping));
    const original = structuredClone(h.receipts.get(id(4)));
    await ingestAirbnbBookingRevisions(h.client, h.store, mapping);
    assert.equal(h.receipts.size, 1); assert.deepEqual(h.receipts.get(id(4)), original);
    assert.equal(h.events.filter(e => e.startsWith('ack:')).length, 1);
  }
});
test('stale durable outcome is acknowledged without claiming a mutation or send', async () => {
  const h = harness(), commit = h.store.commit;
  h.store.commit = async r => { await commit(r); h.receipts.get(r.revisionId)!.outcome = 'stale'; return structuredClone(h.receipts.get(r.revisionId)); };
  const result = await ingestAirbnbBookingRevisions(h.client, h.store, mapping);
  assert.equal(result.applied, 0); assert.equal(result.stale, 1); assert.equal(result.canSend, false);
});
test('invalid config and failed inspect stop before saving; upstream errors are sanitized', async () => {
  const h = harness([]);
  await assert.rejects(() => ingestAirbnbBookingRevisions(h.client, h.store, { ...mapping, generation: 0 }));
  assert.deepEqual(h.events, []);
  h.client.inspect = async () => { throw Error('PRIVATE_SENTINEL'); };
  await assert.rejects(() => ingestAirbnbBookingRevisions(h.client, h.store, mapping), e => e instanceof Error && !e.message.includes('PRIVATE_SENTINEL'));
  assert.equal(h.receipts.size, 0);
});
