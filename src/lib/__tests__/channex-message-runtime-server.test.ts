import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { registerHooks } = require('node:module');
const url = new URL('../channex-messaging/pilot-runtime.server.ts', import.meta.url).href;
const symbol = Symbol.for('helm.message-runtime-server-test');
const originalEnv = { ...process.env };
let reads = 0, rpcCalls = 0, enabled = false, expiry = '', token: string | null = null, fail = false;
const rowQuery = { eq: () => rowQuery, abortSignal: (s: AbortSignal) => { assert.ok(s instanceof AbortSignal); return rowQuery; },
  maybeSingle: async () => { reads++; return { data: { access_token: token, expires_at: expiry }, error: fail ? 'PRIVATE' : null }; } };
(globalThis as unknown as Record<symbol, unknown>)[symbol] = {
  retainedPilotConfiguration: () => enabled ? { format: 1, stays: [] } : null,
  supabaseAdmin: {
    from: (name: string) => { assert.equal(name, 'guesty_auth'); return { select: (columns: string) => {
      assert.equal(columns, 'access_token,expires_at'); return rowQuery;
    } }; },
    rpc: () => ({ abortSignal: async (s: AbortSignal) => { assert.ok(s instanceof AbortSignal); rpcCalls++; return { data: true, error: null }; } }),
  },
  runRetainedCalderwoodPilot: async (_manifest: unknown, deps: { rpc: (name: string, args: object) => Promise<unknown>;
    credentials: () => Promise<unknown>; receiptKey: () => Promise<string> }) => {
    assert.equal(await deps.receiptKey(), 'synthetic-channex');
    const [a, b] = await Promise.all([deps.credentials(), deps.credentials()]);
    assert.deepEqual(a, b); await deps.rpc('synthetic', {});
    return { state: 'complete', ok: true, stays: [] };
  },
};
const exportsByModule: Record<string, string[]> = { '@/lib/supabase-admin': ['supabaseAdmin'],
  './runtime-config': ['retainedPilotConfiguration'], './pilot-runtime': ['runRetainedCalderwoodPilot'] };
const hook = registerHooks({ resolve(s: string, c: { parentURL?: string }, next: (s: string, c: unknown) => unknown) {
  if (c.parentURL === url && exportsByModule[s]) return { url: 'data:text/javascript,' + encodeURIComponent(
    `const f=globalThis[Symbol.for('helm.message-runtime-server-test')];`
    + exportsByModule[s].map(n => `export const ${n}=f.${n};`).join('\n')), shortCircuit: true };
  return next(s, c);
} });
const { executeRetainedMessageTick } = await import(url) as { executeRetainedMessageTick: () => Promise<unknown> };
hook.deregister();
after(() => { delete (globalThis as unknown as Record<symbol, unknown>)[symbol];
  if (originalEnv.CHANNEX_PRODUCTION_API_KEY === undefined) delete process.env.CHANNEX_PRODUCTION_API_KEY;
  else process.env.CHANNEX_PRODUCTION_API_KEY = originalEnv.CHANNEX_PRODUCTION_API_KEY;
});
beforeEach(() => {
  reads = 0; rpcCalls = 0; enabled = false; expiry = new Date(Date.now() + 3600_000).toISOString(); token = 'synthetic-token'; fail = false;
  process.env.CHANNEX_PRODUCTION_API_KEY = 'synthetic-channex';
});
test('off server tick exits before cache or RPC access', async () => {
  assert.deepEqual(await executeRetainedMessageTick(), { state: 'disabled', ok: true, stays: [] });
  assert.equal(reads, 0); assert.equal(rpcCalls, 0);
});
test('parallel stay credential requests share one bounded cache read; no OAuth fallback', async () => {
  enabled = true; await executeRetainedMessageTick(); assert.equal(reads, 1); assert.equal(rpcCalls, 1);
});
test('missing, almost expired, malformed or unavailable cache fails without refresh or RPC execution', async () => {
  enabled = true;
  for (const value of [null, '', ' ']) { token = value; await assert.rejects(executeRetainedMessageTick); }
  token = 'synthetic-token';
  for (const value of ['', 'invalid', new Date(Date.now() + 60_000).toISOString()]) { expiry = value; await assert.rejects(executeRetainedMessageTick); }
  expiry = new Date(Date.now() + 3600_000).toISOString(); fail = true; await assert.rejects(executeRetainedMessageTick);
  assert.equal(reads, 7); assert.equal(rpcCalls, 0);
});
