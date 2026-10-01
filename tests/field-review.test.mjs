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

async function board(review, trade = 'inspection', focus, packets) {
  const submitted = [packet('inspection'), packet('maintenance', 'maintenance')];
  const chain = { select() { return this; }, in() { return this; }, then(done) { return Promise.resolve({ data: [{ id: 'worker', full_name: 'Sample Contractor', trade: 'inspection', status: 'active' }] }).then(done); } };
  const { default: Board } = load('../src/app/fieldwork/packets/page.tsx', {
    '@/lib/operating-date': { operatingDate: () => '2026-09-30' },
    'next/link': ({ children, ...props }) => React.createElement('a', props, children),
    '@/components/NavTabCount': { RefreshNavCounts: blank },
    '@/components/HelmMasthead': { HelmMasthead: blank }, '@/components/FieldTabs': { FieldTabs: blank }, '@/components/HelmFooter': { HelmFooter: blank },
    '@/components/RetryDashboard': { RetryDashboard: () => React.createElement('button', null, 'Retry unavailable data') },
    '@/lib/field-review': { loadFieldReview: async () => { if (review === null) throw Error('offline'); return review; } },
    '@/lib/field-db': { isFieldConfigured: true, fieldDb: () => ({ from: () => chain }) },
    '@/lib/field-packets': { loadPackets: async () => packets ?? [...submitted, packet('working', 'inspection', 'published')], loadInspectionCalendar: async () => ({ days: [], rows: [], missingProps: [] }), loadOfficeAssignedPacketIds: async () => new Set() },
    '@/lib/field-types': types, '@/lib/field-packet-status': statuses,
    '@/components/FieldAvatar': { FieldAvatar: blank }, '@/components/SubmitButton': { SubmitButton: blank },
    './InspectionCalendar': { InspectionCalendar: () => React.createElement('div', null, 'CALENDAR') }, './SentFlash': { SentFlash: blank }, './actions': {},
  });
  return renderToStaticMarkup(await Board({ searchParams: Promise.resolve({ trade, focus }) }));
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

test('failed queue stays visible; an empty default queue is quiet and a filtered queue explains its empty state', async () => {
  const failed = await board(null); assert.match(failed, /Couldn’t load/); assert.match(failed, /Retry unavailable data/); assert.doesNotMatch(failed, /No packets awaiting|Needs review · 0/);
  const empty = await board([]); assert.doesNotMatch(empty, /Needs review|No packets awaiting approval/);
  const focused = await board([], 'inspection', 'review'); assert.match(focused, /Needs review · 0/); assert.match(focused, /No packets awaiting approval/);
});


test('trade badge destinations show only the matching submitted packets, including legacy inspectors', async () => {
  const rows = [packet('inspector'), packet('legacy', null), packet('handyman', 'maintenance')];
  const inspectors = await board(rows, 'inspection', 'review');
  assert.match(inspectors, /Needs review · 2/);
  assert.match(inspectors, /Review Packet inspector/);
  assert.match(inspectors, /Review Packet legacy/);
  assert.doesNotMatch(inspectors, /Review Packet handyman|CALENDAR|Out to contractors/);
  const handymen = await board(rows, 'maintenance', 'review');
  assert.match(handymen, /Needs review · 1/);
  assert.match(handymen, /Review Packet handyman/);
  assert.doesNotMatch(handymen, /Review Packet inspector/);
});

test('field summary links filter to the exact packets counted and hide unrelated history', async () => {
  const active = (id, status, date) => ({ ...packet(id, 'inspection', status), submitted_at: null, visit_date: date });
  const packets = [active('late', 'claimed', '2026-09-29'), active('today', 'in_progress', '2026-09-30'), active('soon', 'published', '2026-10-01'), active('later', 'published', '2026-10-10'), active('old-draft', 'draft', '2026-09-29'), active('new-draft', 'draft', '2026-10-01'), active('history', 'approved', '2026-09-29')];
  for (const [focus, id, heading] of [['late','late','Late visits'], ['today','today','Visits today'], ['unclaimed','soon','Unassigned soon'], ['drafts','old-draft','Visits to reschedule']]) {
    const html = await board([], 'inspection', focus, packets);
    assert.match(html, new RegExp(heading + ' · 1'));
    assert.match(html, new RegExp('Packet ' + id));
    for (const p of packets.filter(p => p.id !== id)) assert.doesNotMatch(html, new RegExp('Packet ' + p.id));
    assert.doesNotMatch(html, /CALENDAR|Completed ·/);
    assert.match(html, new RegExp('focus=' + focus + '#field-results" aria-current="page"'));
  }
});
