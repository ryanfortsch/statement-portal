import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CleanerSmsTransport, validCleanerSmsText, type CleanerSmsFetcher } from '../channex-messaging/cleaner-sms-transport.ts';
import { QUO_LINES } from '../quo-lines.ts';
const to = '+12025550123', text = 'HELMTEST private cleaner schedule https://helm.risingtidestr.com/c/0123456789abcdef/stays';
const key = 'HELMTEST_API_KEY', secret = 'a'.repeat(64);
const now = Date.parse('2026-11-24T14:00:00Z');
const row = () => ({ id: 'ACHELMTEST1', from: QUO_LINES.ops.number, phoneNumberId: QUO_LINES.ops.id,
  to: [to], text, direction: 'outgoing', status: 'queued', media: [],
  createdAt: '2026-11-24T14:00:00Z', updatedAt: '2026-11-24T14:00:00Z' });
function fixture(response?: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let time = now;
  const fetcher: CleanerSmsFetcher = async (url, init) => {
    calls.push({ url, init }); return response ? response(url, init) : Response.json({ data: row() }, { status: init.method === 'POST' ? 202 : 200 });
  };
  const config = { apiKey: key, receiptKey: secret, keyId: 'test-v1', fetcher, clock: () => time };
  const transport = new CleanerSmsTransport({ ...config, sendEnabled: true });
  return { transport, config, calls, advance: (ms: number) => { time += ms; } };
}
test('default transport cannot send; explicit claim required before every POST', async () => {
  const f = fixture(); let claims = 0;
  assert.deepEqual(await new CleanerSmsTransport(f.config).send(to, text, async () => { claims++; return true; }), { state: 'not_sent' });
  for (const claim of [async () => false, async () => { throw Error('HELMTEST secret'); }])
    assert.deepEqual(await f.transport.send(to, text, claim), { state: 'not_sent' });
  assert.equal(claims, 0); assert.equal(f.calls.length, 0);
});
test('Quo 202 is acceptance, bound to the exact ops line, one recipient and body', async () => {
  const f = fixture();
  const result = await f.transport.send(to, text, async attempt => {
    assert.deepEqual(attempt, f.transport.attempt(to, text)); assert.ok(Object.isFrozen(attempt)); return true;
  });
  assert.equal(result.state, 'accepted'); assert.ok(result.state === 'accepted'); assert.equal(result.status, 'queued');
  const call = f.calls[0];
  assert.equal(call.url, 'https://api.quo.com/v1/messages'); assert.equal(call.init.method, 'POST');
  assert.equal(call.init.redirect, 'error'); assert.equal(call.init.cache, 'no-store'); assert.ok(call.init.signal);
  assert.equal((call.init.headers as Record<string, string>).Authorization, key);
  assert.deepEqual(JSON.parse(String(call.init.body)), { content: text, from: QUO_LINES.ops.number, to: [to] });
  for (const privateValue of [to, text, secret, key, '0123456789abcdef']) assert.ok(!JSON.stringify(result).includes(privateValue));
  assert.equal((await f.transport.verify(result.receipt)).state, 'verified');
  assert.equal(f.calls[1].url, 'https://api.quo.com/v1/messages/ACHELMTEST1'); assert.equal(f.calls[1].init.method, 'GET');
});
test('no phone, unresolved field, mask, oversized or control-character text reaches a claim', async () => {
  const f = fixture(); let claims = 0;
  for (const [target, body] of [[to, ''], [to, '   '], [to, 'x'.repeat(1601)], [to, '{{checkin}}'],
    [to, '[door_code]'], [to, '••••'], [to, 'hello\u0000'], ['2025550123', text], ['+12025550123, +12025550124', text],
    [QUO_LINES.guests.number, text], [QUO_LINES.owners.number, text], [QUO_LINES.ops.number, text]]) {
    assert.equal((await f.transport.send(target, body, async () => { claims++; return true; })).state, 'not_sent');
  }
  assert.equal(claims, 0); assert.equal(f.calls.length, 0);
  assert.equal(validCleanerSmsText('🙂'.repeat(1600)), true); assert.equal(validCleanerSmsText('🙂'.repeat(1601)), false);
});
test('bad keys, wrong key version and unreviewed line overrides fail closed', async () => {
  const f = fixture();
  for (const patch of [{ apiKey: '' }, { apiKey: 'bad\nheader' }, { receiptKey: 'weak' }, { keyId: '../key' }])
    assert.throws(() => new CleanerSmsTransport({ ...f.config, ...patch }));
  const prev = process.env.QUO_FROM_NUMBER;
  try { process.env.QUO_FROM_NUMBER = QUO_LINES.guests.number; assert.throws(() => new CleanerSmsTransport(f.config)); }
  finally { if (prev === undefined) delete process.env.QUO_FROM_NUMBER; else process.env.QUO_FROM_NUMBER = prev; }
  assert.equal((await f.transport.verify({ ...f.transport.attempt(to, text)!, keyId: 'wrong', providerMessageId: 'ACHELMTEST1' })).state, 'unconfirmed');
  assert.equal(f.calls.length, 0);
});
test('HMAC is keyed, domain-separated and versioned; plain numbers are never audit values', () => {
  const f = fixture(); const other = new CleanerSmsTransport({ ...f.config, receiptKey: 'b'.repeat(64) });
  const version = new CleanerSmsTransport({ ...f.config, keyId: 'test-v2' });
  assert.notEqual(f.transport.attempt(to, text)!.targetHmac, other.attempt(to, text)!.targetHmac);
  assert.notEqual(f.transport.attempt(to, text)!.targetHmac, version.attempt(to, text)!.targetHmac);
  assert.notEqual(f.transport.fingerprint('target', to), f.transport.fingerprint('recipient', to));
});
for (const status of [400, 401, 402, 403, 404]) test(`Quo ${status} is a recorded refusal with no retry or provider error exposure`, async () => {
  const f = fixture(() => Response.json({ error: `${text} ${to} ${key}` }, { status }));
  assert.deepEqual(await f.transport.send(to, text, async () => true), { state: 'rejected', status }); assert.equal(f.calls.length, 1);
});
for (const status of [200, 201, 204, 302, 408, 422, 429, 500, 503]) test(`unexpected Quo ${status} stays unknown, never retried`, async () => {
  const f = fixture(() => new Response(null, { status }));
  assert.deepEqual(await f.transport.send(to, text, async () => true), { state: 'unknown' }); assert.equal(f.calls.length, 1);
});
test('lost provider response remains unknown and discards raw errors', async () => {
  const f = fixture(() => { throw Error(`${key} ${text} ${to}`); });
  assert.deepEqual(await f.transport.send(to, text, async () => true), { state: 'unknown' }); assert.equal(f.calls.length, 1);
});
test('recipient, sender, direction, attachments, body, ID and status must match accepted response', async () => {
  for (const patch of [{ to: ['+12025550124'] }, { to: [to, '+12025550124'] }, { from: QUO_LINES.guests.number },
    { phoneNumberId: QUO_LINES.guests.id }, { direction: 'incoming' }, { text: text + ' changed' },
    { id: 'AC../unsafe' }, { media: [{ url: 'https://example.com/image.png' }] }, { media: null },
    { status: 'received' }, { status: 'unknown' }, { updatedAt: 'bad' }, { createdAt: 'bad' },
    { updatedAt: '2026-11-24T13:00:00Z' }]) {
    const f = fixture(() => Response.json({ data: { ...row(), ...patch } }, { status: 202 }));
    assert.deepEqual(await f.transport.send(to, text, async () => true), { state: 'unknown' }); assert.equal(f.calls.length, 1);
  }
});
test('malformed, oversized, error-envelope and non-JSON replies remain unknown', async () => {
  for (const response of [() => new Response('no json', { status: 202 }),
    () => new Response('{', { status: 202, headers: { 'Content-Type': 'application/json' } }),
    () => Response.json({ data: row(), errors: [] }, { status: 202 }),
    () => Response.json({ data: row(), extra: 'x'.repeat(32768) }, { status: 202 })]) {
    const f = fixture(response); assert.equal((await f.transport.send(to, text, async () => true)).state, 'unknown');
  }
});
test('receipt times require real ISO dates and bounded clock skew; POST cannot accept an older message', async () => {
  for (const patch of [{ createdAt: '2026-11-24' }, { updatedAt: '2026-11-24T14:00:00' },
    { createdAt: '2026-02-29T14:00:00Z' }, { updatedAt: '2026-11-24T14:01:01Z' },
    { createdAt: '2026-11-24T13:58:59Z' }]) {
    const f = fixture(() => Response.json({ data: { ...row(), ...patch } }, { status: 202 }));
    assert.equal((await f.transport.send(to, text, async () => true)).state, 'unknown');
    assert.equal(f.calls.length, 1);
  }
  for (const patch of [{ updatedAt: '2026-11-24T14:01:01Z' }, { updatedAt: '2026-11-24' }]) {
    const f = fixture(() => Response.json({ data: { ...row(), ...patch } }));
    assert.equal((await f.transport.verify({ ...f.transport.attempt(to, text)!, providerMessageId: 'ACHELMTEST1' })).state, 'unconfirmed');
  }
  const f = fixture(() => Response.json({ data: { ...row(), createdAt: '2026-10-24T14:00:00Z' } }));
  assert.equal((await f.transport.verify({ ...f.transport.attempt(to, text)!, providerMessageId: 'ACHELMTEST1' })).state, 'verified');
});
test('slow, rolled-back or invalid authorization clock prevents POST after a permit', async () => {
  for (const elapsed of [5001, -1, Number.NaN]) {
    const f = fixture(); assert.equal((await f.transport.send(to, text, async () => { f.advance(elapsed); return true; })).state, 'not_sent');
    assert.equal(f.calls.length, 0);
  }
});
test('receipt lookup validates the exact historical target and never falls back to a search or POST', async () => {
  for (const patch of [{ id: 'ACHELMTEST2' }, { text: 'another body' }, { to: ['+12025550124'] }, { status: 'received' }]) {
    const f = fixture(() => Response.json({ data: { ...row(), ...patch } }));
    assert.equal((await f.transport.verify({ ...f.transport.attempt(to, text)!, providerMessageId: 'ACHELMTEST1' })).state, 'unconfirmed');
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].init.method, 'GET');
  }
  const f = fixture();
  for (const providerMessageId of ['../secret', 'ACx?token=secret', 'ACx/../x', 'AC'])
    assert.equal((await f.transport.verify({ ...f.transport.attempt(to, text)!, providerMessageId })).state, 'unconfirmed');
  assert.equal(f.calls.length, 0);
});
