import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as core from '../appointment-agenda.ts';
import { reconcileCaptures } from '../appointment-capture.ts';
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
    '@/lib/appointment-capture': { reconcileCaptures },
    '@/lib/appointment-capture-server': { loadCaptures: async () => ({ captures: [], sources: [{ name: 'Work Google Calendar', state: 'not_connected', detail: 'Not configured.' }] }) },
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
  assert.equal(data.sources[0].excluded, true);
  assert.deepEqual(s.meetingOptions, [{ days: 30, createdBy: 'ryan@risingtidestr.com' }]);
});
test('missing session causes no business-data read', async () => { const s = setup({ email: '' }); await s.run(); assert.equal(s.queries.length, 0); assert.equal(s.meetingOptions.length, 0); });
test('unavailable storage and unconnected calendars remain visible instead of claiming an empty complete calendar', async () => {
  const s = setup({ fail: true }); const data = await s.run();
  assert.equal(data.canSave, false); assert.equal(data.sources[0].state, 'unavailable');
  assert.equal(data.sources.find((s: core.SourceCoverage) => s.name === 'Work Google Calendar').state, 'not_connected');
  assert.equal(data.sources.find((s: core.SourceCoverage) => s.name === 'Personal calendars').state, 'not_connected');
  assert.equal(data.sources.find((s: core.SourceCoverage) => s.name === 'Personal calendars').excluded, true);
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
function answerSetup({ role = 'owner', viewAs = false, found = true } = {}) {
  const calls: unknown[] = [], reads: Array<{ table: string; filters: Record<string, string> }> = [];
  const db = {
    rpc: async (...args: unknown[]) => { calls.push(args); return { data: { id: 'saved' }, error: null }; },
    from(table: string) {
      const query = { table, filters: {} as Record<string, string> }; reads.push(query);
      const chain: any = { select: () => chain, eq(key: string, value: string) { query.filters[key] = value; return chain; },
        maybeSingle: async () => ({ data: found ? { id: query.filters.id } : null, error: null }),
        update() { throw Error('the shared meeting must never be written'); }, upsert() { throw Error('never written'); }, insert() { throw Error('never written'); } };
      return chain;
    },
  };
  const mod = load('app/appointments/actions.ts', {
    '@/auth': { auth: async () => ({ user: { email: 'Ryan@risingtidestr.com' } }) },
    '@/lib/helm-access-server': { sessionView: async () => ({ role, viewingAsStaff: viewAs }) },
    '@/lib/supabase-admin': { supabaseAdmin: db }, 'next/cache': { revalidatePath() {} }, '@/lib/appointment-agenda': core,
  });
  return { mod, calls, reads };
}
const meetingId = '00000000-0000-4000-a000-0000000000aa';
test('a one-tap attendance answer is a private record naming only the meeting; the CRM row is only read', async () => {
  const s = answerSetup();
  assert.equal((await s.mod.answerMeetingAttendance({ meetingId, attendance: 'attending' })).ok, true);
  assert.deepEqual(s.reads.map(r => r.table), ['contact_meetings']);
  const [name, args] = s.calls[0] as [string, Record<string, any>];
  assert.equal(name, 'save_agenda_appointment'); assert.equal(args.p_user_email, 'ryan@risingtidestr.com'); assert.equal(args.p_expected_version, 0);
  assert.deepEqual(args.p_details, core.meetingAttendanceDetails(meetingId, 'attending'));
  assert.equal(core.validateAppointment(args.p_details).ok, true);
});
test('changing an answer updates the same private record at its version', async () => {
  const s = answerSetup(); const answer = { id: '00000000-0000-4000-a000-0000000000bb', version: 3 };
  await s.mod.answerMeetingAttendance({ meetingId, attendance: 'not_attending', answer });
  const [, args] = s.calls[0] as [string, Record<string, any>];
  assert.equal(args.p_id, answer.id); assert.equal(args.p_expected_version, 3); assert.equal(args.p_details.attendance, 'not_attending');
});
test('staff answer only meetings they created; view-as and bad answers never write', async () => {
  const staff = answerSetup({ role: 'staff' });
  await staff.mod.answerMeetingAttendance({ meetingId, attendance: 'attending' });
  assert.equal(staff.reads[0].filters.created_by_email, 'ryan@risingtidestr.com');
  const unseen = answerSetup({ role: 'staff', found: false });
  assert.equal((await unseen.mod.answerMeetingAttendance({ meetingId, attendance: 'attending' })).ok, false); assert.equal(unseen.calls.length, 0);
  const viewAs = answerSetup({ viewAs: true });
  assert.equal((await viewAs.mod.answerMeetingAttendance({ meetingId, attendance: 'attending' })).ok, false); assert.equal(viewAs.reads.length + viewAs.calls.length, 0);
  const bad = answerSetup();
  assert.equal((await bad.mod.answerMeetingAttendance({ meetingId, attendance: 'owner_handled' })).ok, false); assert.equal(bad.calls.length, 0);
});
