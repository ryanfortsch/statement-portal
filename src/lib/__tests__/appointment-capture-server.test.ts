import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as capture from '../appointment-capture.ts';
import * as agenda from '../appointment-agenda.ts';
import { CaptureAccessError } from '../appointment-capture-google.ts';
import { selectAllPaged } from '../paged-select.ts';
const email = 'operator@risingtidestr.com', now = new Date('2026-10-31T12:00:00Z');
function load(path: string, mocks: Record<string, unknown>) {
  const code = ts.transpileModule(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} as Record<string, (...args: any[]) => any> };
  new Function('require', 'module', 'exports', code)((id: string) => { if (id === 'server-only') return {}; if (id in mocks) return mocks[id]; throw Error(id); }, mod, mod.exports);
  return mod.exports;
}
function fixture({ token = 'fake', owner = true, claimed = true, providerFails = false, storedFails = false } = {}) {
  const writes: Array<{ name: string; args: any }> = [], reads: Array<{ table: string; filters: Record<string, unknown> }> = [];
  let providerCalls = 0;
  const old = { kind: 'calendar', state: 'available', detail: 'Previous success', last_success_at: '2026-10-30T12:00:00Z', last_attempt_at: '2026-10-30T12:00:00Z' };
  const db = {
    rpc: async (name: string, args: unknown) => { writes.push({ name, args }); return { data: name === 'claim_agenda_capture' ? claimed : true, error: null }; },
    from(table: string) {
      const read = { table, filters: {} as Record<string, unknown> }; reads.push(read);
      const result = () => ({ data: table === 'agenda_capture_state' ? [old] : [], error: storedFails && table === 'agenda_capture' ? { message: 'unreadable' } : null });
      const q: any = { select: () => q, delete: () => q, order: () => q, in: () => q, not: () => q, gte: () => q,
        eq(key: string, value: unknown) { read.filters[key] = value; return q; }, range: async () => result(),
        maybeSingle: async () => ({ data: { last_synced_at: now.toISOString(), last_status: 'ok' }, error: null }),
        then(resolve: (r: unknown) => unknown) { return Promise.resolve(result()).then(resolve); } }; return q;
    },
  };
  const providers = async () => { providerCalls++; if (providerFails) throw new CaptureAccessError(403); return []; };
  const mod = load('lib/appointment-capture-server.ts', {
    'node:crypto': { randomUUID: () => 'lease' }, '@/lib/supabase-admin': { supabaseAdmin: db }, '@/lib/paged-select': { selectAllPaged },
    '@/lib/gmail-draft': { existingGoogleAccess: async (requested: string) => { assert.equal(requested, email); return token || null; } },
    '@/lib/helm-access': { effectiveRole: () => owner ? 'owner' : 'staff' }, '@/lib/appointment-capture-google': { captureCalendar: providers, captureGmail: providers, CaptureAccessError },
    '@/lib/appointment-capture': capture, '@/lib/appointment-agenda': agenda,
  });
  return { mod, writes, reads, providerCalls: () => providerCalls };
}
test('capture is opt-in; overlapping runs do not perform provider or data reads', async () => {
  const previous = process.env.AGENDA_CAPTURE_EMAILS;
  try {
    process.env.AGENDA_CAPTURE_EMAILS = ''; const f = fixture(); await assert.rejects(f.mod.syncAppointmentSources(email, now), /not enabled/); assert.equal(f.writes.length, 0);
    process.env.AGENDA_CAPTURE_EMAILS = email; const overlap = fixture({ claimed: false }); assert.equal((await overlap.mod.syncAppointmentSources(email, now)).state, 'already_running'); assert.equal(overlap.providerCalls(), 0); assert.equal(overlap.reads.length, 0);
  } finally { if (previous === undefined) delete process.env.AGENDA_CAPTURE_EMAILS; else process.env.AGENDA_CAPTURE_EMAILS = previous; }
});
test('refused provider access retains last success and still completes independent Quo capture', async () => {
  const previous = process.env.AGENDA_CAPTURE_EMAILS; process.env.AGENDA_CAPTURE_EMAILS = email;
  try {
    const f = fixture({ providerFails: true }); await f.mod.syncAppointmentSources(email, now);
    const records = f.writes.filter(w => w.name === 'record_agenda_capture'); assert.equal(records.length, 3);
    assert.equal(records[0].args.p_state.state, 'not_connected'); assert.equal(records[0].args.p_state.last_success_at, '2026-10-30T12:00:00Z'); assert.deepEqual(records[0].args.p_records, []);
    assert.equal(records[2].args.p_state.state, 'available'); assert.ok(records.every(w => w.args.p_user_email === email));
    assert.ok(f.reads.filter(r => r.table.startsWith('agenda_')).every(r => r.filters.user_email === email));
  } finally { if (previous === undefined) delete process.env.AGENDA_CAPTURE_EMAILS; else process.env.AGENDA_CAPTURE_EMAILS = previous; }
});
test('unreadable prior records prevent falsely successful sync; no token never calls Google', async () => {
  const previous = process.env.AGENDA_CAPTURE_EMAILS; process.env.AGENDA_CAPTURE_EMAILS = email;
  try {
    const f = fixture({ storedFails: true }); await assert.rejects(f.mod.syncAppointmentSources(email, now), /read completely/); assert.equal(f.providerCalls(), 0); assert.equal(f.writes.length, 1);
    const missing = fixture({ token: '', owner: false }); await missing.mod.syncAppointmentSources(email, now); assert.equal(missing.providerCalls(), 0);
    assert.equal(missing.writes.filter(w => w.name === 'record_agenda_capture')[2].args.p_state.state, 'unavailable'); assert.equal(missing.reads.filter(r => r.table === 'contact_touches').length, 0);
  } finally { if (previous === undefined) delete process.env.AGENDA_CAPTURE_EMAILS; else process.env.AGENDA_CAPTURE_EMAILS = previous; }
});
test('capture endpoint requires a nonempty exact cron bearer; cookies are not a fallback', async () => {
  const old = process.env.CRON_SECRET; let runs = 0;
  const mod = load('app/api/cron/appointment-capture/route.ts', { 'next/server': { NextResponse: { json: (body: unknown, opts: { status: number }) => Response.json(body, opts) } }, '@/lib/appointment-capture-server': { enabledAgendaAccounts: () => [email], syncAppointmentSources: async () => { runs++; return { state: 'checked' }; } } });
  try {
    delete process.env.CRON_SECRET; assert.equal((await mod.GET(new Request('http://localhost'))).status, 401);
    process.env.CRON_SECRET = 'synthetic'; assert.equal((await mod.GET(new Request('http://localhost', { headers: { authorization: 'Bearer wrong' } }))).status, 401); assert.equal(runs, 0);
    assert.equal((await mod.GET(new Request('http://localhost', { headers: { authorization: 'Bearer synthetic' } }))).status, 200); assert.equal(runs, 1);
  } finally { if (old === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = old; }
});
