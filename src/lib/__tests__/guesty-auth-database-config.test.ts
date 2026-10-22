import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guestyAuthDatabaseConfig } from '../guesty-auth-database-config.ts';
import { serverDatabaseConfig } from '../server-database-config.ts';
const env = {
  publicUrl: 'https://jgkblfozftcvymvwhhii.supabase.co', serviceRoleKey: 'HELMTEST-source-cache',
  isolatedCalendarEnabled: 'true', vercelEnv: 'preview', branch: 'codex/channex-staging-pilot',
  guestyAuthCacheUrl: 'https://qjueexujiuticjrtqdyj.supabase.co',
};
test('ordinary token-cache configuration remains unchanged without the isolated calendar flag', () => {
  assert.deepEqual(guestyAuthDatabaseConfig({}), { url: '', serviceKey: '' });
  assert.deepEqual(guestyAuthDatabaseConfig({ ...env, isolatedCalendarEnabled: 'false', vercelEnv: 'production', branch: 'main' }),
    { url: env.publicUrl, serviceKey: env.serviceRoleKey });
});
test('source token-cache binding and isolated calendar binding keep their own credentials and destinations', () => {
  assert.deepEqual(guestyAuthDatabaseConfig(env), { url: env.guestyAuthCacheUrl, serviceKey: 'HELMTEST-source-cache' });
  assert.deepEqual(serverDatabaseConfig({ ...env, stagingUrl: env.publicUrl, stagingServiceKey: 'HELMTEST-isolated' }),
    { url: env.publicUrl, serviceKey: 'HELMTEST-isolated' });
});
test('isolated mode rejects missing, mismatched or expanded source-cache configuration', () => {
  for (const patch of [{ guestyAuthCacheUrl: undefined }, { guestyAuthCacheUrl: env.publicUrl }, { guestyAuthCacheUrl: 'https://other.supabase.co' },
    { guestyAuthCacheUrl: env.guestyAuthCacheUrl + '/extra' }, { serviceRoleKey: '' }, { serviceRoleKey: '  ' },
    { vercelEnv: 'production' }, { vercelEnv: 'development' }, { vercelEnv: undefined },
    { branch: 'main' }, { branch: undefined }, { publicUrl: env.guestyAuthCacheUrl }, { publicUrl: undefined }]) {
    assert.throws(() => guestyAuthDatabaseConfig({ ...env, ...patch }), { message: 'Guesty source token cache is not configured for the isolated preview' });
  }
});
