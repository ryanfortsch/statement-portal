import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { NextRequest } from 'next/server.js';

const require = createRequire(import.meta.url);
// Node 24 is required by this repo; its module hooks are newer than @types/node.
const { registerHooks } = require('node:module');
const routeUrl = new URL('../../app/api/archive-onboarding/route.ts', import.meta.url).href;
const stateKey = Symbol.for('helm.archive-onboarding-test');
const token = 'a'.repeat(32);
const otherToken = 'b'.repeat(32);
const savedUrl = 'https://drive.example/synthetic-intake';
const originalRow = {
  id: 'synthetic-projection', property_id: null, property_address: 'Synthetic Home',
  onboarding_token: token, onboarding_submitted_at: '2026-09-27T12:00:00Z',
  onboarding_drive_url: null,
};
let rows: Array<Record<string, unknown>>;
let staff: boolean;
let lookupError: boolean;
let archiveOk: boolean;
let calls: string[];
let renderArgs: Record<string, unknown> | undefined;
let updates: Array<Record<string, unknown>>;

const fixture = {
  auth: async () => staff ? { user: { email: 'synthetic@risingtidestr.com' } } : null,
  supabaseAdmin: {
    from(table: string) {
      assert.equal(table, 'projections');
      calls.push('database');
      const filters: Array<[string, unknown]> = [];
      let update: Record<string, unknown> | undefined;
      const query = {
        select() { return query; },
        eq(column: string, value: unknown) { filters.push([column, value]); return query; },
        update(payload: Record<string, unknown>) { update = payload; return query; },
        async maybeSingle() {
          if (lookupError) return { data: null, error: { message: 'synthetic outage' } };
          return { data: rows.find(row => filters.every(([key, value]) => row[key] === value)) ?? null, error: null };
        },
        then(resolve: (value: { error: null }) => unknown) {
          assert.ok(update);
          const matching = rows.filter(row => filters.every(([key, value]) => row[key] === value));
          for (const row of matching) Object.assign(row, update);
          updates.push(update);
          calls.push('update');
          return Promise.resolve(resolve({ error: null }));
        },
      };
      return query;
    },
  },
  getProperty: () => ({ name: 'Synthetic Home' }),
  renderOnboardingPdf: async (args: Record<string, unknown>) => {
    renderArgs = args;
    calls.push('render');
    return Buffer.from('synthetic-pdf');
  },
  onboardingPdfFilename: () => 'Synthetic intake.pdf',
  archiveToDrive: async () => {
    calls.push('archive');
    return archiveOk ? { ok: true, url: savedUrl } : { ok: false, reason: 'synthetic outage' };
  },
};
(globalThis as unknown as Record<symbol, unknown>)[stateKey] = fixture;

// Load the real POST handler, replacing only its external boundaries. Nothing
// can reach Auth.js, a database, Chromium, or Drive in these unit tests.
const exportsByModule: Record<string, string[]> = {
  '@/auth': ['auth'],
  '@/lib/supabase-admin': ['supabaseAdmin'],
  '@/lib/properties': ['getProperty'],
  '@/lib/onboarding-pdf': ['renderOnboardingPdf', 'onboardingPdfFilename'],
  '@/lib/drive-archive': ['archiveToDrive'],
};
const hook = registerHooks({
  resolve(specifier: string, context: { parentURL?: string }, nextResolve: (s: string, c: unknown) => unknown) {
    if (context.parentURL === routeUrl) {
      if (specifier === 'next/server') {
        return { url: pathToFileURL(require.resolve('next/server')).href, shortCircuit: true };
      }
      const names = exportsByModule[specifier];
      if (names) {
        const source = `const fixture = globalThis[Symbol.for('helm.archive-onboarding-test')];\n`
          + names.map(name => `export const ${name} = fixture.${name};`).join('\n');
        return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
      }
      if (specifier.startsWith('@/')) throw new Error(`Unmocked route dependency: ${specifier}`);
    }
    return nextResolve(specifier, context);
  },
});
const { POST } = await import(routeUrl) as { POST: (request: NextRequest) => Promise<Response> };
hook.deregister();
after(() => { delete (globalThis as unknown as Record<symbol, unknown>)[stateKey]; });

beforeEach((t) => {
  rows = [{ ...originalRow }];
  staff = false;
  lookupError = false;
  archiveOk = true;
  calls = [];
  updates = [];
  renderArgs = undefined;
  assert.ok('mock' in t);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('No network allowed'); });
  t.mock.method(console, 'error', () => {});
});

function request(body: unknown, query = '') {
  return new NextRequest(`https://helm.example/api/archive-onboarding${query}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

test('anonymous IDs and malformed tokens are denied before any database access', async () => {
  for (const badToken of [undefined, null, '', 'forged', 123, [], {}, 'a'.repeat(31), 'a'.repeat(33)]) {
    const response = await POST(request({ projectionId: originalRow.id, token: badToken }));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { ok: false, error: 'unauthorized' });
  }
  assert.deepEqual(calls, []);
});

test('a token in the URL cannot authorize archive work', async () => {
  const response = await POST(request({ projectionId: originalRow.id }, `?token=${token}`));
  assert.equal(response.status, 401);
  assert.deepEqual(calls, []);
});

test('another owner token cannot return an existing Drive URL or start work', async () => {
  rows[0].onboarding_drive_url = savedUrl;
  rows.push({ ...originalRow, id: 'other-projection', onboarding_token: otherToken });
  const response = await POST(request({ projectionId: originalRow.id, token: otherToken }));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { ok: false, error: 'unauthorized' });
  assert.deepEqual(calls, ['database']);
});

test('unknown IDs and a missing stored token do not disclose record existence', async () => {
  rows[0].onboarding_token = null;
  for (const projectionId of [originalRow.id, 'unknown-projection']) {
    const response = await POST(request({ projectionId, token }));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { ok: false, error: 'unauthorized' });
  }
  assert.deepEqual(calls, ['database', 'database']);
});

for (const mode of ['owner', 'staff'] as const) {
  test(`${mode} can archive once and re-read the existing archive without repeating work`, async () => {
    staff = mode === 'staff';
    const body = { projectionId: originalRow.id, ...(staff ? {} : { token }) };
    const response = await POST(request(body));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, url: savedUrl });
    assert.deepEqual(renderArgs, { projectionId: originalRow.id, origin: 'https://helm.example', token });
    assert.deepEqual(updates, [{ onboarding_drive_url: savedUrl }]);
    const repeat = await POST(request(body));
    assert.equal(repeat.status, 200);
    assert.deepEqual(await repeat.json(), { ok: true, url: savedUrl, alreadyArchived: true });
    assert.equal(calls.filter(c => c === 'render').length, 1);
    assert.equal(calls.filter(c => c === 'archive').length, 1);
    assert.equal(updates.length, 1);
  });
}

test('unsubmitted intakes cannot trigger PDF or Drive work', async () => {
  rows[0].onboarding_submitted_at = null;
  const response = await POST(request({ projectionId: originalRow.id, token }));
  assert.equal(response.status, 400);
  assert.deepEqual(calls, ['database']);
});

test('database errors fail closed without PDF or Drive work', async () => {
  lookupError = true;
  const response = await POST(request({ projectionId: originalRow.id, token }));
  assert.equal(response.status, 500);
  assert.deepEqual(calls, ['database']);
});

test('failed Drive archival does not stamp a record as archived', async () => {
  archiveOk = false;
  const response = await POST(request({ projectionId: originalRow.id, token }));
  assert.equal(response.status, 502);
  assert.deepEqual(updates, []);
  assert.equal(rows[0].onboarding_drive_url, null);
});

test('bad request bodies do not reach the database', async () => {
  for (const body of [null, [], {}, { projectionId: 123 }]) {
    assert.equal((await POST(request(body))).status, 400);
  }
  const malformed = new NextRequest('https://helm.example/api/archive-onboarding', { method: 'POST', body: '{' });
  assert.equal((await POST(malformed)).status, 400);
  assert.deepEqual(calls, []);
});

test('the thank-you page carries its validated token into the archive POST body', () => {
  const page = readFileSync(new URL('../../app/onboarding/[token]/thanks/page.tsx', import.meta.url), 'utf8');
  const trigger = readFileSync(new URL('../../app/onboarding/[token]/thanks/ArchiveOnboardingTrigger.tsx', import.meta.url), 'utf8');
  assert.match(page, /<ArchiveOnboardingTrigger\s+projectionId=\{prospect\.id\}\s+token=\{token\}/);
  assert.match(trigger, /body:\s*JSON\.stringify\(\{ projectionId, token \}\)/);
  assert.match(trigger, /fetch\('\/api\/archive-onboarding',/);
});
