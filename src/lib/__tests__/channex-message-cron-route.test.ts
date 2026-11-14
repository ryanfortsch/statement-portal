import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url), { registerHooks } = require('node:module');
const url = new URL('../../app/api/cron/channex-messages/route.ts', import.meta.url).href;
const symbol = Symbol.for('helm.message-cron-test');
let calls = 0, newCalls = 0, fail = false, newFail = false, ok = true;
const secret = process.env.CRON_SECRET;
(globalThis as unknown as Record<symbol, unknown>)[symbol] = {
  executeNewStayScheduleTick: async () => { newCalls++; if (newFail) throw Error('PRIVATE new-stay inputs');
    return { state: 'disabled', ok: true, stays: [] }; },
  executeRetainedMessageTick: async () => { calls++; if (fail) throw Error('PRIVATE credentials');
    return { state: 'disabled', ok, stays: [] }; },
};
const hook = registerHooks({ resolve(s: string, c: { parentURL?: string }, next: (s: string, c: unknown) => unknown) {
  if (c.parentURL === url) {
    if (s === 'next/server') return { url: pathToFileURL(require.resolve('next/server')).href, shortCircuit: true };
    if (s.endsWith('/runtime-config')) return { url: new URL('../channex-messaging/runtime-config.ts', import.meta.url).href, shortCircuit: true };
    if (s.endsWith('/pilot-runtime.server')) return { url: 'data:text/javascript,' + encodeURIComponent(
      `export const executeRetainedMessageTick=globalThis[Symbol.for('helm.message-cron-test')].executeRetainedMessageTick;`), shortCircuit: true };
    if (s.endsWith('/new-stay-schedule.server')) return { url: 'data:text/javascript,' + encodeURIComponent(
      `export const executeNewStayScheduleTick=globalThis[Symbol.for('helm.message-cron-test')].executeNewStayScheduleTick;`), shortCircuit: true };
    throw Error('Unmocked route dependency: ' + s);
  } return next(s, c);
} });
const route = await import(url) as { GET: (r: Request) => Promise<Response>; HEAD: () => Promise<Response>; POST?: unknown };
hook.deregister();
after(() => {
  delete (globalThis as unknown as Record<symbol, unknown>)[symbol];
  if (secret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = secret;
});
beforeEach(() => { calls = 0; newCalls = 0; newFail = false; fail = false; ok = true; process.env.CRON_SECRET = 'synthetic-cron'; });
const request = (token = 'Bearer synthetic-cron', query = '') => new Request('https://helm.synthetic.test/api/cron/channex-messages' + query,
  { headers: { authorization: token, cookie: 'synthetic-owner-session' } });
test('route only accepts exact cron credential; browser session or query cannot execute', async () => {
  assert.equal((await route.GET(request(''))).status, 401);
  assert.equal((await route.GET(request('Bearer wrong'))).status, 401);
  assert.equal((await route.GET(request(undefined, '?sendId=forged'))).status, 400);
  assert.equal(route.POST, undefined); assert.equal((await route.HEAD()).status, 405);
  delete process.env.CRON_SECRET; assert.equal((await route.GET(request())).status, 401);
  assert.equal(calls, 0); assert.equal(newCalls, 0);
});
test('authorized ticks run once and return uncached redacted status; failure is not retried', async () => {
  const out = await route.GET(request()); assert.equal(out.status, 200);
  assert.equal(out.headers.get('cache-control'), 'private, no-store'); assert.equal(calls, 1);
  ok = false; assert.equal((await route.GET(request())).status, 503); assert.equal(calls, 2);
  fail = true; const unavailable = await route.GET(request());
  assert.equal(unavailable.status, 503); assert.equal(calls, 3);
  assert.deepEqual(await unavailable.json(), { state: 'unavailable', ok: false, stays: [], newStays: { state: 'disabled', ok: true, stays: [] } });
  assert.equal(newCalls, 3);
});
test('new scheduling failure does not prevent retained dispatch/receipt work', async () => {
  newFail = true; const response = await route.GET(request());
  assert.equal(response.status, 503); assert.equal(calls, 1); assert.equal(newCalls, 1);
  assert.deepEqual(await response.json(), { state: 'disabled', ok: false, stays: [],
    newStays: { state: 'unavailable', ok: false, stays: [] } });
});
