import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url), { registerHooks } = require('node:module');
const url = new URL('../../app/api/channex/message-preparation/timing-review/route.ts', import.meta.url).href;
const symbol = Symbol.for('helm.timing-review-route-test');
let owner = true, reads = 0, saves = 0, fail = false;
const body = { action: 'review_timing', bindingId: '90000000-0000-4000-8000-000000000001',
  captureId: '90000000-0000-4000-8000-000000000002', bookingId: '90000000-0000-4000-8000-000000000003' };
const fixture = {
  requireOwnerEmail: async () => { if (!owner) throw Error(); return 'owner@synthetic.test'; },
  loadTimingReviewOverview: async () => { reads++; if (fail) throw Error('PRIVATE'); return { format: 1 }; },
  saveTimingReview: async (raw: unknown) => { saves++; assert.deepEqual(raw, body); if (fail) throw Error('PRIVATE');
    return { state: 'created', bindingId: body.bindingId, canSend: false, jobsCreated: 0, messagesSent: 0 }; },
};
(globalThis as unknown as Record<symbol, unknown>)[symbol] = fixture;
const modules: Record<string, string[]> = { '@/lib/helm-access-server': ['requireOwnerEmail'],
  '@/lib/channex-messaging/timing-review.server': ['loadTimingReviewOverview', 'saveTimingReview'] };
const hook = registerHooks({ resolve(s: string, c: { parentURL?: string }, next: (s: string, c: unknown) => unknown) {
  if (c.parentURL === url) {
    if (s === 'next/server') return { url: pathToFileURL(require.resolve('next/server')).href, shortCircuit: true };
    if (s.endsWith('/timing-review-contract')) return { url: new URL('../channex-messaging/timing-review-contract.ts', import.meta.url).href, shortCircuit: true };
    if (modules[s]) return { url: 'data:text/javascript,' + encodeURIComponent(`const f=globalThis[Symbol.for('helm.timing-review-route-test')];`
      + modules[s].map(n => `export const ${n}=f.${n};`).join('\n')), shortCircuit: true };
    throw Error('Unmocked route dependency: ' + s);
  } return next(s, c);
} });
const { GET, POST } = await import(url) as { GET: () => Promise<Response>; POST: (r: Request) => Promise<Response> };
hook.deregister();
after(() => { delete (globalThis as unknown as Record<symbol, unknown>)[symbol]; });
beforeEach(() => { owner = true; reads = saves = 0; fail = false; });
const request = (raw = JSON.stringify(body), origin = 'https://helm.synthetic.test', type = 'application/json') =>
  new Request('https://helm.synthetic.test/api/channex/message-preparation/timing-review', {
    method: 'POST', body: raw, headers: { origin, 'content-type': type },
  });
test('owner and same-origin boundaries precede every timing-review read and save', async () => {
  owner = false; assert.equal((await GET()).status, 403); assert.equal((await POST(request())).status, 403); owner = true;
  for (const origin of ['', 'https://other.test']) assert.equal((await POST(request(undefined, origin))).status, 403);
  assert.equal((await POST(request(undefined, undefined, 'text/plain'))).status, 403);
  assert.equal(reads + saves, 0);
});
test('timing review accepts only three UUIDs and the action, never supplied provider assertions', async () => {
  for (const raw of ['null', '{}', '[]', '{', ' '.repeat(301), JSON.stringify({ ...body, threadId: body.bindingId }),
    JSON.stringify({ ...body, actor: 'forged@synthetic.test' }), JSON.stringify({ ...body, bookingId: '../escape' }),
    JSON.stringify({ ...body, clocks: {} }), JSON.stringify({ ...body, action: 'send' })])
    assert.equal((await POST(request(raw))).status, 400);
  assert.equal(reads + saves, 0);
});
test('GET reads only, POST saves once, both prevent caching', async () => {
  const get = await GET(); assert.equal(get.status, 200); assert.equal(saves, 0); assert.equal(reads, 1);
  const post = await POST(request()); assert.equal(post.status, 200); assert.equal(saves, 1); assert.equal(reads, 1);
  for (const r of [get, post]) assert.equal(r.headers.get('cache-control'), 'private, no-store');
});
test('uncertain writes retain the requested ID and expose no internals or retries', async () => {
  fail = true; const r = await POST(request()), out = await r.json();
  assert.equal(r.status, 503); assert.equal(out.state, 'uncertain'); assert.equal(out.bindingId, body.bindingId);
  assert.equal(out.jobsCreated + out.messagesSent, 0); assert.equal(out.canSend, false); assert.equal(saves, 1);
  assert.equal(JSON.stringify(out).includes('PRIVATE'), false);
  const get = await GET(); assert.equal(get.status, 503); assert.equal(JSON.stringify(await get.json()).includes('PRIVATE'), false);
});
