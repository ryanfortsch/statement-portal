import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function fixture(configured: boolean, data: unknown, error: unknown = null) {
  const fallback = { id: 'fallback-home', name: 'Synthetic fallback' };
  const calls: unknown[][] = [];
  const result = { data, error };
  const query = {
    select(columns: string) { calls.push(['select', columns]); return query; },
    eq(key: string, value: unknown) { calls.push(['eq', key, value]); return query; },
    order(key: string) { calls.push(['order', key]); return Promise.resolve(result); },
    maybeSingle() { calls.push(['single']); return Promise.resolve(result); },
  };
  const mocks: Record<string, unknown> = {
    'server-only': {},
    './properties': { PROPERTIES: { 'fallback-home': fallback } },
    './supabase-admin': {
      isServiceConfigured: configured,
      supabaseAdmin: { from(table: string) { calls.push(['from', table]); return query; } },
    },
  };
  const source = readFileSync(new URL('../properties-server.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const compiled = { exports: {} as {
    getActivePropertiesForStatements(): Promise<unknown[]>;
    getActivePropertyForStatements(id: string): Promise<unknown>;
  } };
  new Function('require', 'module', 'exports', output)((name: string) => {
    assert.ok(name in mocks, `Unexpected external dependency: ${name}`);
    return mocks[name];
  }, compiled, compiled.exports);
  return { ...compiled.exports, calls, fallback };
}

test('server property loaders retain their offline fallback without database calls', async () => {
  const f = fixture(false, null);
  assert.deepEqual(await f.getActivePropertiesForStatements(), [f.fallback]);
  assert.deepEqual(await f.getActivePropertyForStatements('fallback-home'), f.fallback);
  assert.equal(await f.getActivePropertyForStatements('missing'), null);
  assert.deepEqual(f.calls, []);
});

test('server property loaders retain database row mapping and query scope', async () => {
  const row = { id: 'synthetic-home', name: 'Synthetic home', address: 'Fixture address', city: 'Fixture city',
    management_fee_pct: '25', listing_match: 'FIXTURE HOME', is_rising_tide_owned: false,
    bank_last4: null, tax_cert_id: null };
  const expected = { id: row.id, name: row.name, address: row.address, city: row.city,
    owner_last: '', owner_full: '', owner_greeting: '', owner_emails: [], fee_pct: 25,
    bank_last4: null, listing_match: 'fixture home', tax_cert_id: null, is_rising_tide_owned: false };
  const list = fixture(true, [row]);
  assert.deepEqual(await list.getActivePropertiesForStatements(), [expected]);
  assert.ok(list.calls.some(c => c[0] === 'eq' && c[1] === 'is_active' && c[2] === true));
  const one = fixture(true, row);
  assert.deepEqual(await one.getActivePropertyForStatements('synthetic-home'), expected);
  assert.ok(one.calls.some(c => c[0] === 'eq' && c[1] === 'id' && c[2] === 'synthetic-home'));
});

test('server property loaders retain fallback on failed or missing database reads', async () => {
  const failed = fixture(true, null, { message: 'Synthetic unavailable database' });
  assert.deepEqual(await failed.getActivePropertiesForStatements(), [failed.fallback]);
  assert.deepEqual(await failed.getActivePropertyForStatements('fallback-home'), failed.fallback);
  const absent = fixture(true, null);
  assert.equal(await absent.getActivePropertyForStatements('missing'), null);
});
