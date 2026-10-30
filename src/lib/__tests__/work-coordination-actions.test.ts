import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';
import { coordinationPatch } from '../work-coordination.ts';

const code = ts.transpileModule(readFileSync(new URL('../../app/work/actions.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture({ signedIn = true, missing = false, failure = false } = {}) {
  const writes: object[] = [], refreshes: string[] = [];
  const client = createClient('https://synthetic.supabase.co', 'synthetic', {
    auth: { persistSession: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, '/rest/v1/work_slips');
      assert.equal(init?.method, 'PATCH');
      writes.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(failure ? { message: 'synthetic error' } : missing ? null : { property_id: 'home-a' }), { status: failure ? 400 : 200, headers: { 'content-type': 'application/json' } });
    } },
  });
  const exports: { updateWorkSlipCoordination?: (input: object) => Promise<{ ok: boolean }> } = {};
  runInNewContext(code, { exports, require: (name: string) => ({
    '@/auth': { auth: async () => signedIn ? { user: { email: 'operator@example.test' } } : null },
    '@/lib/team': { TEAM_MEMBERS: [{ email: 'operator@example.test', active: true }] },
    '@/lib/work-coordination': { coordinationPatch },
    '@/lib/supabase-admin': { supabaseAdmin: client },
    'next/cache': { revalidatePath: (path: string) => refreshes.push(path) },
  })[name] ?? {} });
  return { save: exports.updateWorkSlipCoordination!, writes, refreshes };
}
test('coordinator action authenticates and validates before a write', async () => {
  const loggedOut = fixture({ signedIn: false });
  assert.equal((await loggedOut.save({ id: 'slip-a', coordinator_email: null })).ok, false);
  assert.equal(loggedOut.writes.length, 0);
  const invalid = fixture();
  assert.equal((await invalid.save({ id: 'slip-a', follow_up_date: '2026-02-30' })).ok, false);
  assert.equal(invalid.writes.length, 0);
});
test('coordinator writes only its own fields and refreshes all affected surfaces', async () => {
  const f = fixture();
  assert.equal((await f.save({ id: 'slip-a', coordinator_email: 'operator@example.test', follow_up_date: '2026-11-02' })).ok, true);
  assert.deepEqual(f.writes, [{ coordinator_email: 'operator@example.test', follow_up_date: '2026-11-02' }]);
  assert.deepEqual(f.refreshes, ['/', '/work', '/work/slip-a', '/properties/home-a']);
});
test('missing slip and refused write never report a confirmed save', async () => {
  for (const opts of [{ missing: true }, { failure: true }]) {
    const f = fixture(opts);
    assert.equal((await f.save({ id: 'slip-a', coordinator_email: null })).ok, false);
    assert.deepEqual(f.refreshes, []);
  }
});
