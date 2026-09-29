import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

for (const audience of ['guest', 'owner', 'cleaner', 'contractor']) {
  const route = audience === 'guest' ? 'messaging' : audience + '-messaging';
  const code = ts.transpileModule(readFileSync(new URL(`../../app/${route}/reminders-actions.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const list = audience === 'guest' ? 'fetchRecurringReminders' : 'fetchProactiveReminders';
  const targets = audience === 'guest' ? 'fetchReservationPicks' : 'fetchProactiveTargets';
  function fixture(signedIn = true) {
    const calls: { name: string; args: unknown[] }[] = [];
    let result: unknown = { ok: false, error: 'Synthetic unavailable' };
    let throws = false;
    const call = (name: string) => async (...args: unknown[]) => {
      calls.push({ name, args }); if (throws) throw Error('Synthetic lost response'); return result;
    };
    const deps: Record<string, unknown> = {
      '@/auth': { auth: async () => signedIn ? { user: { email: 'synthetic@example.test' } } : null },
      'next/cache': { revalidatePath() {} },
      '@/lib/stay-concierge': {
        listRecurring: call('list'), listProactiveTargets: call('targets'), listReservationsForPicker: call('targets'),
        createRecurring: call('create'), endRecurring: call('end'), explainError: (e: string) => e,
        polishProactive: call('polish'), polishProactiveFor: call('polish'),
      },
    };
    // Exercise the actual action bodies with synthetic service boundaries.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actions: Record<string, (...args: any[]) => Promise<any>> = {};
    runInNewContext(code, { exports: actions, require: (name: string) => { assert.ok(name in deps); return deps[name]; } });
    return { actions, calls, respond(value: unknown) { result = value; }, failTransport() { throws = true; } };
  }
  describe(audience + ' reminder reads', () => {
    test('failed schedule read stays a failure instead of an empty success', async () => {
      const f = fixture(), result = await f.actions[list](); assert.equal(result.ok, false); assert.equal(result.error, 'Synthetic unavailable'); assert.equal(result.recurring, undefined);
    });
    test('failed recipient read stays a failure instead of an empty success', async () => {
      const f = fixture(), result = await f.actions[targets](); assert.equal(result.ok, false); assert.equal(result.error, 'Synthetic unavailable'); assert.equal(result.targets ?? result.reservations, undefined);
    });
    test('confirmed empty lists remain legitimate successes', async () => {
      const f = fixture(); f.respond({ ok: true, data: { recurring: [], targets: [], reservations: [] } });
      assert.equal((await f.actions[list]()).ok, true); assert.equal((await f.actions[targets]()).ok, true);
    });
    test('returns actual rows with the correct audience scope', async () => {
      const f = fixture(), rows = [{ id: 'synthetic', body: 'Exact wording' }]; f.respond({ ok: true, data: { recurring: rows, targets: rows, reservations: rows } });
      assert.equal((await f.actions[list]()).recurring, rows); const result = await f.actions[targets](); assert.equal(result.targets ?? result.reservations, rows);
      assert.deepEqual(f.calls.map(c => c.args), audience === 'guest' ? [[], []] : [[audience], [audience]]);
    });
    test('signed-out requests cannot query either service', async () => {
      const f = fixture(false); assert.equal((await f.actions[list]()).ok, false); assert.equal((await f.actions[targets]()).ok, false); assert.equal(f.calls.length, 0);
    });
    test('transport exceptions remain observable by client recovery', async () => {
      const f = fixture(); f.failTransport(); await assert.rejects(f.actions[list](), /Synthetic lost/); await assert.rejects(f.actions[targets](), /Synthetic lost/);
    });
  });
}
