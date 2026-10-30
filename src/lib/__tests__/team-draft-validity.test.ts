import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { draftValidity } from '../draft-validity.ts';

function load(path: string, imports: Record<string, unknown>) {
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, (...args: any[]) => Promise<any>> = {};
  runInNewContext(js, { exports, require: (name: string) => imports[name] ?? {}, Date });
  return exports;
}

for (const audience of ['cleaner', 'contractor']) {
  const cap = audience[0].toUpperCase() + audience.slice(1);
  function fixture({ signedIn = true, stale = false, readFails = false, missing = false } = {}) {
    const calls: string[] = [];
    const list = async () => {
      calls.push('read');
      return readFails ? { ok: false } : { ok: true, data: { approvals: missing ? [] : [{ id: 'draft', created_at: new Date(Date.now() - (stale ? 3 * 86400000 : 0)).toISOString(), draft: 'Please finish today.' }] } };
    };
    const timing = load('lib/team-draft-validity.ts', { './stay-concierge': { listCleanerApprovals: list, listContractorApprovals: list }, './draft-validity': { draftValidity } });
    const action = load(`app/${audience}-messaging/actions.ts`, {
      '@/auth': { auth: async () => signedIn ? { user: { email: 'operator@example.test' } } : null },
      '@/lib/team-draft-validity': timing,
      '@/lib/approval-receipt': { sentReceipt: () => ({}) },
      'next/cache': { revalidatePath: () => {} },
      '@/lib/stay-concierge': {
        [`approve${cap}Approval`]: async () => { calls.push('send'); return { ok: true, data: {} }; },
        [`schedule${cap}Approval`]: async () => { calls.push('schedule'); return { ok: true, data: {} }; },
      },
    });
    return { calls, approve: () => action[`approve${cap}Draft`]('draft'), schedule: (date: string) => action[`schedule${cap}Draft`]('draft', date) };
  }
  test(`${audience}: no send when signed out, stale, missing or timing cannot be checked`, async () => {
    for (const options of [{ signedIn: false }, { stale: true }, { readFails: true }, { missing: true }]) {
      const f = fixture(options);
      assert.equal((await f.approve()).ok, false);
      assert.ok(!f.calls.includes('send'));
      if (options.signedIn === false) assert.equal(f.calls.length, 0);
    }
  });
  test(`${audience}: canonical draft checked before send; relative wording cannot be scheduled across a day`, async () => {
    const f = fixture();
    assert.equal((await f.approve()).ok, true);
    assert.deepEqual(f.calls, ['read', 'send']);
    assert.equal((await f.schedule(new Date(Date.now() + 2 * 86400000).toISOString())).ok, false);
    assert.ok(!f.calls.includes('schedule'));
  });
}
