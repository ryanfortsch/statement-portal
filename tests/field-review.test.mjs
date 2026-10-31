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
// The real strip renders in the harness: the board's status words come from it.
const strip = load('../src/app/fieldwork/packets/PacketStatusStrip.tsx', { '@/lib/field-packet-status': statuses });
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
    '@/lib/helm-access-server': { isOwnerSession: async () => true, sessionDispatches: async () => true },
    '@/lib/field-packets': { loadPackets: async () => packets ?? [...submitted, packet('working', 'inspection', 'published')], loadInspectionCalendar: async () => ({ days: [], rows: [], missingProps: [] }), loadOfficeAssignedPacketIds: async () => new Set(), loadOpenMaintenance: async () => [{ id: 'slip-a', property_id: 'home-a', property_name: 'Sample Home', title: 'Sample leak' }] },
    '@/lib/field-types': types, '@/lib/field-packet-status': statuses,
    '@/components/FieldAvatar': { FieldAvatar: blank }, '@/components/SubmitButton': { SubmitButton: blank },
    './InspectionCalendar': { InspectionCalendar: () => React.createElement('div', null, 'CALENDAR') }, './SentFlash': { SentFlash: blank }, './actions': {}, './PacketStatusStrip': strip,
    './MaintenanceBundler': { MaintenanceBundler: ({ slips }) => React.createElement('div', null, `BUNDLER ${slips.length}`) },
  });
  return renderToStaticMarkup(await Board({ searchParams: Promise.resolve({ trade, focus }) }));
}

test('inspector landing lists its own queue above the calendar, with the other trade a link away and no duplicate submitted rows', async () => {
  const html = await board([packet('inspection'), packet('maintenance', 'maintenance')]);
  // Scoped to the lit trade, so the count is the row-1 pill's number.
  assert.match(html, /Needs review · 1/);
  assert.match(html, /Sample Contractor/);
  assert.match(html, /aria-label="Review Packet inspection"/);
  assert.doesNotMatch(html, /Review Packet maintenance/);
  assert.match(html, /1 in other trades:/);
  assert.match(html, /href="\/fieldwork\/packets\?trade=maintenance&amp;focus=review#needs-review"[^>]*>Handymen · 1 →/);
  assert.ok(html.indexOf('Review Packet inspection') < html.indexOf('CALENDAR'));
  const work = html.slice(html.indexOf('Live ·'));
  assert.doesNotMatch(work, /Packet inspection|Packet maintenance/);
  assert.match(work, /Packet working/);
  // The row carries the pipeline strip lit at Open (the stored status is 'published').
  assert.match(work, /aria-label="Open, step 2 of 7: Draft · Open · Claimed · On site · Submitted · Approved · Paid"/);
  assert.doesNotMatch(work, /published|unclaimed/);
});

test('handyman landing shows the handyman queue, with the inspectors a link away', async () => {
  const html = await board([packet('inspection'), packet('maintenance', 'maintenance')], 'maintenance');
  assert.match(html, /Needs review · 1/);
  assert.match(html, /Review Packet maintenance/); assert.doesNotMatch(html, /Review Packet inspection/);
  assert.match(html, /1 in other trades:/);
  assert.match(html, /trade=inspection&amp;focus=review#needs-review"[^>]*>Inspectors · 1 →/);
});

test('each board has one create door and its own planner: the calendar for inspectors, the open slips for handymen', async () => {
  const inspectors = await board([]);
  assert.match(inspectors, /CALENDAR/); assert.doesNotMatch(inspectors, /BUNDLER/);
  assert.match(inspectors, /href="\/fieldwork\/packets\/new\?trade=inspection"[^>]*>\+ Send a job/);
  const handymen = await board([], 'maintenance');
  assert.match(handymen, /BUNDLER 1/); assert.doesNotMatch(handymen, /CALENDAR/);
  assert.match(handymen, /href="\/fieldwork\/packets\/new\?trade=maintenance"[^>]*>\+ Send a job/);
  for (const html of [inspectors, handymen]) assert.doesNotMatch(html, /Maintenance run|packets\/maintenance|packets\/adhoc|packets\/setup/);
  const filtered = await board([], 'maintenance', 'today');
  assert.doesNotMatch(filtered, /BUNDLER/);
});

test('a queue that is empty here but not elsewhere still points at the other trade', async () => {
  const html = await board([packet('maintenance', 'maintenance')]);
  assert.match(html, /Needs review · 0/);
  assert.match(html, /No inspector jobs awaiting approval/);
  assert.match(html, /1 in other trades:/);
});

test('failed queue stays visible; an empty default queue is quiet and a filtered queue explains its empty state', async () => {
  const failed = await board(null); assert.match(failed, /Couldn’t load/); assert.match(failed, /Retry unavailable data/); assert.doesNotMatch(failed, /No jobs awaiting|Needs review · 0/);
  const empty = await board([]); assert.doesNotMatch(empty, /Needs review|No jobs awaiting approval/);
  const focused = await board([], 'inspection', 'review'); assert.match(focused, /Needs review · 0/); assert.match(focused, /No inspector jobs awaiting approval/);
});


test('trade badge destinations show only the matching submitted packets, including legacy inspectors', async () => {
  const rows = [packet('inspector'), packet('legacy', null), packet('handyman', 'maintenance')];
  const inspectors = await board(rows, 'inspection', 'review');
  assert.match(inspectors, /Needs review · 2/);
  assert.match(inspectors, /Review Packet inspector/);
  assert.match(inspectors, /Review Packet legacy/);
  assert.doesNotMatch(inspectors, /Review Packet handyman|CALENDAR|Live ·/);
  const handymen = await board(rows, 'maintenance', 'review');
  assert.match(handymen, /Needs review · 1/);
  assert.match(handymen, /Review Packet handyman/);
  assert.doesNotMatch(handymen, /Review Packet inspector/);
});

test('field summary links filter to the exact packets counted and hide unrelated history', async () => {
  const active = (id, status, date) => ({ ...packet(id, 'inspection', status), submitted_at: null, visit_date: date });
  const packets = [active('late', 'claimed', '2026-09-29'), active('today', 'in_progress', '2026-09-30'), active('soon', 'published', '2026-10-01'), active('later', 'published', '2026-10-10'), active('old-draft', 'draft', '2026-09-29'), active('new-draft', 'draft', '2026-10-01'), active('history', 'approved', '2026-09-29')];
  for (const [focus, id, heading] of [['late','late','Late visits'], ['today','today','Visits today'], ['unclaimed','soon','Open, visit within 2 days'], ['drafts','old-draft','Visits to reschedule']]) {
    const html = await board([], 'inspection', focus, packets);
    assert.match(html, new RegExp(heading + ' · 1'));
    assert.match(html, new RegExp('Packet ' + id));
    for (const p of packets.filter(p => p.id !== id)) assert.doesNotMatch(html, new RegExp('Packet ' + p.id));
    assert.doesNotMatch(html, /CALENDAR|Completed ·/);
    assert.match(html, new RegExp('focus=' + focus + '#field-results" aria-current="page"'));
  }
});
