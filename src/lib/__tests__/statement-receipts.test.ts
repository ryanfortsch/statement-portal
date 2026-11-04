import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';
import { isStatementMonth, statementsReceiptsHref } from '../statements-month.ts';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const compile = (source: string) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const route = compile(read('../../app/api/receipts/route.ts'));
type Row = Record<string, unknown>;
type RequestLog = { table: string; method: string; body: Row; params: URLSearchParams };

// Real POST/GET handlers and real PostgREST query builder; all I/O is local.
function fixture(options: { statement?: boolean; recomputeFails?: boolean; signedIn?: boolean } = {}) {
  const rows: Row[] = [], requests: RequestLog[] = [], uploads: string[] = [], recomputes: Row[] = [];
  const db = createClient('https://synthetic.supabase.co', 'synthetic-key', {
    auth: { persistSession: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.includes('/storage/')) {
        uploads.push(url.pathname);
        return Response.json({ Key: url.pathname });
      }
      const r: RequestLog = { table: url.pathname.split('/').at(-1)!, method: init?.method || 'GET', body: init?.body ? JSON.parse(String(init.body)) : {}, params: url.searchParams };
      requests.push(r);
      let data: unknown = [];
      if (r.table === 'property_receipts') {
        if (r.method === 'POST') {
          const row = { ...r.body, id: `receipt-${rows.length + 1}` };
          rows.push(row); data = row;
        } else {
          data = rows.filter(row => [...r.params].every(([key, value]) => !value.startsWith('eq.') || String(row[key]) === value.slice(3)));
        }
      } else if (r.table === 'statement_periods') data = options.statement ? { id: 'period-a' } : null;
      else if (r.table === 'property_statements') data = options.statement ? { id: 'statement-a', repairs_total: 25, owner_payout: 500 } : null;
      else if (r.table === 'close_tasks') data = null;
      return Response.json(data);
    } },
  });
  const deps: Record<string, unknown> = {
    '@supabase/supabase-js': { createClient: () => db },
    'next/server': { NextResponse: Response },
    '@/auth': { auth: async () => options.signedIn === false ? null : { user: { email: 'owner@example.test' } } },
    '@/lib/properties-server': { getActivePropertyForStatements: async (id: string) => id === 'new-home' ? { id } : null },
    '@/lib/statements-month': { isStatementMonth },
    '@/lib/statement-finality': { getFreezeStatus: async () => ({ frozen: false }) },
    '@/lib/statement-totals-write': { writeStatementTotals: async (_db: unknown, _id: string, args: Row) => {
      recomputes.push(args);
      if (options.recomputeFails) throw Error('Synthetic recompute failure');
      return { after: { owner_payout: 450 } };
    } },
  };
  const api: { POST?: (req: Request) => Promise<Response>; GET?: (req: { nextUrl: URL }) => Promise<Response> } = {};
  runInNewContext(route, { exports: api, File, process: { env: {} }, console: { warn() {}, error() {} }, require: (name: string) => {
    if (!(name in deps)) throw Error(`Unexpected dependency ${name}`);
    return deps[name];
  } });
  async function post(fields: Record<string, string> = {}, withFile = true) {
    const form = new FormData();
    for (const [key, value] of Object.entries({ property_id: 'new-home', month: '2026-11', expense_date: '2026-11-03', amount: '50.25', vendor_name: 'Synthetic shop', description: 'House supplies', category: 'supplies', ...fields })) form.set(key, value);
    if (withFile) form.set('file', new File(['synthetic receipt'], 'receipt.pdf', { type: 'application/pdf' }));
    const response = await api.POST!(new Request('https://helm.test/api/receipts', { method: 'POST', body: form }));
    return { status: response.status, body: await response.json() };
  }
  return { post, rows, requests, uploads, recomputes, db, api };
}

test('a first receipt saves its property, month, date and attachment without minting a statement or payout', async () => {
  const f = fixture();
  const { status, body } = await f.post();
  assert.equal(status, 200); assert.equal(body.ok, true); assert.equal(body.statement_found, false);
  assert.equal(body.owner_payout, null); assert.equal(body.repairs_total, null);
  assert.equal(f.rows.length, 1); assert.equal(f.uploads.length, 1); assert.equal(f.recomputes.length, 0);
  assert.deepEqual({ ...f.rows[0], receipt_path: 'attached' }, {
    id: 'receipt-1', property_id: 'new-home', month: '2026-11', expense_date: '2026-11-03',
    amount: 50.25, vendor_name: 'Synthetic shop', description: 'House supplies', category: 'supplies',
    receipt_path: 'attached', status: 'active', created_by: 'owner@example.test',
  });
  assert.match(String(f.rows[0].receipt_path), /^new-home\/2026-11\/.*-receipt.pdf$/);
  assert.deepEqual(f.requests.filter(r => r.method !== 'GET').map(r => r.table), ['property_receipts']);
  const response = await f.api.GET!({ nextUrl: new URL('https://helm.test/api/receipts?property_id=new-home&month=2026-11') });
  assert.equal((await response.json()).receipts[0].id, 'receipt-1');
});

test('a possible duplicate stops before another upload or insert, and cancellation leaves one receipt', async () => {
  const f = fixture(); await f.post();
  const result = await f.post();
  assert.equal(result.body.needs_confirm, true);
  assert.equal(result.body.warnings[0].kind, 'possible_duplicate_receipt');
  assert.equal(f.rows.length, 1); assert.equal(f.uploads.length, 1);
  // No override is submitted when the operator cancels.
  const override = await f.post({ acknowledge_warnings: 'true' });
  assert.equal(override.body.ok, true); assert.equal(f.rows.length, 2);
});

test('voided receipts and another month do not trigger a duplicate warning', async () => {
  const f = fixture(); await f.post(); f.rows[0].status = 'void';
  assert.equal((await f.post()).body.ok, true);
  assert.equal((await f.post({ month: '2026-12' })).body.ok, true);
});

test('the existing statement path still mirrors once and uses the existing totals writer', async () => {
  const f = fixture({ statement: true }); const result = await f.post();
  assert.equal(result.body.statement_found, true);
  assert.equal(f.requests.filter(r => r.table === 'repair_events' && r.method === 'POST').length, 1);
  assert.equal(f.recomputes.length, 1); assert.equal(f.recomputes[0].repairsTotal, 75.25);
});

test('a saved receipt is identified when recompute fails, so the UI can refuse a duplicate retry', async () => {
  const f = fixture({ statement: true, recomputeFails: true }); const result = await f.post();
  assert.equal(result.status, 500); assert.equal(result.body.receipt.id, 'receipt-1');
  assert.match(result.body.error, /Do not add it again/); assert.equal(f.rows.length, 1);
});

test('invalid months, unknown properties and unsigned requests write nothing', async () => {
  for (const fields of [{ month: '2026-13' }, { property_id: 'unknown' }] as Record<string, string>[]) {
    const f = fixture(); assert.equal((await f.post(fields)).status, 400);
    assert.equal(f.rows.length, 0); assert.equal(f.uploads.length, 0);
  }
  const f = fixture({ signedIn: false }); assert.equal((await f.post()).status, 401); assert.equal(f.requests.length, 0);
});

test('the first import and re-import fold durable receipts in exactly once, scoped to active property-month', async () => {
  const f = fixture(); await f.post();
  f.rows.push({ ...f.rows[0], id: 'void', status: 'void', amount: 99 }, { ...f.rows[0], id: 'other', property_id: 'other-home', amount: 99 }, { ...f.rows[0], id: 'later', month: '2026-12', amount: 99 });
  const ingest = read('../../app/api/ingest/route.ts');
  // Execute the unchanged production read/sum and mirror blocks, with a
  // synthetic import base. No Guesty financial record is fabricated.
  const readBlock = ingest.slice(ingest.indexOf('    type ActiveReceipt ='), ingest.indexOf('    // Central Booking.com deposits'));
  const mirrorBlock = ingest.slice(ingest.indexOf('      for (const r of activeReceipts)'), ingest.indexOf('      if (repairInserts.length > 0)'));
  const body = compile(`async function reconcile(supabase) { const propertyId='new-home', month='2026-11'; let repairsTotal=25; ${readBlock} const stmt={id:'new-statement'}; const repairInserts=[]; ${mirrorBlock} return {repairsTotal,repairInserts}; }`);
  const reconcile = new Function(`${body}; return reconcile;`)();
  for (let i = 0; i < 2; i++) {
    const result = await reconcile(f.db);
    assert.equal(result.repairsTotal, 75.25);
    assert.equal(result.repairInserts.length, 1);
    assert.equal(result.repairInserts[0].receipt_id, 'receipt-1');
    assert.equal(result.repairInserts[0].bank_charge_amount, 50.25);
  }
  assert.equal(f.rows.length, 4, 'import does not replace the durable receipts');
});

test('Statements offers receipts without a statement, preserving the requested missing month', () => {
  assert.equal(statementsReceiptsHref('2026-11', 'new home'), '/statements/receipts?month=2026-11&property=new+home');
  assert.equal(statementsReceiptsHref('2026-13'), '/statements/receipts');
  const dashboard = read('../../app/statements/page.tsx');
  assert.match(dashboard, /statementsReceiptsHref\(missingMonth \|\| selectedMonth\)/);
  assert.match(dashboard, /statementsReceiptsHref\(missingMonth \|\| urlMonth \|\| selectedMonth\)/);
  const page = read('../../app/statements/receipts/page.tsx');
  const ownerGuard = page.indexOf('await requireOwnerEmail()');
  assert.ok(ownerGuard >= 0 && ownerGuard < page.indexOf('await loadActiveProperties()'));
});
