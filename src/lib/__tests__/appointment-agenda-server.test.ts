import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as core from '../appointment-agenda.ts';
import { selectAllPaged } from '../paged-select.ts';

function load(path: string, mocks: Record<string, unknown>) {
  const output = ts.transpileModule(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} as Record<string, (...args: any[]) => any> };
  new Function('require', 'module', 'exports', output)((id: string) => {
    if (id === 'server-only') return {};
    if (Object.hasOwn(mocks, id)) return mocks[id];
    throw Error(`Unmocked import: ${id}`);
  }, module, module.exports);
  return module.exports;
}
const d: core.AppointmentInput = { title: 'Synthetic business appointment', date: '2026-11-02', time: '10:00', endTime: '10:30', timeKind: 'exact', status: 'confirmed', attendance: 'attending', propertyName: null, location: null, people: null, notes: null, sourceLabel: 'Synthetic source', sourceUrl: null, sourceKeys: ['manual:one'], reviewReason: null };
const row = (email: string, id: string) => ({ id, user_email: email, details: d, version: 1, updated_at: '2026-10-31T02:00:00Z' });
function setup({ email = 'ryan@risingtidestr.com', role = 'owner', viewAs = false, fail = false } = {}) {
  const queries: Array<{ table: string; filters: Record<string, string> }> = [];
  const meetingOptions: unknown[] = [];
  const db = { from(table: string) {
    const query = { table, filters: {} as Record<string, string> }; queries.push(query);
    const chain: any = { select: () => chain, order: () => chain, eq(key: string, value: string) { query.filters[key] = value; return chain; },
      range: () => Promise.resolve({ data: table === 'agenda_appointments' ? [row('ryan@risingtidestr.com', 'ryan'), row('allie@risingtidestr.com', 'allie')].filter(r => r.user_email === query.filters.user_email) : [], error: fail ? { message: 'Unavailable' } : null }) };
    return chain;
  } };
  const mod = load('lib/appointment-agenda-server.ts', {
    '@/auth': { auth: async () => ({ user: { email } }) }, '@/lib/helm-access-server': { sessionView: async () => ({ role, viewingAsStaff: viewAs }) },
    '@/lib/supabase-admin': { supabaseAdmin: db }, '@/lib/paged-select': { selectAllPaged }, '@/lib/appointment-agenda': core,
    '@/lib/meetings': { loadMeetingCardsResult: async (_now: Date, opts: unknown) => { meetingOptions.push(opts); return { cards: [], available: true }; } },
  });
  return { run: () => mod.loadAppointmentAgenda(new Date('2026-10-31T12:00:00Z')), queries, meetingOptions };
}
test('an owner sees only their saved agenda; shared CRM retains its existing owner scope', async () => {
  const s = setup(); const data = await s.run();
  assert.deepEqual(data.entries.map((e: core.AgendaEntry) => e.id), ['ryan']);
  assert.ok(s.queries.every(q => q.filters.user_email === 'ryan@risingtidestr.com'));
  assert.deepEqual(s.meetingOptions, [{ days: 30 }]);
});
test('staff contact records are scoped by creator, and an owner viewing as staff cannot read saved agenda', async () => {
  const s = setup({ role: 'staff', viewAs: true }); const data = await s.run();
  assert.equal(s.queries.length, 0); assert.equal(data.entries.length, 0); assert.equal(data.canSave, false);
  assert.deepEqual(s.meetingOptions, [{ days: 30, createdBy: 'ryan@risingtidestr.com' }]);
});
test('missing session causes no business-data read', async () => { const s = setup({ email: '' }); await s.run(); assert.equal(s.queries.length, 0); assert.equal(s.meetingOptions.length, 0); });
test('unavailable storage and unconnected calendars remain visible instead of claiming an empty complete calendar', async () => {
  const s = setup({ fail: true }); const data = await s.run();
  assert.equal(data.canSave, false); assert.equal(data.sources[0].state, 'unavailable');
  assert.equal(data.sources.find((s: core.SourceCoverage) => s.name === 'Work Google Calendar').state, 'not_connected');
  assert.equal(data.sources.find((s: core.SourceCoverage) => s.name === 'Personal calendars').state, 'not_connected');
});
test('mutation derives its namespace from auth and passes the optimistic version', async () => {
  const calls: unknown[] = [];
  const mod = load('app/appointments/actions.ts', {
    '@/auth': { auth: async () => ({ user: { email: 'Ryan@risingtidestr.com' } }) },
    '@/lib/helm-access-server': { sessionView: async () => ({ role: 'owner', viewingAsStaff: false }) },
    '@/lib/supabase-admin': { supabaseAdmin: { rpc: async (...args: unknown[]) => { calls.push(args); return { data: { id: 'saved' }, error: null }; } } },
    'next/cache': { revalidatePath() {} }, '@/lib/appointment-agenda': core,
  });
  const id = '00000000-0000-4000-a000-000000000001';
  const result = await mod.saveAppointment({ id, expectedVersion: 2, details: { ...d, user_email: 'allie@risingtidestr.com' } });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [['save_agenda_appointment', { p_user_email: 'ryan@risingtidestr.com', p_id: id, p_expected_version: 2, p_details: d }]]);
});
test('view-as mutation and invalid inputs fail before database access', async () => {
  let reads = 0;
  const mod = load('app/appointments/actions.ts', {
    '@/auth': { auth: async () => ({ user: { email: 'ryan@risingtidestr.com' } }) },
    '@/lib/helm-access-server': { sessionView: async () => ({ role: 'staff', viewingAsStaff: true }) },
    '@/lib/supabase-admin': { supabaseAdmin: { rpc: () => { reads++; throw Error('must not write'); } } },
    'next/cache': { revalidatePath() {} }, '@/lib/appointment-agenda': core,
  });
  assert.equal((await mod.saveAppointment({ id: '00000000-0000-4000-a000-000000000001', expectedVersion: 0, details: d })).ok, false);
  assert.equal(reads, 0);
});
