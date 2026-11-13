import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url), { registerHooks } = require('node:module');
const url = new URL('../../app/api/channex/message-preparation/cleaner-enrollment/route.ts', import.meta.url).href;
const symbol = Symbol.for('helm.cleaner-enrollment-route-test');
let owner = true, calls: unknown[] = [], fail = false;
const reference = { captureId: '90000000-0000-4000-8000-000000000001', templateDigest: 'a'.repeat(64) };
const release = { action: 'enroll', ...reference, releaseId: '90000000-0000-4000-8000-000000000002',
 reviewedRecipient:'b'.repeat(64),reviewedRoute:'90000000-0000-4000-8000-000000000003',
 clearance:{sourceEvidenceId:'90000000-0000-4000-8000-000000000004',sourceStoppedAt:'2026-11-12T12:00:00.000Z',sourceDrainedAt:'2026-11-12T13:00:00.000Z'}};
(globalThis as unknown as Record<symbol, unknown>)[symbol] = {
  requireOwnerEmail: async () => { if (!owner) throw Error('PRIVATE'); return 'owner@synthetic.test'; },
  ownerCleanerEnrollment: async (raw: unknown) => { calls.push(raw); if (fail) throw Error('PRIVATE');
    return { state: 'synthetic', canSend: false }; },
};
const modules: Record<string, string[]> = { '@/lib/helm-access-server': ['requireOwnerEmail'],
  '@/lib/channex-messaging/cleaner-runtime.server': ['ownerCleanerEnrollment'] };
const hook = registerHooks({ resolve(s: string, c: { parentURL?: string }, next: (s: string, c: unknown) => unknown) {
  if (c.parentURL === url) {
    if (s === 'next/server') return { url: pathToFileURL(require.resolve('next/server')).href, shortCircuit: true };
    if (s.endsWith('/cleaner-runtime-contract')) return { url: new URL('../channex-messaging/cleaner-runtime-contract.ts', import.meta.url).href, shortCircuit: true };
    if (modules[s]) return { url: 'data:text/javascript,' + encodeURIComponent(`const f=globalThis[Symbol.for('helm.cleaner-enrollment-route-test')];`
      + modules[s].map(n => `export const ${n}=f.${n};`).join('\n')), shortCircuit: true };
    throw Error('Unmocked route dependency: ' + s);
  } return next(s, c);
} });
const route = await import(url) as { POST: (r: Request) => Promise<Response>; GET?: unknown };
hook.deregister();
after(() => { delete (globalThis as unknown as Record<symbol, unknown>)[symbol]; });
beforeEach(() => { owner = true; calls = []; fail = false; });
const request = (raw: BodyInit = JSON.stringify(release), origin = 'https://helm.synthetic.test', type = 'application/json') =>
  new Request('https://helm.synthetic.test/api/channex/message-preparation/cleaner-enrollment', {
    method: 'POST', body: raw, headers: { origin, 'content-type': type },
  });
test('cleaner enrollment require owner, explicit POST and same-origin JSON before accessing the DAL', async () => {
  assert.equal(route.GET, undefined);
  owner = false; assert.equal((await route.POST(request())).status, 403); owner = true;
  for (const origin of ['', 'null', 'https://other.test']) assert.equal((await route.POST(request(undefined, origin))).status, 403);
  assert.equal((await route.POST(request(undefined, undefined, 'text/plain'))).status, 403);
  assert.equal(calls.length, 0);
});
test('bounded request parsing rejects forged actors, missing clearance, unknown fields and invalid UTF-8', async () => {
  for (const raw of ['null', '{}', '[]', '{', ' '.repeat(1501), JSON.stringify({ ...release, clearance: null }),
    JSON.stringify({ ...release, actor: 'forged@synthetic.test' }), JSON.stringify({ ...release, captureId: '../escape' }),
    JSON.stringify({ action: 'capture', enabled: true }), JSON.stringify({ ...reference, action: 'send' }),
    new Uint8Array([0xc3, 0x28])]) assert.equal((await route.POST(request(raw))).status, 400);
  assert.equal(calls.length, 0);
});
test('read-only review and explicit enrollment stay separate and prevent response caching', async () => {
  for (const body of [{ action: 'review', ...reference }, release]) {
    const response = await route.POST(request(JSON.stringify(body)));
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(calls.at(-1), body); assert.equal((await response.json()).canSend, false);
  }
  assert.equal(calls.length, 2);
});
test('uncertain DAL results expose no internals and never retry a release', async () => {
  fail = true; const response = await route.POST(request());
  assert.equal(response.status, 503); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), { state: 'unavailable', canSend: false });
  assert.deepEqual(calls, [release]);
});
