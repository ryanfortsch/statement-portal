import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { isWorkingStatus } from '../field-packet-status.ts';
const code = (path: string) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const layoutCode = code('../../app/properties/[id]/layout/actions.ts'), fieldCode = code('../../app/field/actions.ts');
const id = '00000000-0000-0000-0000-000000000001', requestId = '00000000-0000-0000-0000-000000000002';
function layoutFixture(signedIn = true) {
  const calls: { name: string; args: Record<string, unknown> }[] = [], paths: string[] = [];
  let response: unknown = { data: null, error: null };
  const deps: Record<string, unknown> = {
    '@/auth': { auth: async () => signedIn ? { user: { email: 'synthetic@example.test' } } : null },
    '@/lib/supabase-admin': { supabaseAdmin: { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return response; } } },
    '@/lib/inspections-types': { HELM_CORE_TEMPLATE_ID: 'template' }, 'next/cache': { revalidatePath: (path: string) => paths.push(path) },
  };
  // Actual actions, with only external I/O replaced by controlled test boundaries.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actions: Record<string, (...args: any[]) => Promise<any>> = {};
  runInNewContext(layoutCode, { exports: actions, require: (name: string) => { assert.ok(name in deps); return deps[name]; } });
  return { actions, calls, paths, respond(r: unknown) { response = r; } };
}
test('layout auth gates all RPCs', async () => {
  const f = layoutFixture(false); assert.equal((await f.actions.saveLayout('home', [id])).ok, false); assert.equal((await f.actions.createCustomItem({})).ok, false); assert.equal(f.calls.length, 0);
});
for (const invalid of [[], [id, id], ['bad'], [null], null]) test('invalid layout rejected before any write: ' + JSON.stringify(invalid), async () => {
  const f = layoutFixture(); assert.equal((await f.actions.saveLayout('home', invalid)).ok, false); assert.equal(f.calls.length, 0);
});
test('layout passes exact order to one atomic RPC and revalidates only success', async () => {
  const f = layoutFixture(); f.respond({ error: { message: 'Database failed' } }); assert.equal((await f.actions.saveLayout('home', [requestId, id])).error, 'Database failed'); assert.equal(f.paths.length, 0);
  f.respond({ error: null }); assert.equal((await f.actions.saveLayout('home', [requestId, id])).ok, true); assert.equal(f.calls[1].name, 'helm_save_inspection_layout'); assert.deepEqual(f.calls[1].args.p_item_ids, [requestId, id]); assert.deepEqual(f.paths, ['/properties/home/layout']);
});
test('custom creation retains request identity and order in one RPC; missing confirmation is failure', async () => {
  const f = layoutFixture(), args = { propertyId: 'home', title: '  Custom  ', description: '  Details  ', requestId, itemIds: [id] };
  assert.equal((await f.actions.createCustomItem(args)).ok, false); assert.equal(f.paths.length, 0);
  f.respond({ data: { id: requestId, title: 'Custom' }, error: null }); assert.equal((await f.actions.createCustomItem(args)).ok, true);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].name, 'helm_create_inspection_card'); assert.equal(f.calls[1].args.p_request_id, requestId); assert.equal(f.calls[1].args.p_title, 'Custom'); assert.equal(f.calls[1].args.p_description, 'Details'); assert.equal(f.calls[1].args.p_item_ids, args.itemIds);
});
function fieldFixture() {
  const packet = { id: 'packet', status: 'in_progress', awarded_contractor_id: 'contractor' };
  const stop = { id: 'stop', property_id: 'home' };
  const slip = { id, property_id: 'home', title: 'Cupboard', description: 'Details', status: 'open', photo_urls: ['https://synthetic.test/old.jpg'] };
  let signedIn = true, missingStop = false, response: unknown = { error: null, data: { photo_urls: [...slip.photo_urls, 'https://synthetic.test/new.jpg'] } };
  const rpcs: { name: string; args: Record<string, unknown> }[] = [], writes: string[] = [], filters: unknown[][] = [];
  const db = {
    from(table: string) {
      const chain = { select() { return chain; }, eq(...args: unknown[]) { filters.push([table, ...args]); return chain; },
        async maybeSingle() { return { data: table === 'inspection_packets' ? packet : table === 'packet_stops' ? missingStop ? null : stop : slip }; },
        async insert() { writes.push(table); return { error: null }; },
      }; return chain;
    },
    async rpc(name: string, args: Record<string, unknown>) { rpcs.push({ name, args }); return response; },
  };
  const deps: Record<string, unknown> = {
    '@/lib/field-db': { fieldDb: () => db }, '@/lib/field-auth': { resolveContractorFromCookie: async () => signedIn ? { id: 'contractor', full_name: 'Synthetic Inspector', email: 'synthetic@example.test' } : null },
    'next/headers': { headers: async () => ({ get: () => null }) }, '@/lib/field-packet-status': { isWorkingStatus }, 'next/cache': { revalidatePath() {} },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actions: Record<string, (...args: any[]) => Promise<any>> = {};
  runInNewContext(fieldCode, { exports: actions, require: (name: string) => deps[name] || {}, Date, console });
  const input = { packetId: 'packet', stopId: 'stop', workSlipId: id, title: 'Cupboard', description: 'Details', photoUrls: ['https://synthetic.test/new.jpg'] };
  return { packet, stop, slip, rpcs, writes, filters, input, actions, signOut() { signedIn = false; }, hideStop() { missingStop = true; }, respond(r: unknown) { response = r; } };
}
for (const mode of ['signed-out', 'other-contractor', 'closed-packet', 'wrong-stop', 'wrong-home', 'done', 'dismissed']) test('field photo edit rejects ' + mode, async () => {
  const f = fieldFixture();
  if (mode === 'signed-out') f.signOut(); if (mode === 'other-contractor') f.packet.awarded_contractor_id = 'other'; if (mode === 'closed-packet') f.packet.status = 'approved'; if (mode === 'wrong-stop') f.hideStop(); if (mode === 'wrong-home') f.slip.property_id = 'other'; if (mode === 'done' || mode === 'dismissed') f.slip.status = mode;
  assert.equal((await f.actions.updateSlipFromStop(f.input)).ok, false); assert.equal(f.rpcs.length, 0); assert.equal(f.writes.length, 0);
});
test('photo-only edit checks packet membership, appends only new URLs and returns canonical photos', async () => {
  const f = fieldFixture(); f.input.photoUrls = ['https://synthetic.test/old.jpg', 'https://synthetic.test/new.jpg', 'https://synthetic.test/new.jpg'];
  const result = await f.actions.updateSlipFromStop(f.input); assert.equal(result.ok, true); assert.equal(result.photoUrls.length, 2); assert.equal(f.rpcs[0].name, 'helm_edit_field_slip'); assert.equal(JSON.stringify(f.rpcs[0].args.p_photo_urls), JSON.stringify(['https://synthetic.test/new.jpg'])); assert.equal(f.rpcs[0].args.p_property_id, 'home'); assert.ok(f.filters.some(row => JSON.stringify(row) === JSON.stringify(['packet_stops','packet_id','packet']))); assert.equal('p_status' in f.rpcs[0].args, false);
});
test('confirmed retry with existing photos is a no-op', async () => {
  const f = fieldFixture(); f.input.photoUrls = [...f.slip.photo_urls]; const result = await f.actions.updateSlipFromStop(f.input); assert.equal(result.ok, true); assert.equal(result.photoUrls, f.slip.photo_urls); assert.equal(f.rpcs.length, 0); assert.equal(f.writes.length, 0);
});
for (const photos of [['javascript:bad'], Array(13).fill('https://synthetic.test/new.jpg'), [null]]) test('invalid photo input cannot change text: ' + JSON.stringify(photos).slice(0,40), async () => {
  const f = fieldFixture(); assert.equal((await f.actions.updateSlipFromStop({ ...f.input, photoUrls: photos })).ok, false); assert.equal(f.rpcs.length, 0);
});
test('failed atomic photo save cannot publish success or audit completion', async () => {
  const f = fieldFixture(); f.respond({ error: { message: 'Synthetic refusal' }, data: null }); assert.equal((await f.actions.updateSlipFromStop(f.input)).ok, false); assert.equal(f.writes.length, 0);
});
