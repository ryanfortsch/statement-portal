import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';
import { ChecklistSaveQueue } from '../checklist-save-queue.ts';

const deferred = () => { let resolve!: () => void, reject!: () => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = () => no(Error('Lost response')); }); return { promise, resolve, reject }; };

describe('whole-checklist save queue', () => {
  test('serializes counts and notes that share the same JSON record', async () => {
    const q = new ChecklistSaveQueue(), first = deferred(), calls: string[] = [];
    q.enqueue('have:mugs', async () => { calls.push('count'); await first.promise; });
    q.enqueue('note:closet', async () => { calls.push('note'); });
    assert.deepEqual(calls, ['count']); const flushed = q.flush(); first.resolve();
    assert.equal(await flushed, true); assert.deepEqual(calls, ['count', 'note']); assert.equal(q.getSnapshot().dirty, false);
  });
  test('a stale success cannot discard a newer value, and queued intermediate edits coalesce', async () => {
    const q = new ChecklistSaveQueue(), first = deferred(), values: number[] = [];
    q.enqueue('have:mugs', async () => { values.push(1); await first.promise; });
    q.enqueue('have:mugs', async () => { values.push(2); });
    q.enqueue('have:mugs', async () => { values.push(3); });
    const done = q.flush(); first.resolve(); await done; assert.deepEqual(values, [1, 3]);
  });
  test('an old failure cannot roll back or block a newer draft', async () => {
    const q = new ChecklistSaveQueue(), first = deferred(); let saved = '';
    q.enqueue('note', () => first.promise); q.enqueue('note', async () => { saved = 'new'; });
    const done = q.flush(); first.reject(); assert.equal(await done, true); assert.equal(saved, 'new'); assert.equal(q.getSnapshot().failures, 0);
  });
  test('failed edits remain dirty and block send flush until an explicit retry succeeds', async () => {
    const q = new ChecklistSaveQueue(); let attempts = 0;
    q.enqueue('note', async () => { if (++attempts === 1) throw Error('offline'); });
    assert.equal(await q.flush(), false); assert.equal(q.getSnapshot().failures, 1);
    assert.equal(await q.flush(), false); assert.equal(attempts, 1);
    assert.equal(await q.retry(), true); assert.equal(attempts, 2);
  });
  test('debounced notes are dirty immediately and flush sends only the latest text', async () => {
    const q = new ChecklistSaveQueue(), values: string[] = [];
    q.enqueue('note', async () => { values.push('old'); }, 60000);
    q.enqueue('note', async () => { values.push('latest'); }, 60000);
    assert.equal(q.getSnapshot().dirty, true); assert.equal(q.getSnapshot().saving, false);
    await Promise.all([q.flush(), q.flush()]); assert.deepEqual(values, ['latest']);
  });
  test('a failed field does not erase or indefinitely block unrelated edits', async () => {
    const q = new ChecklistSaveQueue(); let other = false;
    q.enqueue('have', async () => { throw Error('failed'); }); q.enqueue('note', async () => { other = true; });
    assert.equal(await q.flush(), false); assert.equal(other, true); assert.equal(q.getSnapshot().failures, 1);
  });
  test('unmount cancellation clears timers and queued work without starting a stale write', async () => {
    const q = new ChecklistSaveQueue(); let wrote = false;
    q.enqueue('note', async () => { wrote = true; }, 60000); q.cancelQueued();
    assert.equal(await q.flush(), true); assert.equal(wrote, false);
  });
});

const PROSPECT = '0f6b6a8e-3c1d-4c8e-9a51-2b7d0c4e9f10';
const compiled = Object.fromEntries(Object.entries({ properties: '../../app/properties/actions.ts', readiness: '../../app/projections/actions.ts', owner: '../../app/statements/actions.ts', walkState: '../home-walkthrough.ts', walkDb: '../home-walkthrough-db.ts', walkActions: '../../app/walkthrough-actions.ts' }).map(([name, file]) => [name,
  ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
]));
type Request = { table: string; method: string; body: Record<string, unknown>; params: URLSearchParams };
function fixture(options: { signedIn?: boolean; fail?: (r: Request) => boolean; missing?: (r: Request) => boolean } = {}) {
  const requests: Request[] = [], rows = new Map<string, Record<string, unknown>>(), redirects: string[] = [], revalidated: string[] = [];
  rows.set('projections:prospect-a', { id: 'prospect-a', readiness_state: { have: { cups: 2 }, notes: { closet: 'old' }, checked: ['cups', 'other'] } });
  rows.set('properties:home-a', { id: 'home-a' });
  rows.set('projections:' + PROSPECT, { id: PROSPECT, readiness_state: { have: { cups: 2 }, notes: { closet: 'old' }, checked: ['cups', 'other'] } });
  const client = createClient('https://synthetic.supabase.co', 'synthetic-key', { auth: { persistSession: false }, global: { fetch: async (input, init) => {
    const url = new URL(String(input)), method = init?.method || 'GET';
    const r: Request = { table: url.pathname.split('/').at(-1)!, method, body: init?.body ? JSON.parse(String(init.body)) : {}, params: url.searchParams }; requests.push(r);
    if (options.fail?.(r)) return new Response(JSON.stringify({ message: 'Synthetic database failure', code: 'TEST' }), { status: 400 });
    let result: Record<string, unknown>[] = [];
    const matches = (row: Record<string, unknown>) => [...r.params].every(([key, value]) => !value.startsWith('eq.') || String(row[key]) === value.slice(3));
    if (!options.missing?.(r)) {
      if (method === 'POST') {
        const id = String(r.body.id || r.body.property_id || randomUUID()), key = r.table + ':' + id;
        const ignore = new Headers(init?.headers).get('prefer')?.includes('ignore-duplicates');
        if (!ignore || !rows.has(key)) rows.set(key, { id, ...r.body });
        result = [rows.get(key)!];
      } else for (const [key, row] of rows) if (key.startsWith(r.table + ':') && matches(row)) {
        if (method === 'PATCH') Object.assign(row, r.body); result.push(row);
      }
    }
    const single = new Headers(init?.headers).get('accept')?.includes('vnd.pgrst.object');
    return new Response(JSON.stringify(single ? result[0] ?? null : result), { headers: { 'content-type': 'application/json' } });
  } } });
  const deps: Record<string, unknown> = {
    'node:crypto': { randomUUID }, '@supabase/supabase-js': { createClient: () => client },
    '@/lib/supabase-admin': { supabaseAdmin: client, getServiceClient: () => client, isServiceConfigured: true },
    '@/auth': { auth: async () => options.signedIn === false ? null : { user: { email: 'staff@example.test' } } },
    'next/cache': { revalidatePath: (path: string) => revalidated.push(path) },
    'next/navigation': { redirect: (path: string) => { redirects.push(path); throw Error('REDIRECT'); } },
  };
  // Real server-action bodies and the real PostgREST client; synthetic I/O only.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const load = (name: string): Record<string, (...args: any[]) => Promise<any>> => { const exports = {}; runInNewContext(compiled[name], { exports, console: { error() {} }, process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://synthetic.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-key' } }, require: (name: string) => deps[name] || {} }); return exports; };
  deps['@/lib/home-walkthrough'] = load('walkState'); deps['@/lib/home-walkthrough-db'] = load('walkDb');
  return { properties: load('properties'), readiness: load('readiness'), owner: load('owner'), walk: load('walkActions'), requests, rows, redirects, revalidated };
}
const form = (extra: Record<string, string> = {}) => { const f = new FormData(); for (const [k,v] of Object.entries({ title: 'Synthetic title', body: 'Keep this text', ...extra })) f.set(k,v); return f; };
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

for (const [kind, table, create, update] of [['note','property_notes','createPropertyNote','updatePropertyNote'],['notice','property_notices','createPropertyNotice','updatePropertyNotice']] as const) describe(kind + ' persistence', () => {
  test('retries one identity without duplicating a committed entry', async () => {
    const f = fixture(), id = randomUUID(), data = form({ submission_id: id });
    await assert.rejects(f.properties[create]('home-a', data), /REDIRECT/);
    await assert.rejects(f.properties[create]('home-a', data), /REDIRECT/);
    assert.equal([...f.rows.keys()].filter(k => k.startsWith(table + ':')).length, 1);
    assert.equal(f.redirects.length, 2);
  });
  test('a lost confirmation read is retryable without creating another row', async () => {
    let fail = true; const f = fixture({ fail: r => fail && r.table === table && r.method === 'GET' }), data = form({ submission_id: randomUUID() });
    await assert.rejects(f.properties[create]('home-a', data), /Synthetic/); assert.equal(f.redirects.length, 0);
    fail = false; await assert.rejects(f.properties[create]('home-a', data), /REDIRECT/);
    assert.equal([...f.rows.keys()].filter(k => k.startsWith(table + ':')).length, 1);
  });
  test('conflicting identity never overwrites text or reports success', async () => {
    const f = fixture(), id = randomUUID(); await assert.rejects(f.properties[create]('home-a', form({ submission_id: id })), /REDIRECT/);
    await assert.rejects(f.properties[create]('home-a', form({ submission_id: id, title: 'Different' })), /Could not confirm/);
    await assert.rejects(f.properties[create]('other-home', form({ submission_id: id })), /Could not confirm/);
    assert.equal(f.rows.get(table+':'+id)?.title, 'Synthetic title'); assert.equal(f.redirects.length, 1);
  });
  test('invalid IDs are rejected before writes', async () => { const f = fixture(); await assert.rejects(f.properties[create]('home-a', form({ submission_id: 'bad' })), /Invalid/); assert.equal(f.requests.length, 0); });
  test('missing edit targets cannot redirect as success', async () => { const f = fixture(); await assert.rejects(f.properties[update]('home-a', 'missing', form()), /not found/); assert.equal(f.revalidated.length, 0); });
  test('updates retain property scoping and exact user fields', async () => {
    const f = fixture(), id = randomUUID(); f.rows.set(table+':'+id, { id, property_id: 'home-a' });
    await assert.rejects(f.properties[update]('home-a', id, form({ title: 'New', guest_facing: 'on' })), /REDIRECT/);
    assert.equal(f.rows.get(table+':'+id)?.title, 'New'); if(kind==='note')assert.equal(f.rows.get(table+':'+id)?.guest_facing, true);
    assert.equal(f.requests[0].params.get('property_id'), 'eq.home-a');
  });
  test('authentication still precedes creates and edits', async () => { const f = fixture({ signedIn: false }); await assert.rejects(f.properties[create]('home-a', form()), /Not signed in/); await assert.rejects(f.properties[update]('home-a','id',form()), /Not signed in/); assert.equal(f.requests.length, 0); });
});

describe('outfitting walkthrough persistence (home_walkthroughs)', () => {
  const walkRows = (f: ReturnType<typeof fixture>) => [...f.rows.entries()].filter(([k]) => k.startsWith('home_walkthroughs:')).map(([, v]) => plain(v));
  test('the first write carries the retired prospect state across, migrating only the edited legacy checkbox', async () => {
    const f = fixture();
    assert.equal((await f.walk.setWalkthroughHaveAction({ projectionId: PROSPECT }, 'cups', 4)).ok, true);
    assert.equal((await f.walk.setWalkthroughNoteAction({ projectionId: PROSPECT }, 'closet', 'New note')).ok, true);
    const rows = walkRows(f); assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].state.have, { cups: 4 }); assert.deepEqual(rows[0].state.checked, ['other']); assert.equal(rows[0].state.notes.closet, 'New note');
    assert.equal(rows[0].projection_id, PROSPECT);
    // The retired column is read, never written.
    assert.equal(f.requests.some(r => r.table === 'projections' && r.method !== 'GET'), false);
  });
  test('a failed read never replaces existing data with an empty state', async () => {
    const f = fixture({ fail: r => r.method === 'GET' });
    assert.equal((await f.walk.setWalkthroughNoteAction({ propertyId: 'home_c' }, 'order_notes', 'New')).ok, false);
    assert.equal(f.requests.some(r => r.method !== 'GET'), false);
  });
  test('quantities and notes merge on one row; a blank note removes only its key', async () => {
    const f = fixture(), home = { propertyId: 'home_c' };
    f.rows.set('properties:home_c', { id: 'home_c' });
    assert.equal((await f.walk.setWalkthroughHaveAction(home, 'cups', 4)).ok, true);
    assert.equal((await f.walk.setWalkthroughNoteAction(home, 'order_notes', 'PO123')).ok, true);
    assert.equal((await f.walk.setWalkthroughNoteAction(home, 'order_notes', '')).ok, true);
    const rows = walkRows(f); assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].state.have, { cups: 4 }); assert.deepEqual(rows[0].state.notes, {}); assert.equal(rows[0].property_id, 'home_c');
  });
  test('the prospect row becomes the property row once the home is promoted', async () => {
    const f = fixture();
    f.rows.set('properties:home_b', { id: 'home_b', projection_id: PROSPECT });
    f.rows.set('home_walkthroughs:w1', { id: 'w1', projection_id: PROSPECT, property_id: null, state: { have: { cups: 1 } } });
    assert.equal((await f.walk.setWalkthroughHaveAction({ propertyId: 'home_b' }, 'plates', 2)).ok, true);
    const rows = walkRows(f); assert.equal(rows.length, 1);
    assert.equal(rows[0].property_id, 'home_b'); assert.deepEqual(rows[0].state.have, { cups: 1, plates: 2 });
  });
  test('a write without a returned record cannot report saved', async () => {
    const f = fixture({ missing: r => r.method === 'POST' }); f.rows.set('properties:home_c', { id: 'home_c' });
    assert.equal((await f.walk.setWalkthroughHaveAction({ propertyId: 'home_c' }, 'cups', 1)).ok, false);
  });
  test('auth and input checks block every database call', async () => {
    const f = fixture({ signedIn: false });
    assert.equal((await f.walk.setWalkthroughNoteAction({ projectionId: PROSPECT }, 'closet', 'x')).ok, false);
    assert.equal((await f.walk.setWalkthroughHaveAction({ propertyId: 'home_c' }, 'cups', 1)).ok, false);
    const g = fixture();
    assert.equal((await g.walk.setWalkthroughNoteAction({ propertyId: 'home_c' }, 'Bad Key!', 'x')).ok, false);
    assert.equal(f.requests.length + g.requests.length, 0);
  });
});

describe('owner request retry identity', () => {
  const args=()=>({propertyId:'home-a',title:'Replace lamp',notes:'Cord is damaged',actionType:'approve',requestId:randomUUID()});
  test('lost confirmation can be retried as the same work slip', async()=>{
    let fail=true;const f=fixture({fail:r=>fail&&r.method==='GET'}),a=args();assert.equal((await f.owner.addOwnerRequestSlipAction(a)).ok,false);
    fail=false;assert.equal((await f.owner.addOwnerRequestSlipAction(a)).ok,true);assert.equal((await f.owner.addOwnerRequestSlipAction(a)).ok,true);
    assert.equal([...f.rows.keys()].filter(k=>k.startsWith('work_slips:')).length,1);
  });
  test('changed text or property cannot silently overwrite the committed request', async()=>{
    const f=fixture(),a=args();await f.owner.addOwnerRequestSlipAction(a);assert.equal((await f.owner.addOwnerRequestSlipAction({...a,notes:'Changed'})).ok,false);
    assert.equal((await f.owner.addOwnerRequestSlipAction({...a,propertyId:'other'})).ok,false);assert.equal(f.rows.get('work_slips:'+a.requestId)?.owner_action_notes,a.notes);
  });
  test('older callers without a request ID still create work slips',async()=>{const f=fixture(),a=args();const {requestId,...old}=a;assert.equal((await f.owner.addOwnerRequestSlipAction(old)).ok,true);});
  test('invalid ID and signed-out calls never write',async()=>{const f=fixture();assert.equal((await f.owner.addOwnerRequestSlipAction({...args(),requestId:'bad'})).ok,false);assert.equal(f.requests.length,0);const no=fixture({signedIn:false});assert.equal((await no.owner.addOwnerRequestSlipAction(args())).ok,false);assert.equal(no.requests.length,0);});
});

describe('home guide writes',()=>{
  test('fixed copy and custom slot choices persist without extra fields',async()=>{const f=fixture();await assert.rejects(f.properties.updateHomeGuideOverrides('home-a',form({override_wifi:'Guest Wi-Fi copy',slot5_key:'custom',slot5_custom_title:'Beach',slot5_body:'Use the path'})),/REDIRECT/);assert.deepEqual(plain(f.requests[0].body),{home_guide_overrides:{wifi:'Guest Wi-Fi copy',slot5:{key:'custom',body:'Use the path',customTitle:'Beach'}}});});
  test('missing property retains the failure path',async()=>{const f=fixture({missing:()=>true});await assert.rejects(f.properties.updateHomeGuideOverrides('home-a',form()),/0 rows/);assert.equal(f.redirects.length,0);});
});
