import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { fieldSubmissionId } from '../field-submission-id.ts';

// One receipt rail per packet stop (audit Phase 3, Field): an "Add a receipt"
// chip on every stop, task or no task, homed onto the trip's payout, with
// the $500 cap stated on the field and the server clamp unchanged.

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');
const source = read('src/app/field/actions.ts');
const body = source.slice(source.indexOf('export type StopReceiptState'), source.indexOf('async function reqContext()'));
const code = ts.transpileModule(body.replaceAll('export ', ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture() {
  const slips = new Map<string, Record<string, unknown>>();
  const state = {
    actor: 'actor-a',
    packet: { id: 'packet-a', status: 'in_progress', paid_at: null as string | null, awarded_contractor_id: 'actor-a' },
    stop: { id: 'stop-a', property_id: 'home-a', packet_id: 'packet-a' },
    loseInsertResponse: false,
    recomputes: 0,
    events: 0,
  };
  const fieldDb = () => ({
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        maybeSingle: async () => {
          const match = (row: Record<string, unknown>) => filters.every(([k, v]) => row[k] === v);
          if (table === 'packet_stops') return { data: match(state.stop) ? state.stop : null, error: null };
          if (table === 'inspection_packets') return { data: match(state.packet) ? state.packet : null, error: null };
          return { data: [...slips.values()].find(match) ?? null, error: null };
        },
        insert: async (row: Record<string, unknown>) => {
          const id = row.id as string;
          if (slips.has(id)) return { error: { code: '23505' } };
          slips.set(id, row);
          return { error: state.loseInsertResponse ? { message: 'lost insert response' } : null };
        },
      };
      return query;
    },
  });
  const api = new Function(
    'fieldDb', 'fieldSubmissionId', 'resolveContractorFromCookie', 'recomputePacketExpenses', 'parseReceiptDollars', 'logEvent', 'revalidatePath',
    code + '; return { addStopReceipt, checkStopReceipt };',
  )(
    fieldDb, fieldSubmissionId,
    async () => (state.actor ? { id: state.actor, email: 'synthetic@example.test' } : null),
    async () => { state.recomputes++; },
    (raw: unknown) => { const n = Number(raw || 0); return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n * 100), 50_000) : 0; },
    async () => { state.events++; },
    () => {},
  );
  return { api, slips, state };
}

function form(fields: Record<string, string> = {}) {
  const data = new FormData();
  for (const [k, v] of Object.entries({ packet_id: 'packet-a', stop_id: 'stop-a', submission_id: '538f4efe-fdc5-4d1d-bb11-6ba9cbbf8383', expense_dollars: '27.60', what: 'Batteries for the smoke alarm', ...fields })) data.set(k, v);
  return data;
}

test('a stop receipt homes onto the trip once per attempt, as a done record, never open work', async () => {
  const { api, slips, state } = fixture();
  const results = await Promise.all([api.addStopReceipt({ ok: false }, form()), api.addStopReceipt({ ok: false }, form())]);
  assert.ok(results.every((r) => r.ok));
  assert.equal(slips.size, 1, 'one receipt for one attempt');
  const row = [...slips.values()][0];
  assert.equal(row.receipt_packet_id, 'packet-a');
  assert.equal(row.receipt_contractor_id, 'actor-a');
  assert.equal(row.expense_cents, 2760);
  assert.equal(row.status, 'done', 'a receipt is a record, not a board item');
  assert.equal(row.property_id, 'home-a');
  assert.equal(state.events, 1);
  assert.ok(state.recomputes >= 1, 'the payout recomputes');
});

test('a lost insert response is confirmed, not written twice', async () => {
  const { api, slips, state } = fixture();
  state.loseInsertResponse = true;
  assert.equal((await api.addStopReceipt({ ok: false }, form())).ok, true);
  state.loseInsertResponse = false;
  assert.equal((await api.addStopReceipt({ ok: false }, form())).ok, true);
  assert.equal(slips.size, 1);
  assert.equal((await api.checkStopReceipt('538f4efe-fdc5-4d1d-bb11-6ba9cbbf8383', 'packet-a')).ok, true);
});

test('only the awarded contractor, only before pay, only with an amount and a reason', async () => {
  for (const [label, change, fields] of [
    ['not theirs', (s: ReturnType<typeof fixture>['state']) => { s.packet.awarded_contractor_id = 'actor-b'; }, {}],
    ['already paid', (s: ReturnType<typeof fixture>['state']) => { s.packet.paid_at = '2026-10-18T12:00:00Z'; }, {}],
    ['still a listing', (s: ReturnType<typeof fixture>['state']) => { s.packet.status = 'published'; }, {}],
    ['no amount', () => {}, { expense_dollars: '' }],
    ['no reason', () => {}, { what: '' }],
    ['another trip\'s stop', () => {}, { stop_id: 'stop-z' }],
  ] as const) {
    const { api, slips, state } = fixture();
    change(state);
    const r = await api.addStopReceipt({ ok: false }, form(fields as Record<string, string>));
    assert.equal(r.ok, false, label);
    assert.equal(slips.size, 0, `${label}: nothing written`);
  }
});

test('the cap is stated on the field and is the server clamp', () => {
  const field = read('src/components/ReceiptAmountField.tsx');
  const dollars = Number(field.match(/export const RECEIPT_CAP_DOLLARS = (\d+);/)?.[1]);
  const cents = Number(read('src/lib/field-receipts.ts').match(/export const RECEIPT_CAP_CENTS = ([\d_]+);/)?.[1].replace(/_/g, ''));
  assert.equal(dollars * 100, cents, 'the stated cap is the clamp');
  assert.ok(field.includes('max={RECEIPT_CAP_DOLLARS}') && field.includes('up to ${RECEIPT_CAP_DOLLARS}'));
  // The visit report keeps its own inline clamp; it must be the same number.
  assert.ok(source.includes('Math.min(Math.round(expenseRaw * 100), 50_000)'));
  assert.equal(cents, 50_000);
});

test('every portal receipt input is the one field, and a stop has one rail', () => {
  for (const file of ['src/app/field/flag/FlagForm.tsx', 'src/app/field/property-work/BoardControls.tsx', 'src/app/field/packet/[packetId]/StopReceipt.tsx']) {
    assert.ok(read(file).includes('<ReceiptAmountField'), `${file} uses the one field`);
  }
  // Task completions on the packet page no longer ask for a receipt; the
  // field renders only to keep an amount a draft already holds.
  for (const file of ['src/app/field/packet/[packetId]/MaintenanceComplete.tsx', 'src/app/field/packet/[packetId]/StopWorkList.tsx']) {
    const src = read(file);
    assert.match(src, /\{expense && \(\s*<div style=\{\{ marginTop: 8 \}\}>\s*<ReceiptAmountField/, `${file}: legacy drafts only`);
    assert.doesNotMatch(src, /type="number"[\s\S]{0,200}expense/, `${file}: no receipt input of its own`);
  }
  const page = read('src/app/field/packet/[packetId]/page.tsx');
  assert.ok(page.includes('{receiptsOpen && (\n                <StopReceipt'), 'the chip sits in the stop chip row');
  assert.ok(page.includes("const receiptsOpen = isMine && !packet.paid_at && ['claimed', 'in_progress', 'submitted', 'approved'].includes(packet.status);"));
});
