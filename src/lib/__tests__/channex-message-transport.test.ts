import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ChannexMessageTransport, type MessageScope, type MessageReceipt, type MessageSendResult } from '../channex-messaging/transport.ts';

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const scope: MessageScope = { environment: 'staging', propertyId: id(1), channelId: id(2), provider: 'Airbnb' };
const target = { bookingId: id(3), threadId: id(4) };
const text = 'HELMTEST arrival message — no guest or access details.';
const digest = (v: string) => createHash('sha256').update(v).digest('hex');
const receipt: MessageReceipt = { ...scope, ...target, providerMessageId: id(5), bodySha256: digest(text) };
const rel = (value: string) => ({ data: { id: value } });
const thread = () => ({ id: target.threadId, type: 'message_thread', attributes: { provider: 'Airbnb', is_closed: false },
  relationships: { property: rel(scope.propertyId), channel: rel(scope.channelId), booking: rel(target.bookingId) } });
const message = () => ({ id: id(5), type: 'message', attributes: { sender: 'property', message: text, attachments: [] as unknown[] },
  relationships: { message_thread: rel(target.threadId) } });
const page = (data: unknown[], total = data.length, number = 1) => Response.json({ data, meta: { total, page: number, limit: 100 } });
const allow = async () => true;
function harness(opts: { sendEnabled?: boolean; preflight?: () => Response; post?: () => Response | Promise<Response>; read?: (url: URL) => Response; environment?: 'staging' | 'production' } = {}) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const client = new ChannexMessageTransport({ scope: { ...scope, environment: opts.environment ?? 'staging' }, apiKey: 'HELMTEST-secret',
    sendEnabled: opts.sendEnabled ?? true,
    fetcher: async (input, init) => {
      const url = new URL(input); calls.push({ url, init });
      if (init.method === 'POST') return opts.post ? opts.post() : Response.json({ data: message() });
      if (url.pathname.endsWith('/messages')) return opts.read ? opts.read(url) : page([message()]);
      return opts.preflight ? opts.preflight() : Response.json({ data: thread() });
    } });
  return { client, calls };
}

test('default constructor cannot send; configuration rejects unknown origins/providers and credentials', async () => {
  const client = new ChannexMessageTransport({ scope, apiKey: 'HELMTEST', fetcher: async () => { throw Error('must not fetch'); } });
  assert.deepEqual(await client.sendText({ ...target, text }, allow), { state: 'not_sent', reason: 'disabled' });
  for (const patch of [{ environment: 'https://evil.invalid' }, { propertyId: '../secret' }, { channelId: id(1) + '?token=x' }, { provider: 'Offline' }]) {
    assert.throws(() => new ChannexMessageTransport({ scope: { ...scope, ...patch } as MessageScope, apiKey: 'HELMTEST' }), /Invalid/);
  }
  for (const key of ['', '  ', 'HELMTEST\r\nsecret']) assert.throws(() => new ChannexMessageTransport({ scope, apiKey: key }), /Invalid/);
});

test('real HTTP contract binds thread and POST body; acceptance keeps only a receipt', async () => {
  const { client, calls } = harness();
  let permit = 0;
  const result = await client.sendText({ ...target, text }, async claim => {
    permit++; assert.equal(calls.length, 1);
    assert.deepEqual(claim, { ...scope, ...target, bodySha256: digest(text) });
    return true;
  });
  assert.deepEqual(result, { state: 'accepted', receipt });
  assert.equal(permit, 1);
  assert.equal(calls.length, 2);
  const post = calls[1];
  assert.equal(post.url.href, `https://staging.channex.io/api/v1/message_threads/${target.threadId}/messages`);
  assert.deepEqual(JSON.parse(String(post.init.body)), { message: { message: text } });
  for (const call of calls) {
    assert.equal(call.init.redirect, 'error'); assert.equal(call.init.cache, 'no-store'); assert.ok(call.init.signal);
    assert.equal(new Headers(call.init.headers).get('user-api-key'), 'HELMTEST-secret');
    assert.equal(call.url.searchParams.has('api_key'), false);
  }
  assert.ok(!JSON.stringify(result).includes(text)); assert.ok(!JSON.stringify(result).includes('HELMTEST-secret'));
});

test('production origin is explicit and never falls back to staging', async () => {
  const { client, calls } = harness({ environment: 'production' });
  const result = await client.sendText({ ...target, text }, allow);
  assert.equal(result.state, 'accepted');
  assert.ok(calls.every(c => c.url.origin === 'https://app.channex.io'));
});

for (const key of ['property', 'channel', 'booking'] as const) {
  test(`wrong ${key} blocks before a durable claim or POST`, async () => {
    const row = thread(); row.relationships[key] = rel(id(99));
    const { client, calls } = harness({ preflight: () => Response.json({ data: row }) });
    assert.deepEqual(await client.sendText({ ...target, text }, async () => { throw Error('must not claim'); }), { state: 'not_sent', reason: 'target_mismatch' });
    assert.equal(calls.length, 1);
  });
}
for (const kind of ['provider', 'closed', 'missing_closed', 'id', 'type', 'inquiry'] as const) {
  test(`${kind} mismatch prevents sending`, async () => {
    const row = thread();
    if (kind === 'provider') row.attributes.provider = 'BookingCom';
    if (kind === 'closed') row.attributes.is_closed = true;
    if (kind === 'missing_closed') Reflect.deleteProperty(row.attributes, 'is_closed');
    if (kind === 'id') row.id = id(99);
    if (kind === 'type') row.type = 'booking';
    if (kind === 'inquiry') row.relationships.booking = { data: null } as never;
    const { client, calls } = harness({ preflight: () => Response.json({ data: row }) });
    assert.equal((await client.sendText({ ...target, text }, allow)).state, 'not_sent');
    assert.ok(calls.every(c => c.init.method === 'GET'));
  });
}

test('unavailable preflight does not claim or POST, even with raw provider errors', async () => {
  for (const preflight of [() => new Response('private response', { status: 403 }), () => { throw Error('private network exception'); }, () => new Response('invalid json')]) {
    const { client, calls } = harness({ preflight });
    const result = await client.sendText({ ...target, text }, allow);
    assert.deepEqual(result, { state: 'not_sent', reason: 'thread_unavailable' }); assert.equal(calls.length, 1);
  }
});

test('invalid, unresolved, empty or over-limit messages never reach provider', async () => {
  const { client, calls } = harness();
  for (const value of ['', '  ', '{{listing_lock_code}}', 'unfinished }}', 'x'.repeat(10_241), '🏡'.repeat(2561)]) {
    assert.deepEqual(await client.sendText({ ...target, text: value }, allow), { state: 'not_sent', reason: 'invalid_input' });
  }
  assert.equal((await client.sendText({ ...target, threadId: '../messages', text }, allow)).state, 'not_sent');
  assert.equal(calls.length, 0);
});

test('hold, cancelled booking, lost claim or guard error can stop sending after preflight', async () => {
  for (const guard of [async () => false, async () => { throw Error('sensitive DB exception'); }]) {
    const { client, calls } = harness();
    assert.deepEqual(await client.sendText({ ...target, text }, guard), { state: 'not_sent', reason: 'dispatch_not_authorized' });
    assert.equal(calls.length, 1);
  }
});

test('binding and text cannot be changed while preflight or durable claim is in flight', async () => {
  const input = { ...target, text };
  const mutableScope = { ...scope };
  const calls: RequestInit[] = [];
  const client = new ChannexMessageTransport({ scope: mutableScope, apiKey: 'HELMTEST', sendEnabled: true, fetcher: async (_url, init) => {
    calls.push(init);
    if (init.method === 'GET') { input.threadId = id(99); input.text = 'different'; return Response.json({ data: thread() }); }
    return Response.json({ data: message() });
  } });
  mutableScope.propertyId = id(99);
  assert.equal((await client.sendText(input, allow)).state, 'accepted');
  assert.deepEqual(JSON.parse(String(calls[1].body)), { message: { message: text } });
});

for (const status of [401, 403, 404, 422]) {
  test(`documented HTTP ${status} refusal is rejected without retry`, async () => {
    const { client, calls } = harness({ post: () => new Response('private response', { status }) });
    assert.deepEqual(await client.sendText({ ...target, text }, allow), { state: 'rejected', status });
    assert.equal(calls.filter(c => c.init.method === 'POST').length, 1);
  });
}
for (const status of [201, 204, 302, 408, 429, 500, 503]) {
  test(`HTTP ${status} leaves delivery unknown with one POST`, async () => {
    const { client, calls } = harness({ post: () => new Response(null, { status }) });
    assert.deepEqual(await client.sendText({ ...target, text }, allow), { state: 'unknown', reason: 'unexpected_response' });
    assert.equal(calls.filter(c => c.init.method === 'POST').length, 1);
  });
}

test('timeout and malformed/oversized responses remain unknown and never expose bodies', async () => {
  for (const post of [() => { throw Error('secret timeout'); }, () => new Response('private non-JSON reply'), () => new Response('x'.repeat(1_048_577)), () => Response.json({ errors: { title: 'private' } }), () => Response.json({ data: message(), meta: { warnings: ['private'] } })]) {
    const { client, calls } = harness({ post });
    const result = await client.sendText({ ...target, text }, allow);
    assert.equal(result.state, 'unknown'); assert.equal(JSON.stringify(result).includes('private'), false);
    assert.equal(calls.filter(c => c.init.method === 'POST').length, 1);
  }
});

for (const kind of ['id', 'type', 'sender', 'thread', 'text', 'attachment'] as const) {
  test(`200 with ${kind} mismatch does not establish acceptance`, async () => {
    const row = message();
    if (kind === 'id') row.id = 'not-an-id';
    if (kind === 'type') row.type = 'task';
    if (kind === 'sender') row.attributes.sender = 'guest';
    if (kind === 'thread') row.relationships.message_thread = rel(id(99));
    if (kind === 'text') row.attributes.message = 'different';
    if (kind === 'attachment') row.attributes.attachments = [{ url: 'https://private.invalid' }];
    const { client } = harness({ post: () => Response.json({ data: row }) });
    assert.deepEqual(await client.sendText({ ...target, text }, allow), { state: 'unknown', reason: 'unexpected_response' });
  });
}

test('receipt readback is GET-only, works while sends disabled and with a closed thread', async () => {
  const row = thread(); row.attributes.is_closed = true;
  const { client, calls } = harness({ sendEnabled: false, preflight: () => Response.json({ data: row }) });
  assert.deepEqual(await client.verifyReceipt(receipt), { state: 'recorded' });
  assert.ok(calls.every(c => c.init.method === 'GET'));
});

test('receipt scopes cannot be mixed across environments, properties, channels, bookings or bodies', async () => {
  const { client, calls } = harness();
  for (const patch of [{ environment: 'production' }, { propertyId: id(99) }, { channelId: id(99) }, { provider: 'BookingCom' }, { bodySha256: 'bad' }, { providerMessageId: '../secret' }]) {
    assert.deepEqual(await client.verifyReceipt({ ...receipt, ...patch } as MessageReceipt), { state: 'unconfirmed' });
  }
  assert.equal(calls.length, 0);
  for (const patch of [{ bookingId: id(99) }, { bodySha256: digest('different') }]) {
    assert.deepEqual(await client.verifyReceipt({ ...receipt, ...patch }), { state: 'unconfirmed' });
  }
  assert.ok(calls.every(c => c.init.method === 'GET'));
});

test('readback locates the exact provider ID on later pages, not just matching text', async () => {
  const earlier = message(); earlier.id = id(6);
  const { client, calls } = harness({ read: url => url.searchParams.get('pagination[page]') === '1' ? page([earlier], 2) : page([message()], 2, 2) });
  assert.deepEqual(await client.verifyReceipt(receipt), { state: 'recorded' });
  assert.equal(calls.length, 3);
});

test('missing, conflicting, duplicate, foreign or malformed history never authorizes a resend', async () => {
  const wrong = message(); wrong.relationships.message_thread = rel(id(99));
  for (const read of [() => page([]), () => page([wrong]), () => page([message(), message()]), () => page([message()], 0), () => new Response('secret malformed'), () => new Response('secret', { status: 500 })]) {
    const { client, calls } = harness({ read });
    assert.deepEqual(await client.verifyReceipt(receipt), { state: 'unconfirmed' });
    assert.ok(calls.every(c => c.init.method === 'GET'));
  }
});

test('readback stops at five pages and treats inconsistent pagination as unconfirmed', async () => {
  const make = (n: number) => ({ ...message(), id: id(100 + n) });
  const { client, calls } = harness({ read: url => { const n = Number(url.searchParams.get('pagination[page]')); return page([make(n)], 100, n); } });
  assert.deepEqual(await client.verifyReceipt(receipt), { state: 'unconfirmed' }); assert.equal(calls.length, 6);
  const moving = harness({ read: url => { const n = Number(url.searchParams.get('pagination[page]')); return page([make(n)], n + 1, n); } });
  assert.deepEqual(await moving.client.verifyReceipt(receipt), { state: 'unconfirmed' }); assert.equal(moving.calls.length, 3);
});

test('caller can use an atomic claim to stop concurrent workers before POST', async () => {
  const { client, calls } = harness(); let claimed = false;
  const claim = async () => { if (claimed) return false; claimed = true; return true; };
  const results: MessageSendResult[] = await Promise.all([client.sendText({ ...target, text }, claim), client.sendText({ ...target, text }, claim)]);
  assert.deepEqual(results.map(r => r.state).sort(), ['accepted', 'not_sent']);
  assert.equal(calls.filter(c => c.init.method === 'POST').length, 1);
});
