import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createCleanerReceiptInboxDb, ingestCleanerDeliveryReceipt as ingest, drainCleanerReceiptInbox as drain } from '../calderwood-rehearsal/cleaner-receipt-inbox.ts';
import { createCleanerDeliveryDb } from '../calderwood-rehearsal/cleaner-delivery-db.ts';
import type { Envelope } from '../calderwood-rehearsal/cleaner-delivery-history.ts';
const URL = 'https://jgkblfozftcvymvwhhii.supabase.co';
const evidence = { id: 'HELMTEST-early-receipt', providerId: 'HELMTEST-provider-a', recipientId: 'HELMTEST-cleaner-a' };
const now = Date.parse('2030-01-10T14:00:00Z'), key = Buffer.alloc(32, 9).toString('base64');
const body = { id: evidence.id, type: 'message.delivered', data: { object: { id: evidence.providerId,
  to: [evidence.recipientId], phoneNumberId: 'HELMTEST-ops-line', direction: 'outgoing', status: 'delivered', text: 'fictional text to discard' } } };
const signed = () => ({ rawBody: JSON.stringify(body), now, testSigningKey: key,
  signature: `hmac;1;${now};${createHmac('sha256', Buffer.from(key, 'base64')).update(`${now}.${JSON.stringify(body)}`).digest('base64')}` });
const empty = (): Envelope => ({ format: 1, mode: 'cleaner-delivery-synthetic', version: 0, messageId: 'HELMTEST-cleaner-message',
  recipientIds: ['HELMTEST-cleaner-a', 'HELMTEST-cleaner-b'], records: [] });
const accepted = (): Envelope => ({ ...empty(), version: 2, records: [
  { id: 'claim', event: { type: 'start', recipientId: evidence.recipientId, attemptId: 'HELMTEST-attempt-a' } },
  { id: 'response', event: { type: 'result', recipientId: evidence.recipientId, attemptId: 'HELMTEST-attempt-a', state: 'accepted', providerId: evidence.providerId } },
] });
const delivery = (history: Envelope) => createCleanerDeliveryDb(URL, 'synthetic', async url => {
  assert.ok(String(url).endsWith('_read')); return Response.json(history);
});

test('acknowledgement waits for storage and persists only normalized verified IDs', async () => {
  let release!: () => void; const waiting = new Promise<void>(r => { release = r; });
  let saved: unknown; let acknowledged = false;
  const inbox = createCleanerReceiptInboxDb(URL, 'synthetic', async (_url, init) => {
    saved = JSON.parse(String(init?.body)); await waiting; return Response.json('stored');
  });
  const pending = ingest({ inbox, ...signed() }).then(result => { acknowledged = true; return result; });
  await Promise.resolve(); assert.equal(acknowledged, false);
  release(); const result = await pending;
  assert.deepEqual(saved, { incoming_receipt: evidence });
  assert.equal(result.canAcknowledge, true); assert.equal(result.canSend, false);
});

test('invalid authentication never reaches the inbox', async () => {
  const inbox = createCleanerReceiptInboxDb(URL, 'synthetic', async () => { assert.fail('invalid receipt must not persist'); });
  await assert.rejects(ingest({ inbox, ...signed(), signature: null }));
  await assert.rejects(ingest({ inbox, ...signed(), rawBody: JSON.stringify({ ...body, id: 'HELMTEST-forged' }) }));
});

test('uncertain storage response cannot acknowledge; explicit redelivery may confirm the duplicate', async () => {
  let calls = 0;
  const inbox = createCleanerReceiptInboxDb(URL, 'synthetic', async () => Response.json(++calls === 1 ? { uncertain: true } : 'duplicate'));
  await assert.rejects(ingest({ inbox, ...signed() }), /do not acknowledge/);
  assert.equal(calls, 1);
  assert.equal((await ingest({ inbox, ...signed() })).status, 'duplicate'); assert.equal(calls, 2);
});

test('storage rejects wrong hosts, missing keys, malformed pages and unexpected payload fields', async () => {
  assert.throws(() => createCleanerReceiptInboxDb('https://production.example', 'synthetic'));
  assert.throws(() => createCleanerReceiptInboxDb(URL, ''));
  const badPages = [null, {}, [{ sequence: 1, receipt: { ...evidence, recipientId: [evidence.recipientId] } }], [{ sequence: 0, receipt: evidence }], [{ sequence: 1, receipt: { ...evidence, body: 'forbidden' } }],
    [{ sequence: 2, receipt: evidence }, { sequence: 1, receipt: evidence }], [{ sequence: 1, receipt: evidence, extra: true }]];
  for (const page of badPages) {
    const inbox = createCleanerReceiptInboxDb(URL, 'synthetic', async () => Response.json(page));
    await assert.rejects(inbox.pending());
  }
});

test('unmatched early receipts remain pending and do not invoke delivery apply', async () => {
  let calls = 0;
  const inbox = createCleanerReceiptInboxDb(URL, 'synthetic', async url => {
    calls++; assert.ok(String(url).endsWith('_pending')); return Response.json([{ sequence: 1, receipt: evidence }]);
  });
  const result = await drain({ inbox, delivery: delivery(empty()) });
  assert.equal(result.unmatched, 1); assert.equal(result.applied, 0); assert.equal(result.canSend, false); assert.equal(calls, 1);
});

test('matching receipt submits the full next history and completion to one atomic RPC', async () => {
  let saved: Record<string, unknown> | undefined;
  const inbox = createCleanerReceiptInboxDb(URL, 'synthetic', async (url, init) => {
    if (String(url).endsWith('_pending')) return Response.json([{ sequence: 1, receipt: evidence }]);
    assert.ok(String(url).endsWith('_apply')); saved = JSON.parse(String(init?.body)); return Response.json('applied');
  });
  assert.equal((await drain({ inbox, delivery: delivery(accepted()) })).applied, 1);
  assert.equal(saved?.receipt_id, evidence.id); assert.equal(saved?.expected_version, 2);
  const next = saved?.next_history as Envelope;
  assert.equal(next.version, 3);
  assert.deepEqual(next.records[2], { id: `receipt:${evidence.id}`, event: { type: 'result', recipientId: evidence.recipientId,
    attemptId: 'HELMTEST-attempt-a', state: 'delivered', providerId: evidence.providerId } });
});

test('existing direct delivery is repaired without adding another delivery event', async () => {
  const history = accepted(); history.records.push({ id: `receipt:${evidence.id}`, event: { type: 'result',
    recipientId: evidence.recipientId, attemptId: 'HELMTEST-attempt-a', state: 'delivered', providerId: evidence.providerId } }); history.version++;
  const inbox = createCleanerReceiptInboxDb(URL, 'synthetic', async (url, init) => {
    if (String(url).endsWith('_pending')) return Response.json([{ sequence: 1, receipt: evidence }]);
    assert.deepEqual(JSON.parse(String(init?.body)).next_history, history); return Response.json('applied');
  });
  assert.equal((await drain({ inbox, delivery: delivery(history) })).applied, 1);
});

test('concurrent version change is retained for another sweep; uncertain application stops the sweep', async () => {
  for (const answer of ['stale', { uncertain: true }]) {
    let writes = 0;
    const inbox = createCleanerReceiptInboxDb(URL, 'synthetic', async url => {
      if (String(url).endsWith('_pending')) return Response.json([{ sequence: 1, receipt: evidence }]);
      writes++; return Response.json(answer);
    });
    if (answer === 'stale') assert.equal((await drain({ inbox, delivery: delivery(accepted()) })).stale, 1);
    else await assert.rejects(drain({ inbox, delivery: delivery(accepted()) }), /uncertain/);
    assert.equal(writes, 1);
  }
});

test('bounded keyset scans advance past unmatched receipts and return to zero after reaching the end', async () => {
  const rows = Array.from({ length: 5 }, (_, index) => ({ sequence: index + 1, receipt: { ...evidence, id: `HELMTEST-page-${index}` } }));
  const cursors: number[] = [];
  const inbox = createCleanerReceiptInboxDb(URL, 'synthetic', async (_url, init) => {
    const { after_sequence, batch_limit } = JSON.parse(String(init?.body)); cursors.push(after_sequence);
    return Response.json(rows.filter(r => r.sequence > after_sequence).slice(0, batch_limit));
  });
  let cursor = 0, scanned = 0;
  do { const result = await drain({ inbox, delivery: delivery(empty()), afterSequence: cursor, limit: 2 }); cursor = result.nextCursor; scanned += result.scanned; } while (cursor);
  assert.equal(scanned, 5); assert.deepEqual(cursors, [0, 2, 4]);
});

test('receipt-to-recipient mismatch and conflicting ledger identity stop before application', async () => {
  for (const mismatch of [true, false]) {
    const history = accepted();
    if (!mismatch) { history.records.push({ id: `receipt:${evidence.id}`, event: { ...history.records[1].event } }); history.version++; }
    const inbox = createCleanerReceiptInboxDb(URL, 'synthetic', async url => {
      assert.ok(String(url).endsWith('_pending'));
      return Response.json([{ sequence: 1, receipt: { ...evidence, recipientId: mismatch ? 'HELMTEST-cleaner-b' : evidence.recipientId } }]);
    });
    await assert.rejects(drain({ inbox, delivery: delivery(history) }), /match|Conflicting/);
  }
});
