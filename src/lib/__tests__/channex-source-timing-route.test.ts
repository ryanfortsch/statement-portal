import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { registerHooks } = require('node:module');
const url = new URL('../../app/api/channex/message-preparation/capture/route.ts', import.meta.url).href;
const symbol = Symbol.for('helm.source-timing-route-test');
let owner = true, reads = 0, commits = 0, fail = false;
const capture = { rows: [], startedAt: '2026-11-11T00:00:00Z', checkedAt: '2026-11-11T00:00:01Z' };
const fixture = {
  requireOwnerEmail: async () => { if (!owner) throw Error(); return 'owner@synthetic.test'; },
  messagePreparationDeps: () => { reads++; return {}; },
  captureSourceTiming: async (_env: unknown, deps: { commit: (c: unknown) => Promise<unknown> }) => deps.commit(capture),
  supabaseAdmin: { rpc: async (name: string, args: unknown) => {
    commits++;
    assert.equal(name, 'helm_channex_capture_source_timing');
    assert.deepEqual(args, { p_rows: [], p_started_at: capture.startedAt, p_checked_at: capture.checkedAt, p_actor: 'owner@synthetic.test' });
    return fail ? { error: 'PRIVATE SQL error', data: null } : { error: null, data: { saved: 1 } };
  } },
};
(globalThis as unknown as Record<symbol, unknown>)[symbol] = fixture;
const modules: Record<string, string[]> = {
  '@/lib/helm-access-server': ['requireOwnerEmail'], '@/lib/supabase-admin': ['supabaseAdmin'],
  '@/lib/channex-messaging/preparation.server': ['messagePreparationDeps'],
  '@/lib/channex-messaging/source-timing-capture': ['captureSourceTiming'],
};
const hook = registerHooks({ resolve(s: string, c: { parentURL?: string }, next: (s: string, c: unknown) => unknown) {
  if (c.parentURL === url) {
    if (s === 'next/server') return { url: pathToFileURL(require.resolve('next/server')).href, shortCircuit: true };
    if (modules[s]) return { url: 'data:text/javascript,' + encodeURIComponent(
      `const f=globalThis[Symbol.for('helm.source-timing-route-test')];` + modules[s].map(n => `export const ${n}=f.${n};`).join('\n')), shortCircuit: true };
    throw Error('Unmocked route dependency: ' + s);
  }
  return next(s, c);
} });
const { POST } = await import(url) as { POST: (r: Request) => Promise<Response> };
hook.deregister();
after(() => { delete (globalThis as unknown as Record<symbol, unknown>)[symbol]; });
beforeEach(() => { owner = true; reads = commits = 0; fail = false; });
const request = (body = '{"action":"capture_source_timing"}', origin = 'https://helm.synthetic.test', type = 'application/json') =>
  new Request('https://helm.synthetic.test/api/channex/message-preparation/capture', {
    method: 'POST', body, headers: { origin, 'content-type': type },
  });
test('owner and same-origin checks run before source reads or database writes', async () => {
  owner = false; assert.equal((await POST(request())).status, 403); owner = true;
  assert.equal((await POST(request(undefined, 'https://foreign.test'))).status, 403);
  assert.equal((await POST(request(undefined, ''))).status, 403);
  assert.equal((await POST(request(undefined, undefined, 'text/plain'))).status, 403);
  assert.equal(reads + commits, 0);
});
test('the action accepts no supplied clock, booking, source identity or oversized payload', async () => {
  for (const body of ['null', '[]', '{}', '{', JSON.stringify({ action: 'capture_source_timing', rows: [] }),
    JSON.stringify({ action: 'capture_source_timing', bookingId: 'forged' }), ' '.repeat(81)])
    assert.equal((await POST(request(body))).status, 400);
  assert.equal(reads + commits, 0);
});
test('explicit owner capture supplies the authenticated actor and disables caching', async () => {
  const r = await POST(request()); assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.equal(reads, 1); assert.equal(commits, 1);
});
test('an uncertain database result is not presented as a definite failed write or retried', async () => {
  fail = true;
  const r = await POST(request()), result = await r.json();
  assert.equal(r.status, 503); assert.equal(result.captureStatus, 'unconfirmed');
  assert.equal(result.jobsCreated + result.messagesSent, 0); assert.equal(commits, 1);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});
