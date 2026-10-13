import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calderwoodReadAllowed, loadCalderwoodRead } from '../calderwood-readonly/access.ts';
const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'codex/channex-staging-pilot', CHANNEX_STAGING_ENABLED: 'true' };
const input = { email: 'staff@risingtidestr.com', env, from: '2027-01-01', to: '2027-02-01' };
test('unauthorized or wrong deployment cannot acquire a Guesty credential', async () => {
  let calls = 0;
  for (const value of [{ ...input, email: null }, { ...input, email: 'staff@example.com' }, ...['production', 'development'].map(e => ({ ...input, env: { ...env, VERCEL_ENV: e } })), { ...input, env: { ...env, VERCEL_GIT_COMMIT_REF: 'main' } }, { ...input, env: { ...env, CHANNEX_STAGING_ENABLED: 'false' } }]) {
    assert.equal(calderwoodReadAllowed(value.email, value.env), false);
    await assert.rejects(loadCalderwoodRead(value, { token: async () => { calls++; return 'secret'; } }));
  }
  assert.equal(calls, 0);
});
test('invalid windows fail before token access', async () => {
  let calls = 0;
  await assert.rejects(loadCalderwoodRead({ ...input, from: '2027-02-30' }, { token: async () => { calls++; return 'secret'; } }));
  assert.equal(calls, 0);
});
test('existing token stays inside server read and raw auth errors are withheld', async () => {
  const result = await loadCalderwoodRead(input, { token: async () => 'secret-token', read: async (token, window) => {
    assert.equal(token, 'secret-token'); assert.equal(window.from, input.from);
    return { mode: 'read-only-snapshot', executable: false, inventoryAuthority: false, paginationComplete: true, baselineComplete: false, missingEvidence: ['independent-blocks', 'authoritative-revisions', 'channex-mapping', 'cross-provider-comparison'], window, reservations: [] };
  } });
  assert.ok(!JSON.stringify(result).includes('secret-token'));
  assert.ok(result.finishedAt);
  await assert.rejects(loadCalderwoodRead(input, { token: async () => { throw Error('secret-token'); } }), e => e instanceof Error && !e.message.includes('secret-token'));
});
