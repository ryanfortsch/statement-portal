import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { fetchPendingCounts, invalidatePendingCounts, subscribePendingCounts } from '../src/lib/pending-count-client.ts';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const response = data => ({ ok: true, json: async () => data });

test('badges share one request, and a confirmed change bypasses the TTL for all listeners', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return response({ guests: calls === 1 ? 2 : 0 }); };
  let offA = () => {}; let offB = () => {};
  try {
    invalidatePendingCounts();
    const values = await Promise.all([fetchPendingCounts(), fetchPendingCounts(), fetchPendingCounts()]);
    assert.equal(calls, 1); assert.equal(values[0].guests, 2);
    const seen = [];
    offA = subscribePendingCounts(() => { void fetchPendingCounts().then(x => seen.push(x.guests)); });
    offB = subscribePendingCounts(() => { void fetchPendingCounts().then(x => seen.push(x.guests)); });
    invalidatePendingCounts(); await tick();
    assert.equal(calls, 2); assert.deepEqual(seen, [0, 0]);
  } finally { offA(); offB(); globalThis.fetch = original; }
});

test('late pre-action count cannot overwrite a post-action count', async () => {
  const original = globalThis.fetch; const old = deferred(); let calls = 0;
  globalThis.fetch = () => ++calls === 1 ? old.promise : Promise.resolve(response({ guests: 0 }));
  try {
    invalidatePendingCounts(); const stale = fetchPendingCounts();
    invalidatePendingCounts(); assert.equal((await fetchPendingCounts()).guests, 0);
    old.resolve(response({ guests: 3 })); assert.equal(await stale, null);
    assert.equal((await fetchPendingCounts()).guests, 0); assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

function route({ guestFailed = false, digestFailed = false, configured = true } = {}) {
  const queries = [];
  const db = { from(table) { queries.push(['from',table]); return this; }, select(...a) { queries.push(['select',...a]); return this; }, eq(...a) { queries.push(['eq',...a]); return this; }, gte(...a) { queries.push(['gte',...a]); return this; }, order(...a) { queries.push(['order',...a]); return this; }, limit(...a) { queries.push(['limit',...a]); return this; }, then(done) { return Promise.resolve(digestFailed ? { error: {} } : { data: [{ id: 'visible' }] }).then(done); } };
  const ok = (...status) => ({ ok: true, data: { approvals: status.map(status => ({ status })) } });
  const mocks = {
    'next/server': { NextResponse: { json: value => value } },
    '@/lib/property-scope': { CAPE_ANN_REGION: 'cape-ann' },
    '@/lib/checkout-schedule': { todayET: () => '2026-09-29' },
    '@/lib/supabase-admin': { supabaseAdmin: db },
    '@/lib/stay-concierge': { isStayConciergeConfigured: () => configured,
      listApprovals: async () => guestFailed ? { ok: false } : ok('pending','scheduled','pending'),
      listOwnerApprovals: async () => ok('scheduled'),
      listCleanerApprovals: async () => ok('pending'),
      listContractorApprovals: async () => ok('pending'),
    },
  };
  const code = ts.transpileModule(readFileSync(new URL('../src/app/api/messaging/pending-count/route.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  new Function('require','module','exports',code)(id => { assert.ok(id in mocks, id); return mocks[id]; }, module, module.exports);
  return { GET: module.exports.GET, queries };
}

test('counts exclude scheduled sends and count only the visible regional digest card', async () => {
  const { GET, queries } = route(); const data = await GET();
  assert.deepEqual(data, { count: 5, guests: 2, owners: 0, cleaners: 2, contractors: 1 });
  assert.ok(queries.some(q => JSON.stringify(q) === JSON.stringify(['eq','region','cape-ann'])));
  assert.ok(queries.some(q => JSON.stringify(q) === JSON.stringify(['limit',1])));
  assert.ok(queries.some(q => JSON.stringify(q) === JSON.stringify(['gte','service_date','2026-09-29'])));
});

test('failed audience stays unavailable while healthy audiences retain their counts', async () => {
  const data = await route({ guestFailed: true }).GET();
  assert.equal(data.guests, null); assert.equal(data.count, null); assert.equal(data.cleaners, 2); assert.equal(data.contractors, 1);
});

test('digest failure never makes the cleaner total look complete', async () => {
  const data = await route({ digestFailed: true }).GET();
  assert.equal(data.cleaners, null); assert.equal(data.guests, 2);
});

test('the native cleaner digest remains counted when concierge is not configured', async () => {
  const data = await route({ configured: false }).GET();
  assert.equal(data.cleaners, 1); assert.equal(data.guests, 0);
});
