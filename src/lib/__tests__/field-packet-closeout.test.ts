import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { slipVerdictLists, doneOnTripNote, alreadyHandledNote } from '../field-slip-outcomes.ts';

const read = (file: string) => readFileSync(new URL(`../../app/${file}`, import.meta.url), 'utf8');
const field = read('field/actions.ts');
const inspections = read('inspections/actions.ts');
const compile = (source: string) => ts.transpileModule(source.replaceAll('export ', ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const submitCode = compile(field.slice(field.indexOf('export async function submitPacket('), field.indexOf('export async function signOutField(')));
const completeCode = compile(inspections.slice(inspections.indexOf('export async function completeInspection('), inspections.indexOf('export async function addInspectionNote(')));
const redirect = (url: string): never => { throw new Error(`REDIRECT:${url}`); };

type Row = Record<string, unknown>;
function fixture() {
  const packet: Row = { id: 'packet-a', awarded_contractor_id: 'actor-a', status: 'in_progress', paid_at: null, title: 'Synthetic trip', bonus_cents: 900, final_payout_cents: 7800 };
  const stop: Row = { id: 'stop-a', packet_id: packet.id, inspection_id: 'inspection-a', status: 'complete', departed_at: null, arrived_verified_at: 'synthetic-arrival' };
  const inspection = { id: 'inspection-a', property_id: 'home-a', ordered_cards: [{ itemId: 'item-a', zoneId: null }], completed_at: null as string | null, inspector_name: 'Synthetic inspector' };
  const tables: Record<string, Row[]> = {
    inspection_packets: [packet], packet_stops: [stop], inspections: [inspection],
    inspection_results: [{ inspection_id: inspection.id, item_id: 'item-a', property_zone_id: null, status: 'pass', photo_urls: [] }],
    inspection_items: [{ id: 'item-a', item_category: 'CORE' }],
    properties: [{ id: 'home-a', inspections_since_last_intermittent: 2 }],
    work_slips: [{ id: 'slip-a', property_id: 'home-a', status: 'open' }],
    packet_stop_work_slips: [], property_inspection_item_history: [],
  };
  const state = { cookie: true, staff: true, failRead: '', failWrite: '', loseResponse: '', race: '', events: 0, bonuses: 0, notices: 0, revokes: 0, reports: 0, issues: 0, writes: [] as string[] };
  const db = () => ({ from: (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    let operation = 'read'; let patch: Row = {};
    const execute = () => {
      if (operation === 'read' && state.failRead === table) return { data: null, error: { message: 'synthetic read failure' } };
      if (operation !== 'read' && state.failWrite === table) return { data: null, error: { message: 'synthetic write failure' } };
      if (table === 'inspection_packets' && operation === 'update' && state.race) packet.status = state.race;
      const matches = (tables[table] ?? []).filter(row => filters.every(filter => filter(row)));
      if (operation === 'update') {
        for (const row of matches) Object.assign(row, patch);
        if (matches.length) state.writes.push(table);
      } else if (operation === 'insert' || operation === 'upsert') {
        (tables[table] ??= []).push(...(Array.isArray(patch) ? patch : [patch]));
        state.writes.push(table);
      }
      if (operation !== 'read' && state.loseResponse === table) return { data: null, error: { message: 'synthetic lost response' } };
      return { data: matches, error: null };
    };
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
      neq: (key: string, value: unknown) => { filters.push(row => row[key] !== value); return query; },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query; },
      is: (key: string, value: unknown) => { filters.push(row => (row[key] ?? null) === value); return query; },
      not: (key: string, _op: string, value: unknown) => { filters.push(row => row[key] !== value); return query; },
      update: (value: Row) => { operation = 'update'; patch = value; return query; },
      insert: (value: Row) => { operation = 'insert'; patch = value; return query; },
      upsert: (value: Row) => { operation = 'upsert'; patch = value; return query; },
      maybeSingle: async () => { const result = execute(); return { ...result, data: result.data?.[0] ?? null }; },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(execute()).then(resolve, reject),
    };
    return query;
  } });
  const contractor = async () => state.cookie ? { id: 'actor-a', email: 'field@example.test', full_name: 'Synthetic inspector' } : null;
  const actor = async () => state.staff ? { kind: 'staff', email: 'staff@example.test', name: 'Synthetic staff' } : { kind: 'contractor', contractorId: 'actor-a', email: 'field@example.test', name: 'Synthetic inspector' };
  const submit = new Function('fieldDb', 'resolveContractorFromCookie', 'redirect', 'isWorkingStatus', 'logEvent', 'maybeAwardStreakBonus', 'sendStreakBonusOfficeEmail', 'sendPacketSubmittedEmail', 'revokePacketCodes', 'revalidatePath', submitCode + ';return submitPacket;')(
    db, contractor, redirect, (s: string) => ['claimed', 'in_progress'].includes(s),
    async () => { state.events++; }, async () => { if (!state.bonuses) state.bonuses++; }, async () => {}, async () => { state.notices++; }, async () => { state.revokes++; }, () => {},
  );
  const complete = new Function('fieldDb', 'supabase', 'resolveContractorFromCookie', 'resolveInspectionActor', 'redirect', 'revalidatePath', 'slipVerdictLists', 'doneOnTripNote', 'alreadyHandledNote', 'suppliesLabel', 'openWorkSlipsForInspectionIssues', 'sendInspectionReportEmail', completeCode + ';return completeInspection;')(
    db, db(), contractor, actor, redirect, () => {}, slipVerdictLists, doneOnTripNote, alreadyHandledNote, (key: string) => key,
    async () => { state.issues++; }, async () => { state.reports++; },
  );
  const form = new FormData(); form.set('packet_id', String(packet.id));
  return { packet, stop, inspection, tables, state, submit: () => submit(form), complete: (opts: Row = { packetId: packet.id }) => complete(inspection.id, opts) };
}
const returnsToPacket = (action: () => Promise<unknown>) => assert.rejects(action, /^Error: REDIRECT:\/field\/packet\/packet-a$/);

test('Field completion uses awarded Field session with a staff login; slip closure and reports wait for office approval', async () => {
  const f = fixture(); f.stop.status = 'in_progress';
  await returnsToPacket(() => f.complete({ packetId: 'packet-a', slipsDone: ['slip-a'], suppliesLow: ['soap'] }));
  assert.equal(f.stop.status, 'complete'); assert.ok(f.inspection.completed_at);
  assert.equal(f.tables.work_slips[0].status, 'in_progress', 'awaits office closure');
  assert.equal(f.tables.packet_stop_work_slips.length, 1);
  assert.equal(f.tables.work_slips.length, 2, 'restock record retained');
  assert.equal(f.state.reports, 0); assert.equal(f.state.issues, 0);
  assert.equal(f.packet.status, 'in_progress', 'completion does not approve or submit the packet');
});

test('Field completion refuses incomplete cards and issues without evidence, even with a staff session', async () => {
  const f = fixture(); f.inspection.ordered_cards.push({ itemId: 'item-b', zoneId: null });
  await assert.rejects(() => f.complete(), /Mark every card/); assert.deepEqual(f.state.writes, []);
  f.inspection.completed_at = 'synthetic-saved';
  await assert.rejects(() => f.complete(), /Mark every card/); assert.deepEqual(f.state.writes, []);
  f.inspection.ordered_cards.pop(); f.tables.inspection_results[0].status = 'issue';
  await assert.rejects(() => f.complete(), /Add a photo/); assert.deepEqual(f.state.writes, []);
});

test('Field context cannot borrow staff permission for an absent cookie, foreign packet or inspection', async () => {
  for (const mode of ['cookie', 'owner', 'packet', 'stop']) {
    const f = fixture();
    if (mode === 'cookie') f.state.cookie = false;
    if (mode === 'owner') f.packet.awarded_contractor_id = 'actor-b';
    if (mode === 'packet') f.packet.id = 'packet-b';
    if (mode === 'stop') f.tables.packet_stops.length = 0;
    await assert.rejects(() => f.complete(), /Reopen your Field link|Not your inspection/);
    assert.deepEqual(f.state.writes, []);
  }
});

test('failed stop write is retryable without duplicating inspection history, restock slips or reports', async () => {
  const f = fixture(); f.stop.status = 'in_progress'; f.state.failWrite = 'packet_stops';
  await assert.rejects(() => f.complete({ packetId: 'packet-a', suppliesLow: ['soap'] }), /inspection is saved/);
  assert.ok(f.inspection.completed_at); assert.equal(f.stop.status, 'in_progress');
  f.state.failWrite = '';
  await returnsToPacket(() => f.complete()); await returnsToPacket(() => f.complete());
  assert.equal(f.stop.status, 'complete'); assert.equal(f.tables.work_slips.length, 2);
  assert.equal(f.tables.properties[0].inspections_since_last_intermittent, 3);
  assert.equal(f.state.reports, 0);
});

test('stale completion on submitted, approved or cancelled Field packets does not mutate inspection records', async () => {
  for (const status of ['submitted', 'approved', 'cancelled']) {
    const f = fixture(); f.packet.status = status;
    await returnsToPacket(() => f.complete()); assert.deepEqual(f.state.writes, []);
  }
});

test('inspection and packet read failures cannot mutate or complete the stop', async () => {
  for (const table of ['packet_stops', 'inspection_packets', 'inspections', 'inspection_results']) {
    const f = fixture(); f.state.failRead = table;
    await assert.rejects(() => f.complete(), /Could not/); assert.deepEqual(f.state.writes, []);
  }
});

test('a lost stop response is safely confirmed on retry without repeating history', async () => {
  const f = fixture(); f.stop.status = 'in_progress'; f.state.loseResponse = 'packet_stops';
  await assert.rejects(() => f.complete(), /inspection is saved/); assert.equal(f.stop.status, 'complete');
  f.state.loseResponse = ''; await returnsToPacket(() => f.complete());
  assert.equal(f.tables.properties[0].inspections_since_last_intermittent, 3);
});

test('standalone staff inspection retains its summary and report flow', async () => {
  const f = fixture(); f.state.cookie = false;
  await assert.rejects(() => f.complete({}), /REDIRECT:\/inspections\/inspection-a\/summary/);
  assert.equal(f.state.reports, 1); assert.equal(f.state.issues, 1);
});

test('incomplete, empty and unreadable packets cannot submit', async () => {
  for (const mode of ['pending', 'empty', 'read']) {
    const f = fixture();
    if (mode === 'pending') f.stop.status = 'in_progress';
    if (mode === 'empty') f.tables.packet_stops.length = 0;
    if (mode === 'read') f.state.failRead = 'packet_stops';
    await assert.rejects(f.submit, mode === 'read' ? /submiterror=1/ : /incomplete=1/);
    assert.equal(f.packet.status, 'in_progress'); assert.equal(f.state.events, 0);
  }
});

test('concurrent submit clicks transition once, retaining pay and the manager approval gate', async () => {
  const f = fixture();
  await Promise.all([returnsToPacket(f.submit), returnsToPacket(f.submit)]);
  assert.equal(f.packet.status, 'submitted'); assert.ok(f.stop.departed_at);
  assert.equal(f.state.events, 1); assert.equal(f.state.notices, 1); assert.equal(f.state.bonuses, 1);
  assert.equal(f.packet.bonus_cents, 900); assert.equal(f.packet.final_payout_cents, 7800);
  assert.equal(f.packet.approved_at, undefined);
  await returnsToPacket(f.submit); assert.equal(f.state.events, 1);
});

test('submission errors remain retryable and do not claim success or send notices', async () => {
  const f = fixture(); f.state.failWrite = 'inspection_packets';
  await assert.rejects(f.submit, /submiterror=1/);
  assert.equal(f.packet.status, 'in_progress'); assert.equal(f.state.notices, 0); assert.equal(f.state.revokes, 0);
  f.state.failWrite = '';
  await returnsToPacket(f.submit); assert.equal(f.packet.status, 'submitted'); assert.equal(f.state.events, 1);
});

test('an already-submitted packet repairs only idempotent handoff work and retains its original timestamp', async () => {
  const f = fixture(); f.packet.status = 'submitted'; f.packet.submitted_at = 'synthetic-original';
  await returnsToPacket(f.submit); await returnsToPacket(f.submit);
  assert.equal(f.packet.submitted_at, 'synthetic-original'); assert.equal(f.state.events, 0);
  assert.equal(f.state.notices, 0); assert.equal(f.state.bonuses, 1);
});

test('a lost submit response followed by retry cannot reopen or duplicate submission', async () => {
  const f = fixture(); f.state.loseResponse = 'inspection_packets';
  await assert.rejects(f.submit, /submiterror=1/); assert.equal(f.packet.status, 'submitted');
  f.state.loseResponse = ''; await returnsToPacket(f.submit);
  assert.equal(f.packet.status, 'submitted'); assert.equal(f.state.writes.filter(t => t === 'inspection_packets').length, 1);
  assert.ok(f.stop.departed_at); assert.equal(f.state.bonuses, 1); assert.equal(f.state.revokes, 1);
  assert.equal(f.state.notices, 0, 'an uncertain write does not send duplicate review mail');
});

test('terminal, paid, unauthenticated and foreign packets cannot be submitted from a stale form', async () => {
  for (const mode of ['draft', 'published', 'approved', 'cancelled', 'paid', 'foreign', 'cookie']) {
    const f = fixture();
    if (mode === 'paid') f.packet.paid_at = 'synthetic-paid';
    else if (mode === 'foreign') f.packet.awarded_contractor_id = 'actor-b';
    else if (mode === 'cookie') f.state.cookie = false;
    else f.packet.status = mode;
    await assert.rejects(f.submit, /REDIRECT:\/field/); assert.deepEqual(f.state.writes, []);
    assert.equal(f.state.events, 0);
  }
});

test('submission compares current assignment and status in the write, so concurrent office actions win', async () => {
  const f = fixture(); f.state.race = 'approved';
  await returnsToPacket(f.submit); assert.equal(f.packet.status, 'approved'); assert.equal(f.state.events, 0);
});

test('Field UI passes packet context, keeps saved-but-unconfirmed stops retryable and hides submit on closed packets', () => {
  assert.match(read('inspections/[id]/Stepper.tsx'), /completeInspection\(inspectionId, \{\s*packetId,/);
  assert.match(read('field/inspect/[inspectionId]/page.tsx'), /insp.completed_at && stop.status === 'complete'/);
  assert.match(read('field/packet/[packetId]/page.tsx'), /isMine && working && allComplete/);
});
