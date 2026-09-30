import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { fieldSubmissionId } from '../field-submission-id.ts';
// Execute the real server functions with a synthetic database enforcing the existing PK.
const source = readFileSync(new URL('../../app/field/actions.ts', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('export type ReportState'), source.indexOf('/** Gate for the property-work board'));
const code = ts.transpileModule(body.replaceAll('export ', ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture() {
  const rows = new Map<string, Record<string, unknown>>();
  const state = { actor: 'actor-a', allowed: true, readError: false, loseInsertResponse: false, events: 0, recomputes: 0 };
  const fieldDb = () => ({ from: () => {
    const filters: [string, unknown][] = [];
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      maybeSingle: async () => ({ data: [...rows.values()].find(row => filters.every(([k, v]) => row[k] === v)) ?? null, error: state.readError ? { message: 'offline' } : null }),
      insert: async (row: Record<string, unknown>) => {
        const id = row.id as string;
        if (rows.has(id)) return { error: { code: '23505' } };
        rows.set(id, row);
        return { error: state.loseInsertResponse ? { message: 'lost insert response' } : null };
      },
    };
    return query;
  } });
  const api = new Function('fieldDb', 'fieldSubmissionId', 'resolveContractorFromCookie', 'loadRecentVisits', 'recomputePacketExpenses', 'logEvent', 'revalidatePath', code + '; return { reportFieldWorkSlip, checkFieldReportSubmission };')(
    fieldDb, fieldSubmissionId, async () => state.actor ? { id: state.actor, email: 'synthetic@example.test' } : null,
    async () => state.allowed ? [{ propertyId: 'home-a', propertyName: 'Synthetic home', packetId: 'packet-a' }] : [],
    async () => { state.recomputes++; }, async () => { state.events++; }, () => {},
  );
  return { api, rows, state };
}
function form(token = '138f4efe-fdc5-4d1d-bb11-6ba9cbbf8383') {
  const data = new FormData();
  for (const [key, value] of Object.entries({ submission_id: token, property_id: 'home-a', title: 'Synthetic leak', expense_dollars: '27.60' })) data.set(key, value);
  return data;
}
test('simultaneous report retries create one work slip and one audit event', async () => {
  const { api, rows, state } = fixture();
  const results = await Promise.all([api.reportFieldWorkSlip({}, form()), api.reportFieldWorkSlip({}, form())]);
  assert.ok(results.every(r => r.ok)); assert.equal(rows.size, 1); assert.equal(state.events, 1);
});
test('lost insert response is confirmed, and an expired visit can confirm but cannot create', async () => {
  const { api, rows, state } = fixture(); state.loseInsertResponse = true;
  assert.equal((await api.reportFieldWorkSlip({}, form())).ok, true);
  state.allowed = false;
  assert.equal((await api.reportFieldWorkSlip({}, form())).ok, true);
  assert.equal((await api.reportFieldWorkSlip({}, form('238f4efe-fdc5-4d1d-bb11-6ba9cbbf8383'))).ok, false);
  assert.equal(rows.size, 1);
});
test('confirmation is scoped to contractor and property; lookup failures never authorize insertion', async () => {
  const { api, rows, state } = fixture();
  const token = form().get('submission_id'); await api.reportFieldWorkSlip({}, form());
  assert.equal((await api.checkFieldReportSubmission(token, 'home-b')).ok, false);
  state.actor = 'actor-b'; assert.equal((await api.checkFieldReportSubmission(token, 'home-a')).ok, false);
  state.readError = true;
  assert.equal((await api.reportFieldWorkSlip({}, form())).uncertain, true);
  assert.equal(rows.size, 1);
  state.actor = ''; assert.equal((await api.checkFieldReportSubmission(token, 'home-a')).ok, false);
});

test('task confirmation cannot cross contractor, packet, stop or property boundaries', async () => {
  const taskBody = source.slice(source.indexOf('export async function checkFieldTaskCompletion'), source.indexOf('export type StopSlipOutcome'));
  const taskCode = ts.transpileModule(taskBody.replaceAll('export ', ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const tables: Record<string, Record<string, unknown>[]> = {
    inspection_packets: [{ id: 'packet-a', awarded_contractor_id: 'actor-a' }, { id: 'packet-b', awarded_contractor_id: 'actor-b' }],
    packet_stops: [{ id: 'stop-a', packet_id: 'packet-a', property_id: 'home-a', status: 'complete' }],
    work_slips: [{ id: 'slip-a', property_id: 'home-a', status: 'in_progress' }, { id: 'slip-b', property_id: 'home-b', status: 'done' }],
    packet_stop_work_slips: [{ id: 'attachment-a', stop_id: 'stop-a', work_slip_id: 'slip-a', completed_at: 'synthetic', 'packet_stops.packet_id': 'packet-a' }],
  };
  let offline = false;
  const db = () => ({ from: (table: string) => {
    const filters: [string, unknown][] = [];
    const query = { select: () => query, eq: (k: string, v: unknown) => { filters.push([k, v]); return query; },
      maybeSingle: async () => ({ data: tables[table].find(row => filters.every(([k, v]) => row[k] === v)) ?? null, error: offline ? {} : null }),
    }; return query;
  } });
  const check = new Function('fieldDb', 'resolveContractorFromCookie', taskCode + ';return checkFieldTaskCompletion;')(db, async () => ({ id: 'actor-a' }));
  assert.equal((await check({packetId:'packet-a',stopId:'stop-a',workSlipId:'slip-a'})).ok,true);
  assert.equal((await check({packetId:'packet-a',attachmentId:'attachment-a'})).ok,true);
  assert.equal((await check({packetId:'packet-b',attachmentId:'attachment-a'})).ok,false);
  assert.equal((await check({packetId:'packet-a',stopId:'stop-a',workSlipId:'slip-b'})).ok,false);
  assert.equal((await check({packetId:'packet-a',stopId:'missing'})).ok,false);
  offline = true;
  assert.equal((await check({packetId:'packet-a',stopId:'stop-a'})).ok,false);
});
