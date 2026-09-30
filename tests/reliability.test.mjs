import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SaveQueue } from '../src/lib/save-queue.ts';
import { readInspectionDrafts } from '../src/lib/inspection-drafts.ts';
import { availableCount, claimDeployReload, isStaleDeployError } from '../src/lib/recovery.ts';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('older acknowledgements never clear newer edits; writes are serialized and intermediate edits coalesce', async () => {
  const first = deferred(); const second = deferred(); const calls = []; const acknowledgements = [];
  const queue = new SaveQueue((value) => { calls.push(value); return calls.length === 1 ? first.promise : second.promise; }, () => {}, (value) => acknowledgements.push(value));
  queue.enqueue('draft', 'old');
  queue.enqueue('draft', 'middle');
  queue.enqueue('draft', 'latest');
  assert.deepEqual(calls, ['old']);
  first.resolve('old saved'); await tick();
  assert.deepEqual(calls, ['old', 'latest']);
  assert.deepEqual(acknowledgements, []);
  assert.equal(queue.snapshot().get('draft').value, 'latest');
  second.resolve('latest saved'); await queue.flush();
  assert.equal(queue.snapshot().size, 0);
  assert.deepEqual(acknowledgements, ['latest saved']);
});

test('network rejection keeps the latest value for a successful reconnect retry', async () => {
  let online = false; const calls = [];
  const queue = new SaveQueue(async (value) => { calls.push(value); if (!online) throw new TypeError('Failed to fetch'); }, () => {});
  queue.enqueue('card', { status: 'issue', photo_urls: ['https://example.test/evidence.jpg'] });
  await queue.flush();
  assert.equal(queue.snapshot().get('card').status, 'failed');
  online = true; await queue.retry();
  assert.equal(queue.snapshot().size, 0);
  assert.deepEqual(calls[0], calls[1]);
});

test('one failed card does not stop other cards from syncing', async () => {
  const queue = new SaveQueue(async (value) => { if (value === 'bad') throw new Error('offline'); }, () => {});
  queue.enqueue('one', 'bad', false); queue.enqueue('two', 'good', false);
  await queue.flush();
  assert.deepEqual([...queue.snapshot().keys()], ['one']);
  assert.equal(queue.snapshot().get('one').status, 'failed');
});

test('a failure for an old revision cannot mark a newer successful edit as failed', async () => {
  const old = deferred();
  const queue = new SaveQueue((value) => value === 'old' ? old.promise : Promise.resolve(), () => {});
  queue.enqueue('draft', 'old'); queue.enqueue('draft', 'new');
  old.reject(new Error('connection lost')); await queue.flush();
  assert.equal(queue.snapshot().size, 0);
});

const card = { cardKey: 'item::_', itemId: 'item', zoneId: null };
const mark = { item_id: 'item', zone_id: null, status: 'issue', notes: 'Check sink', photo_urls: ['https://example.test/photo.jpg'] };
test('a pending inspection survives reload with evidence and is removed only after server acknowledgement', async () => {
  let disk = null;
  const write = (entries) => { disk = entries.size ? JSON.stringify({ version: 1, entries: [...entries].map(([key, entry]) => [key, entry.value]) }) : null; };
  const first = new SaveQueue(async () => { throw new Error('offline'); }, write);
  first.enqueue(card.cardKey, mark); await first.flush(); first.dispose();
  assert.ok(disk);
  const restored = readInspectionDrafts(disk, [card]);
  assert.deepEqual(restored.get(card.cardKey), mark);
  const success = deferred(); const second = new SaveQueue(() => success.promise, write);
  for (const [key, value] of restored) second.restore(key, value);
  const sync = second.retry(); assert.ok(disk);
  success.resolve(); await sync; assert.equal(disk, null);
});

test('recovered marks wait for retry and are not replayed when another card is edited', async () => {
  const calls = []; const queue = new SaveQueue(async (value) => { calls.push(value); }, () => {});
  queue.restore('recovered', 'old device draft'); queue.enqueue('other', 'new'); await queue.flush();
  assert.deepEqual(calls, ['new']);
  await queue.retry(); assert.deepEqual(calls, ['new', 'old device draft']);
});

test('restore rejects corrupt data, unknown cards, invalid statuses, and invalid photo URLs', () => {
  assert.equal(readInspectionDrafts('{broken', [card]).size, 0);
  for (const changed of [{ item_id: 'foreign' }, { zone_id: 'foreign' }, { status: 'complete' }, { photo_urls: ['javascript:alert(1)'] }, { notes: 42 }]) {
    assert.equal(readInspectionDrafts(JSON.stringify({ version: 1, entries: [[card.cardKey, { ...mark, ...changed }]] }), [card]).size, 0);
  }
});

test('disposing a queue prevents late writes from starting or clearing its persisted backup', async () => {
  const first = deferred(); const calls = []; let backup;
  const queue = new SaveQueue((value) => { calls.push(value); return first.promise; }, (entries) => { backup = [...entries].map(([, e]) => e.value); });
  queue.enqueue('draft', 'old'); queue.enqueue('draft', 'new'); queue.dispose();
  first.resolve(); await queue.flush();
  assert.deepEqual(calls, ['old']); assert.deepEqual(backup, ['new']);
});

test('a same-turn edit after an empty flush still drains', async () => {
  const calls = []; const queue = new SaveQueue(async (v) => { calls.push(v); }, () => {});
  void queue.flush(); queue.enqueue('draft', 'edit'); await tick();
  assert.deepEqual(calls, ['edit']); assert.equal(queue.snapshot().size, 0);
});

test('unavailable counts are distinct from a real zero', () => {
  assert.equal(availableCount({ count: null, error: { message: 'unavailable' } }), null);
  assert.equal(availableCount({ count: 0, error: null }), 0);
  assert.equal(availableCount({ count: 12, error: null }), 12);
  assert.equal(availableCount({ count: 0, error: 'failed' }), null);
});

test('stale-deploy recovery reloads once and tolerates blocked storage', () => {
  const values = new Map(); const storage = { getItem: (k) => values.get(k), setItem: (k, v) => values.set(k, v) };
  assert.equal(claimDeployReload(storage, 1_000_000), true);
  assert.equal(claimDeployReload(storage, 1_000_001), false);
  assert.equal(claimDeployReload({ getItem() { throw new Error('blocked'); }, setItem() {} }), false);
  assert.equal(claimDeployReload({ getItem() { return null; }, setItem() { throw new Error('quota'); } }), false);
  assert.equal(isStaleDeployError(new Error('Loading chunk 42 failed')), true);
  assert.equal(isStaleDeployError(new Error('Database unavailable')), false);
});

// Render actual TSX components with isolated data sources. No production reads/writes.
const require = createRequire(import.meta.url);
function loadComponent(path, mocks = {}) {
  const output = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const compiled = { exports: {} };
  new Function('require', 'module', 'exports', output)((id) => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    throw new Error(`Unmocked import: ${id}`);
  }, compiled, compiled.exports);
  return compiled.exports;
}
const blank = () => null;
test('actual deployment recovery screen always renders actionable controls', () => {
  const { default: ErrorPage } = loadComponent('../src/app/error.tsx', {
    '@/lib/recovery': { claimDeployReload, isStaleDeployError },
    '@/components/HelmMasthead': { HelmMasthead: blank }, '@/components/HelmFooter': { HelmFooter: blank },
  });
  const html = renderToStaticMarkup(React.createElement(ErrorPage, { error: new Error('Loading chunk 42 failed'), unstable_retry() {} }));
  assert.match(html, /Reload page/); assert.match(html, /Back to Helm/); assert.match(html, /HELM-PAGE-UPDATE/);
  assert.doesNotMatch(html, /Updating to the latest version/);
});

async function dashboard({ dbError = null, reviewError = false } = {}) {
  const chain = new Proxy({}, { get(_, key) { if (key === 'then') return (done) => Promise.resolve({ count: dbError ? null : 0, data: [], error: dbError }).then(done); return () => chain; } });
  const link = ({ children, href }) => React.createElement('a', { href }, children);
  const { Stat } = loadComponent('../src/components/Stat.tsx', { 'next/link': { default: link, __esModule: true } });
  const mocks = {
    'next/link': { default: link, __esModule: true }, '@/lib/recovery': { availableCount },
    '@/lib/supabase-admin': { supabaseAdmin: { from: () => chain }, isServiceConfigured: true },
    '@/components/Stat': { Stat }, '@/components/RetryDashboard': { RetryDashboard: () => React.createElement('button', null, 'Retry unavailable data') },
    '@/lib/revenue-date-range': { computeDateRange: () => ({ rangeStart: '', rangeEnd: '' }) },
    '@/lib/revenue-snapshot': { computeRevenueSnapshot: async () => ({ portfolio: { totalPayout: 0 } }) },
    '@/lib/operations': { loadOperationsData: async () => ({ totalCount: 0, inspectionDoneCount: 0 }) },
    '@/lib/reviews': { getReviewWindowStats: async () => { if (reviewError) throw new Error('offline'); return { total: 0, fiveStar: 0, belowFive: 0 }; } },
  };
  for (const name of ['HelmMasthead', 'HelmFooter', 'TeamActivity', 'HomeFeedTabs', 'ForMeFeed', 'AskHelm', 'OccupancyCalendar', 'CleaningsStrip', 'AiStatusBanner', 'ConciergeAlerts', 'HelmHero']) mocks[`@/components/${name}`] = { [name]: blank };
  mocks['@/components/HelmHero'] = { HelmHero: ({ title }) => React.createElement('h1', null, title) };
  mocks['@/components/HomeFeedTabs'] = { HomeFeedTabs: () => React.createElement('section', null, 'Personalized work feed') };
  mocks['@/components/AskHelm'] = { AskHelm: () => React.createElement('section', null, 'Ask Helm') };
  const { default: Home } = loadComponent('../src/app/page.tsx', mocks);
  return renderToStaticMarkup(await Home());
}
test('dashboard renders failed count queries as unavailable, never an empty urgent queue', async () => {
  const html = await dashboard({ dbError: { message: 'database offline' } });
  assert.match(html, /Unavailable/); assert.match(html, /priority data unavailable/); assert.match(html, /Retry unavailable data/);
  assert.doesNotMatch(html, /no high-priority slips/);
});
test('dashboard preserves legitimate zero counts and zero payout', async () => {
  const html = await dashboard();
  assert.match(html, /no high-priority slips/); assert.match(html, /\$0/);
  assert.doesNotMatch(html, /Some information couldn/);
});
test('dashboard distinguishes review fetch failure from no reviews', async () => {
  const html = await dashboard({ reviewError: true });
  assert.match(html, /review data unavailable/); assert.doesNotMatch(html, /no reviews in last 30 days/);
});

test('homepage uses Today and puts live work ahead of Ask Helm', async () => {
  const html = await dashboard();
  assert.match(html, /<h1>Today<\/h1>/);
  assert.ok(html.indexOf('Personalized work feed') < html.indexOf('Ask Helm'));
  assert.doesNotMatch(html, /clear view/i);
});
