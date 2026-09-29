import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';
import * as catalog from '../property-capture-catalog.ts';

const compiled = Object.fromEntries(Object.entries({ capture: '../../app/properties/actions.ts', walk: '../../app/properties/[id]/onboarding-actions.ts', cert: '../../app/properties/[id]/actions.ts' }).map(([k, path]) => [k,
  ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
]));
type Req = { table: string; method: string; body: Record<string, unknown>; params: URLSearchParams };
function fixture(options: { signedIn?: boolean; fail?: (r: Req) => boolean; missing?: (r: Req) => boolean; failRoom?: string; failAccess?: boolean } = {}) {
  const requests: Req[] = [], notes = new Map<string, Record<string, unknown>>(), roomWrites: string[] = [], refreshed: string[] = [];
  const client = createClient('https://synthetic.supabase.co', 'synthetic-key', { auth: { persistSession: false }, global: { fetch: async (input, init) => {
    const url = new URL(String(input));
    const r: Req = { table: url.pathname.split('/').at(-1)!, method: init?.method || 'GET', body: init?.body ? JSON.parse(String(init.body)) : {}, params: url.searchParams };
    requests.push(r);
    if (options.fail?.(r)) return new Response(JSON.stringify({ message: 'Synthetic rejection', code: 'TEST' }), { status: 400 });
    let data: unknown = r.params.get('select') === 'id' && r.table === 'properties' ? [{ id: 'home-a' }] : null;
    if (r.table === 'property_notes') {
      if (r.method === 'POST') { if (!notes.has(String(r.body.id))) notes.set(String(r.body.id), { ...r.body }); }
      else { const row = notes.get((r.params.get('id') || '').slice(3)); data = row && 'eq.' + row.property_id === r.params.get('property_id') ? row : null; }
    }
    if (r.method === 'PATCH' && new Headers(init?.headers).get('accept')?.includes('vnd.pgrst.object')) data = options.missing?.(r) ? null : { id: 'home-a' };
    else if (options.missing?.(r)) data = r.method === 'PATCH' ? [] : null;
    return new Response(data == null ? 'null' : JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  } } });
  const deps: Record<string, unknown> = {
    'node:crypto': { randomUUID }, '@supabase/supabase-js': { createClient: () => client }, '@/lib/supabase-admin': { supabaseAdmin: client },
    '@/auth': { auth: async () => options.signedIn === false ? null : { user: { email: 'staff@example.test' } } },
    'next/cache': { revalidatePath: (p: string) => refreshed.push(p) },
    '@/lib/ai/property-capture': catalog,
    '@/lib/property-access': { ACCESS_COLUMNS: ['wifi_name'], upsertPropertyAccess: async () => ({ error: options.failAccess ? 'Synthetic access failure' : null }) },
    '@/lib/property-rooms': { getPropertyRooms: async () => [], upsertPropertyRoom: async (r: { name: string }) => {
      roomWrites.push(r.name); return r.name === options.failRoom ? { ok: false, error: 'Synthetic room failure' } : { ok: true, id: r.name };
    } },
  };
  // The real server actions and real PostgREST builder; only external I/O is synthetic.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function load(kind: string): Record<string, (...args: any[]) => Promise<any>> {
    const exports = {};
    runInNewContext(compiled[kind], { exports, console: { error() {} }, process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://synthetic.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-key' } }, require: (n: string) => deps[n] || {} });
    return exports;
  }
  const actions = load('capture'); deps['@/app/properties/actions'] = actions;
  return { actions, walk: load('walk'), cert: load('cert'), notes, requests, roomWrites, refreshed };
}
const column = (value: string, key = 'bedrooms'): catalog.CaptureItem => ({ target: 'column', column: key, value, noteTitle: null, noteBody: null, noteTag: null, guestFacing: false, sourceText: value, confidence: 'high' });
const note = (id: string = randomUUID()): catalog.CaptureItem => ({ target: 'note', column: null, value: null, noteId: id, noteTitle: 'Synthetic note', noteBody: 'Keep this detail', noteTag: null, guestFacing: false, sourceText: 'detail', confidence: 'high' });
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

describe('property capture save recovery', () => {
  for (const value of ['unknown', 'n/a', 'two', '--', '.', '']) test(`does not turn ${JSON.stringify(value)} into zero`, async () => {
    const f = fixture(); const r = await f.actions.applyPropertyCaptureAction('home-a', [column(value)]);
    assert.equal(r.ok, false); assert.equal(f.requests.length, 0);
  });
  for (const [value, expected] of [['0', 0], ['2.5', 3], ['3 bedrooms', 3]] as const) test(`preserves numeric coercion ${value}`, async () => {
    const f = fixture(); assert.equal((await f.actions.applyPropertyCaptureAction('home-a', [column(value)])).ok, true);
    assert.equal(f.requests[0].body.bedrooms, expected);
  });
  test('invalid numbers remain visible in a mixed successful capture', async () => {
    const f = fixture(); const r = await f.actions.applyPropertyCaptureAction('home-a', [column('unknown'), note()]);
    assert.equal(r.ok, true); assert.equal(r.columns, 0); assert.equal(r.notes, 1); assert.equal(r.skipped.length, 1);
  });
  test('stable note ID survives an uncertain response without inserting another note', async () => {
    const f = fixture(), item = note();
    assert.equal((await f.actions.applyPropertyCaptureAction('home-a', [item])).ok, true);
    assert.equal((await f.actions.applyPropertyCaptureAction('home-a', [item])).ok, true);
    assert.equal(f.notes.size, 1);
    assert.ok(f.requests.filter(r => r.method === 'POST').every(r => r.params.get('on_conflict') === 'id'));
  });
  test('retrying a partially saved batch reports the confirmed note and never duplicates it', async () => {
    let failing = true; const f = fixture({ fail: r => r.table === 'properties' && failing }), item = note();
    const r = await f.actions.applyPropertyCaptureAction('home-a', [column('3'), item]);
    assert.equal(r.ok, false); assert.deepEqual(plain(r.completedIndices), [1]); assert.equal(r.notes, 1);
    failing = false;
    assert.equal((await f.actions.applyPropertyCaptureAction('home-a', [column('3'), item])).ok, true);
    assert.equal(f.notes.size, 1);
  });
  test('a failed confirmation read can be retried safely', async () => {
    let failing = true; const f = fixture({ fail: r => r.table === 'property_notes' && r.method === 'GET' && failing }), item = note();
    assert.equal((await f.actions.applyPropertyCaptureAction('home-a', [item])).ok, false); assert.equal(f.notes.size, 1);
    failing = false; assert.equal((await f.actions.applyPropertyCaptureAction('home-a', [item])).ok, true); assert.equal(f.notes.size, 1);
  });
  test('notes that failed to insert are not claimed as completed', async () => {
    const f = fixture({ fail: r => r.table === 'property_notes' && r.method === 'POST' });
    const r = await f.actions.applyPropertyCaptureAction('home-a', [column('3'), note()]);
    assert.equal(r.ok, false); assert.deepEqual(plain(r.completedIndices), [0]); assert.equal(r.notes, 0);
  });
  test('conflicting IDs never overwrite another note or falsely report success', async () => {
    const f = fixture(), item = note(); await f.actions.applyPropertyCaptureAction('home-a', [item]);
    assert.equal((await f.actions.applyPropertyCaptureAction('home-a', [{ ...item, noteBody: 'Changed after uncertainty' }])).ok, false);
    assert.equal((await f.actions.applyPropertyCaptureAction('other-home', [item])).ok, false);
    assert.equal(f.notes.get(item.noteId!)?.body, item.noteBody);
  });
  test('note IDs are validated before any write; older callers still work', async () => {
    const f = fixture(); assert.equal((await f.actions.applyPropertyCaptureAction('home-a', [note('invalid')])).ok, false); assert.equal(f.requests.length, 0);
    const old = note(); delete old.noteId; assert.equal((await f.actions.applyPropertyCaptureAction('home-a', [old])).ok, true);
  });
  test('missing property rows do not report fields saved', async () => {
    const f = fixture({ missing: r => r.table === 'properties' }); const r = await f.actions.applyPropertyCaptureAction('home-a', [column('3')]);
    assert.equal(r.ok, false); assert.equal(r.columns, 0); assert.deepEqual(plain(r.completedIndices), []);
  });
  test('access-field routing retains its existing separate write path and progress', async () => {
    const f = fixture({ failAccess: true }); const r = await f.actions.applyPropertyCaptureAction('home-a', [column('Synthetic network', 'wifi_name'), note()]);
    assert.equal(r.ok, false); assert.deepEqual(plain(r.completedIndices), [1]); assert.ok(f.requests.every(r => r.table === 'property_notes'));
  });
  test('unauthenticated capture cannot read or write', async () => {
    const f = fixture({ signedIn: false }); assert.equal((await f.actions.applyPropertyCaptureAction('home-a', [note()])).ok, false); assert.equal(f.requests.length, 0);
  });
});

describe('walkthrough partial progress', () => {
  const args = () => ({ propertyId: 'home-a', rooms: [{ name: 'Kitchen', roomType: 'kitchen' }, { name: 'Bath', roomType: 'bathroom' }], roomItems: [{ roomName: 'Kitchen', kind: 'amenity', value: 'Toaster', guestFacing: false }, { roomName: 'Bath', kind: 'amenity', value: 'Hair dryer', guestFacing: false }], captureItems: [] });
  test('a later room failure reports only rooms and facts confirmed saved', async () => {
    const f = fixture({ failRoom: 'Bath' }); const r = await f.walk.applyWalkthroughAction(args());
    assert.equal(r.ok, false); assert.equal(r.rooms, 1); assert.equal(r.roomFacts, 1); assert.deepEqual(plain(r.completedRooms), ['Kitchen']); assert.ok(f.refreshed.length);
  });
  test('a later capture failure retains both room and note progress', async () => {
    const f = fixture({ fail: r => r.table === 'properties' }); const r = await f.walk.applyWalkthroughAction({ ...args(), captureItems: [column('3'), note()] });
    assert.equal(r.ok, false); assert.equal(r.rooms, 2); assert.equal(r.roomFacts, 2); assert.equal(r.notes, 1); assert.deepEqual(plain(r.completedCaptureIndices), [1]);
  });
  test('successful walkthrough reports skipped numeric fields', async () => {
    const f = fixture(); const r = await f.walk.applyWalkthroughAction({ ...args(), captureItems: [column('unknown'), note()] });
    assert.equal(r.ok, true); assert.equal(r.skipped.length, 1); assert.equal(r.columns, 0);
  });
});

describe('certificate ID save confirmation', () => {
  for (const mode of ['fail', 'missing'] as const) test(`${mode} cannot report a saved certificate`, async () => {
    const f = fixture({ [mode]: () => true }); assert.equal((await f.cert.updateTaxCertId('home-a', 'C123456')).ok, false); assert.deepEqual(f.refreshed, []);
  });
  test('confirmed save and explicit clearing work without changing any money fields', async () => {
    const f = fixture(); for (const value of ['C123456', null]) {
      assert.equal((await f.cert.updateTaxCertId('home-a', value)).ok, true);
    }
    assert.deepEqual(f.requests.map(r => r.body.tax_cert_id), ['C123456', null]);
    assert.ok(f.requests.every(r => Object.keys(r.body).sort().join(',') === 'last_synced_at,tax_cert_id' && r.params.get('id') === 'eq.home-a'));
  });
});
