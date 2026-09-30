import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
function load(path, mocks = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => {
    if (id in mocks) return mocks[id];
    if (id === 'react/jsx-runtime' || id === 'react') return require(id);
    throw Error(`Unexpected import ${id}`);
  }, module, module.exports);
  return module.exports;
}
const types = load('../src/lib/field-types.ts');
const statuses = load('../src/lib/field-packet-status.ts');
const blank = () => null;
const packet = (id, trade = 'inspection', status = 'submitted') => ({ id, title: `Packet ${id}`, trade, status, visit_date: '2026-09-29', submitted_at: '2026-09-29T12:00:00Z', awarded_contractor_id: 'worker', stop_count: 1 });

test('review loader pages all submitted trades and throws on partial failure', async () => {
  const calls = []; let fail = false;
  const db = { from(table) { assert.equal(table, 'inspection_packets'); return this; }, select() { return this; }, eq(key, value) { assert.deepEqual([key, value], ['status', 'submitted']); return this; }, order() { return this; }, range(from, to) { calls.push([from, to]); return Promise.resolve(fail && from > 0 ? { error: {} } : { data: from === 0 ? Array.from({ length: 500 }, (_, i) => packet(String(i))) : [packet('last', 'maintenance')] }); } };
  const { loadFieldReview, fieldReviewCounts } = load('../src/lib/field-review.ts', { '@/lib/field-db': { fieldDb: () => db }, '@/lib/field-types': types });
  const rows = await loadFieldReview();
  assert.equal(rows.length, 501);
  assert.deepEqual(calls, [[0,499], [500,999]]);
  assert.deepEqual(fieldReviewCounts([...rows, packet('legacy', null)]), { inspection: 501, maintenance: 1, cleaning: 0, creative: 0 });
  fail = true; await assert.rejects(loadFieldReview(), /Could not load/);
});

async function board(review, trade = 'inspection') {
  const submitted = [packet('inspection'), packet('maintenance', 'maintenance')];
  const chain = { select() { return this; }, in() { return this; }, then(done) { return Promise.resolve({ data: [{ id: 'worker', full_name: 'Sample Contractor', trade: 'inspection', status: 'active' }] }).then(done); } };
  const { default: Board } = load('../src/app/fieldwork/packets/page.tsx', {
    'next/link': ({ children, ...props }) => React.createElement('a', props, children),
    '@/components/NavTabCount': { RefreshNavCounts: blank },
    '@/components/HelmMasthead': { HelmMasthead: blank }, '@/components/FieldTabs': { FieldTabs: blank }, '@/components/HelmFooter': { HelmFooter: blank },
    '@/components/RetryDashboard': { RetryDashboard: () => React.createElement('button', null, 'Retry unavailable data') },
    '@/lib/field-review': { loadFieldReview: async () => { if (review === null) throw Error('offline'); return review; } },
    '@/lib/field-db': { isFieldConfigured: true, fieldDb: () => ({ from: () => chain }) },
    '@/lib/field-packets': { loadPackets: async () => [...submitted, packet('working', 'inspection', 'published')], loadInspectionCalendar: async () => ({ days: [], rows: [], missingProps: [] }), loadOfficeAssignedPacketIds: async () => new Set() },
    '@/lib/field-types': types, '@/lib/field-packet-status': statuses,
    '@/components/FieldAvatar': { FieldAvatar: blank }, '@/components/SubmitButton': { SubmitButton: blank },
    './InspectionCalendar': { InspectionCalendar: () => React.createElement('div', null, 'CALENDAR') }, './SentFlash': { SentFlash: blank }, './actions': {},
  });
  return renderToStaticMarkup(await Board({ searchParams: Promise.resolve({ trade }) }));
}

test('inspector landing exposes both trades above calendar, with named review links and no duplicate submitted rows', async () => {
  const html = await board([packet('inspection'), packet('maintenance', 'maintenance')]);
  assert.match(html, /Needs review · 2/);
  assert.match(html, /Handymen/); assert.match(html, /Sample Contractor/);
  assert.match(html, /aria-label="Review Packet maintenance"/);
  assert.ok(html.indexOf('Review Packet maintenance') < html.indexOf('CALENDAR'));
  const work = html.slice(html.indexOf('Out to contractors'));
  assert.doesNotMatch(work, /Packet inspection|Packet maintenance/);
  assert.match(work, /Packet working/);
});

test('handyman landing preserves the all-trade queue', async () => {
  const html = await board([packet('inspection'), packet('maintenance', 'maintenance')], 'maintenance');
  assert.match(html, /Review Packet inspection/); assert.match(html, /Review Packet maintenance/);
});

test('failed queue has a retry and never reports zero; successful empty queue is explicit', async () => {
  const failed = await board(null); assert.match(failed, /Couldn’t load/); assert.match(failed, /Retry unavailable data/); assert.doesNotMatch(failed, /No packets awaiting|Needs review · 0/);
  const empty = await board([]); assert.match(empty, /Needs review · 0/); assert.match(empty, /No packets awaiting approval/);
});
