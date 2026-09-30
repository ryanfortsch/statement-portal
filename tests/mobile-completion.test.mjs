import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function actions(failTable, failMode = 'update') {
  const writes = [];
  const db = { from(table) {
    let mode = 'read';
    const chain = new Proxy({}, { get(_, key) {
      if (key === 'then') return done => {
        if (mode === 'update') writes.push(table);
        let data = table === 'inspection_packets' ? { id: 'packet', status: 'in_progress', awarded_contractor_id: 'contractor' }
          : table === 'packet_stops' ? { id: 'stop', work_slip_id: 'slip', property_id: 'property' }
          : table === 'packet_stop_work_slips' ? { id: 'attachment', work_slip_id: 'slip', completed_at: null, packet_stops: { packet_id: 'packet', property_id: 'property' } }
          : { id: 'slip', photo_urls: ['https://example.test/existing.jpg'] };
        return Promise.resolve(table === failTable && mode === failMode ? { data: null, error: { message: 'Synthetic failure' } } : { data, error: null }).then(done);
      };
      return () => { if (key === 'update') mode = 'update'; return chain; };
    }});
    return chain;
  }};
  const mocks = {
    'next/navigation': { redirect: () => { throw Error('UNEXPECTED REDIRECT'); } },
    'next/cache': { revalidatePath: () => {} },
    '@/lib/field-db': { fieldDb: () => db },
    '@/lib/field-auth': { resolveContractorFromCookie: async () => ({ id: 'contractor', email: 'synthetic@example.test' }) },
    '@/lib/field-packet-status': { isWorkingStatus: () => true },
  };
  const output = ts.transpileModule(readFileSync(new URL('../src/app/field/actions.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require','module','exports',output)(id => mocks[id] ?? {}, module, module.exports);
  return { ...module.exports, writes };
}
function form() { const data = new FormData(); for (const [k,v] of Object.entries({ packet_id: 'packet', stop_id: 'stop', attachment_id: 'attachment', resolution: 'Fixed', photo_urls: '[]' })) data.set(k,v); return data; }

test('failed maintenance detail write cannot mark the stop complete', async () => {
  const a = actions('work_slips');
  await assert.rejects(a.completeMaintenanceStop(form()), /Could not save/);
  assert.deepEqual(a.writes, ['work_slips']);
});
test('failed maintenance completion stamp cannot redirect as success', async () => {
  const a = actions('packet_stops');
  await assert.rejects(a.completeMaintenanceStop(form()), /Could not confirm/);
});
test('attached-task detail failure cannot stamp completion', async () => {
  const a = actions('work_slips');
  const res = await a.completeAttachedSlipInFlow({ packetId: 'packet', attachmentId: 'attachment', note: 'Fixed', photoUrls: [] });
  assert.equal(res.ok, false); assert.deepEqual(a.writes, ['work_slips']);
});
test('attached-task stamp failure is not treated as winning or losing a successful race', async () => {
  const a = actions('packet_stop_work_slips');
  const res = await a.completeAttachedSlipInFlow({ packetId: 'packet', attachmentId: 'attachment', note: 'Fixed', photoUrls: [] });
  assert.equal(res.ok, false); assert.match(res.error, /Could not confirm/);
});
test('packet-page attached-task wrapper propagates the failure instead of redirecting', async () => {
  const a = actions('work_slips');
  await assert.rejects(a.completeAttachedSlip(form()), /Could not save/);
});
test('failed photo read cannot replace existing evidence with an empty array', async () => {
  const a = actions('work_slips', 'read');
  const res = await a.completeAttachedSlipInFlow({ packetId: 'packet', attachmentId: 'attachment', note: 'Fixed', photoUrls: [] });
  assert.equal(res.ok, false); assert.deepEqual(a.writes, []);
});
