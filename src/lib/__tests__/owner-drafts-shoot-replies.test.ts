import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Execute the real server actions with synthetic database/auth/notification boundaries.
const source = ts.transpileModule(readFileSync(new URL('../../app/field/actions.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture() {
  let signedIn = true, owner = 'contributor', status = 'offered', fail = false, lost = false, expired = false;
  const writes: { row: Record<string, unknown>; filters: Record<string, unknown> }[] = [];
  const notifications: string[] = [], paths: string[] = [];
  const db = { from(table: string) {
    let fields = '', row: Record<string, unknown> | undefined;
    const filters: Record<string, unknown> = {};
    const query = {
      select(value: string) { fields = value; return query; },
      eq(key: string, value: unknown) { filters[key] = value; return query; },
      update(value: Record<string, unknown>) { row = value; return query; },
      async maybeSingle() {
        if (row) {
          writes.push({ row, filters });
          if (lost) throw Error('Synthetic transport failure');
          if (fail) return { data: null, error: { message: 'Synthetic write error' } };
          if (status !== filters.status) return { data: null, error: null };
          status = row.status as string;
          return { data: { id: 'shoot' }, error: null };
        }
        if (table === 'contractors') return { data: { id: 'contributor', full_name: 'Synthetic', email: 'synthetic@example.test' } };
        if (table === 'properties') return { data: { name: 'Synthetic Home' } };
        if (fields === 'brief_token') return { data: { brief_token: 'synthetic-token' } };
        return { data: { id: 'shoot', title: 'Synthetic shoot', contractor_id: owner, status, shoot_date: expired ? '2000-01-01' : '2099-01-01', property_id: 'home' } };
      },
    }; return query;
  } };
  const deps: Record<string, unknown> = {
    '@/lib/field-db': { fieldDb: () => db },
    '@/lib/field-auth': { resolveContractorFromCookie: async () => signedIn ? { id: 'contributor', full_name: 'Synthetic' } : null },
    '@/lib/field-notify': { sendShootBrief: async () => { notifications.push('accepted'); }, notifyOfficeShootDeclined: async () => { notifications.push('declined'); } },
    'next/cache': { revalidatePath: (path: string) => paths.push(path) },
    'next/navigation': { redirect: (url: string) => { throw Error('REDIRECT:' + url); } },
  };
  const actions: Record<string, (data: FormData) => Promise<{ error: string }>> = {};
  runInNewContext(source, { exports: actions, require: (name: string) => deps[name] ?? {}, Date, Intl, FormData });
  const data = new FormData(); data.set('shoot_id', 'shoot'); data.set('reason', '  Away that week  ');
  return { actions, data, writes, notifications, paths, fail() { fail = true; }, lose() { lost = true; }, signOut() { signedIn = false; }, otherOwner() { owner = 'someone-else'; }, settled() { status = 'scheduled'; }, expire() { expired = true; } };
}
for (const [action, answer] of [['acceptShoot', 'accepted'], ['declineShoot', 'declined']]) {
  test(action + ' reports rejected write without notification or success redirect', async () => { const f = fixture(); f.fail(); assert.match((await f.actions[action](f.data)).error, /Could not save/); assert.equal(f.notifications.length, 0); assert.equal(f.paths.length, 0); });
  test(action + ' does not claim success after a lost transport response', async () => { const f = fixture(); f.lose(); await assert.rejects(f.actions[action](f.data), /Synthetic transport/); assert.equal(f.notifications.length, 0); assert.equal(f.paths.length, 0); });
  test(action + ' reports a settled or withdrawn offer without notifying', async () => { const f = fixture(); f.settled(); assert.match((await f.actions[action](f.data)).error, /offer has changed/); assert.equal(f.notifications.length, 0); assert.equal(f.paths.length, 0); });
  for (const kind of ['signedOut', 'otherOwner']) test(action + ' preserves ownership gate: ' + kind, async () => { const f = fixture(); if (kind === 'signedOut') f.signOut(); else f.otherOwner(); await assert.rejects(f.actions[action](f.data), /REDIRECT:\/field$/); assert.equal(f.writes.length, 0); assert.equal(f.notifications.length, 0); });
  test(action + ' confirms a real transition once and retains notification timing', async () => {
    const f = fixture(); await assert.rejects(f.actions[action](f.data), new RegExp('answer=' + answer));
    assert.deepEqual(f.notifications, [answer]); assert.equal(f.writes.length, 1); assert.equal(f.writes[0].filters.status, 'offered'); assert.equal(f.writes[0].filters.id, 'shoot');
    assert.equal(f.writes[0].row.status, answer === 'accepted' ? 'scheduled' : 'declined'); assert.equal(f.writes[0].row.decline_reason, answer === 'accepted' ? null : 'Away that week');
    assert.match((await f.actions[action](f.data)).error, /offer has changed/); assert.deepEqual(f.notifications, [answer]);
  });
}
test('expired acceptance remains blocked before any write or notification', async () => { const f = fixture(); f.expire(); await assert.rejects(f.actions.acceptShoot(f.data), /answer=expired/); assert.equal(f.writes.length, 0); assert.equal(f.notifications.length, 0); });
test('decline reason remains optional', async () => { const f = fixture(); f.data.set('reason', ''); await assert.rejects(f.actions.declineShoot(f.data), /answer=declined/); assert.equal(f.writes[0].row.decline_reason, null); });
test('decline reason still has its server length limit', async () => { const f = fixture(); f.data.set('reason', 'x'.repeat(700)); await assert.rejects(f.actions.declineShoot(f.data), /answer=declined/); assert.equal(String(f.writes[0].row.decline_reason).length, 500); });
