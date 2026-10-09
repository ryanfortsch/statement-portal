import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeParentCalendar, readParentCalendar, PARENT_PROPERTY, PARENT_LISTING, PARENT_MAX_AGE_MS } from '../channex-staging/parent-calendar.ts';
import { buildBoardReport, stagingBoardEnabled } from '../channex-staging/board.ts';
import { nights, TEST_START, TEST_END, type Revision } from '../channex-staging/core.ts';
import type { StagingSnapshot } from '../channex-staging/client.ts';

const now = new Date('2026-09-30T18:00:00Z');
const property = { id: PARENT_PROPERTY, calendar_authority: 'guesty' };
const mapping = [{ property_id: PARENT_PROPERTY, listing_id: PARENT_LISTING }];
const rows = () => nights(TEST_START, TEST_END).map((date) => ({ property_id: PARENT_PROPERTY, date, status: 'available', block_type: null as null | string, synced_at: now.toISOString(), block_note: 'PRIVATE', block_created_by: 'PRIVATE' }));
const parent = () => normalizeParentCalendar(property, mapping, rows());
const sources = { channex: { state: 'ready' as const, message: 'ready' }, parent: { state: 'ready' as const, message: 'ready' } };
const snapshot = (bookings: Revision[] = []): StagingSnapshot => ({ mappings: [], bookings, inventory: [] });
const booking = (member: 'front' | 'back' = 'back', status: Revision['status'] = 'new'): Revision => ({ member, status, id: `revision-${member}`, bookingId: `booking-${member}`, checkIn: '2027-02-01', checkOut: '2027-03-01', receivedAt: now.toISOString() });
const cellStates = (report: ReturnType<typeof buildBoardReport>, date = '2027-02-01') => report.cells.filter((cell) => cell.date === date).map((cell) => cell.state);

test('staging board cannot run in production and requires explicit opt-in', () => {
  assert.equal(stagingBoardEnabled({}), false);
  assert.equal(stagingBoardEnabled({ CHANNEX_STAGING_ENABLED: 'true' }), true);
  assert.equal(stagingBoardEnabled({ CHANNEX_STAGING_ENABLED: 'true', NODE_ENV: 'production' }), false);
  assert.equal(stagingBoardEnabled({ CHANNEX_STAGING_ENABLED: 'true', NODE_ENV: 'production', VERCEL_ENV: 'preview' }), true);
  assert.equal(stagingBoardEnabled({ CHANNEX_STAGING_ENABLED: 'true', VERCEL_ENV: 'production' }), false);
});
test('parent normalizer permits only the exact whole-house mapping and removes private fields', () => {
  const result = parent();
  assert.equal(result.nights.length, 120);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|block_note|created_by/);
  assert.throws(() => normalizeParentCalendar({ ...property, calendar_authority: 'helm' }, mapping, rows()));
  assert.throws(() => normalizeParentCalendar(property, [...mapping, { ...mapping[0], listing_id: 'old-unit' }], rows()));
  assert.throws(() => normalizeParentCalendar(property, [{ ...mapping[0], listing_id: 'other' }], rows()));
  assert.throws(() => normalizeParentCalendar(property, mapping, [rows()[0], rows()[0]]));
  assert.throws(() => normalizeParentCalendar(property, mapping, [{ ...rows()[0], property_id: 'other' }]));
  assert.throws(() => normalizeParentCalendar(property, mapping, [{ ...rows()[0], status: 'maybe' }]));
});
test('known whole-house booking and deliberate hold block both units', () => {
  for (const change of [{ status: 'booked' }, { status: 'unavailable', block_type: 'm' }, { block_type: 'o' }]) {
    const data = rows().map((row) => row.date === '2027-02-01' ? { ...row, ...change } : row);
    const report = buildBoardReport(snapshot(), normalizeParentCalendar(property, mapping, data), sources, now);
    assert.deepEqual(cellStates(report), ['blocked', 'blocked', 'blocked']);
    assert.deepEqual(cellStates(report, '2027-02-02'), ['clear', 'clear', 'clear']);
  }
});
test('front/back stay independence and cancellation retain the parent block', () => {
  assert.deepEqual(cellStates(buildBoardReport(snapshot([booking()]), parent(), sources, now)), ['blocked', 'clear', 'blocked']);
  assert.deepEqual(cellStates(buildBoardReport(snapshot([booking('front'), booking('back', 'cancelled')]), parent(), sources, now)), ['blocked', 'blocked', 'clear']);
  assert.deepEqual(cellStates(buildBoardReport(snapshot([booking()]), parent(), sources, now), '2027-03-01'), ['clear', 'clear', 'clear']);
});
test('missing, stale and future parent nights are unverified across all listings', () => {
  const data = parent();
  data.nights = data.nights.filter((night) => night.date !== '2027-02-01');
  assert.deepEqual(cellStates(buildBoardReport(snapshot(), data, sources, now)), ['unknown', 'unknown', 'unknown']);
  for (const age of [PARENT_MAX_AGE_MS + 1, -1]) {
    const old = parent(); old.nights.find((night) => night.date === '2027-02-01')!.syncedAt = new Date(now.getTime() - age).toISOString();
    const report = buildBoardReport(snapshot(), old, sources, now);
    assert.deepEqual(cellStates(report), ['unknown', 'unknown', 'unknown']);
    assert.equal(report.currentParentNights, 119);
  }
});
test('failed Channex or parent reads cannot masquerade as empty calendars', () => {
  assert.ok(buildBoardReport(null, parent(), { ...sources, channex: { state: 'failed', message: '' } }, now).cells.every((cell) => cell.state === 'unknown'));
  assert.ok(buildBoardReport(snapshot(), null, { ...sources, parent: { state: 'unconfigured', message: '' } }, now).cells.every((cell) => cell.state === 'unknown'));
});
test('whole-house/test overlap is surfaced even when the parent copy is stale', () => {
  const data = parent();
  data.nights.find((night) => night.date === '2027-02-01')!.status = 'booked';
  data.nights.find((night) => night.date === '2027-02-01')!.syncedAt = '2026-09-28T12:00:00Z';
  const report = buildBoardReport(snapshot([booking()]), data, sources, now);
  assert.equal(report.overlapNights, 1);
  assert.ok(report.cells.find((cell) => cell.date === '2027-02-01')?.overlap);
});
test('whole-house bridge sends only scoped GETs and never asks for guest details', async () => {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const result = await readParentCalendar({ url: 'https://example.supabase.co', key: 'secret-for-test' }, async (input, init) => {
    const url = new URL(String(input)); calls.push({ url, init });
    return Response.json(url.pathname.endsWith('/properties') ? [property] : url.pathname.endsWith('/guesty_listings') ? mapping : rows());
  });
  assert.equal(result.nights.length, 120);
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.init?.method, 'GET');
    assert.equal(call.init?.cache, 'no-store');
    assert.equal(call.init?.redirect, 'error');
    assert.ok(call.url.search.includes(PARENT_PROPERTY));
    assert.doesNotMatch(call.url.href, /secret-for-test|guest_name|block_note|created_by/);
  }
  assert.equal(calls[2].url.searchParams.get('and'), '(date.gte.2027-01-01,date.lt.2027-05-01)');
});
test('whole-house bridge suppresses raw errors and rejects partial malformed data', async () => {
  await assert.rejects(() => readParentCalendar({ url: 'https://example.supabase.co', key: 'secret' }, async () => new Response('PRIVATE SECRET', { status: 500 })), { message: 'Whole-house calendar read failed' });
  await assert.rejects(() => readParentCalendar({ url: 'https://example.supabase.co', key: 'secret' }, async () => Response.json({ error: 'PRIVATE' })), { message: 'Whole-house property is unavailable' });
});
test('staging routes retain staff auth before reads, GET-only API and explicit environment guard', () => {
  const api = readFileSync(new URL('../../app/api/channels/staging/route.ts', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../../app/channels/staging/page.tsx', import.meta.url), 'utf8');
  assert.match(api, /export async function GET/);
  assert.doesNotMatch(api, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.match(api, /await auth\(\)/);
  assert.match(api, /endsWith\('@risingtidestr.com'\)/);
  assert.ok(api.indexOf('const session = await auth()') < api.indexOf('await loadStagingBoard()'));
  assert.match(api, /if \(!stagingBoardEnabled\(process.env\)\)/);
  assert.ok(api.indexOf('if (!stagingBoardEnabled') < api.indexOf('await loadStagingBoard()'));
  assert.match(api, /private, no-store/);
  assert.match(page, /await auth\(\)/);
  assert.match(page, /redirect\('\/auth\/signin/);
  const loader = readFileSync(new URL('../channex-staging/board.server.ts', import.meta.url), 'utf8');
  assert.match(loader, /import 'server-only'/);
  assert.doesNotMatch(loader, /acknowledge|publishStoppedInventory|saveLedger|getGuestyToken|guestyGet|upsert/);
});
