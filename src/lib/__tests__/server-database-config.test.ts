import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { serverDatabaseConfig, type ServerDatabaseEnvironment } from '../server-database-config.ts';

const isolated: ServerDatabaseEnvironment = {
  publicUrl: 'https://jgkblfozftcvymvwhhii.supabase.co',
  serviceRoleKey: 'unrelated-live-placeholder',
  isolatedCalendarEnabled: 'true',
  stagingUrl: 'https://jgkblfozftcvymvwhhii.supabase.co',
  stagingServiceKey: 'isolated-placeholder',
  vercelEnv: 'preview', branch: 'codex/channex-staging-pilot',
};

describe('ordinary app isolated database binding', () => {
  it('keeps ordinary production and unconfigured behavior unchanged without opt-in', () => {
    assert.deepEqual(serverDatabaseConfig({}), { url: '', serviceKey: '' });
    assert.deepEqual(serverDatabaseConfig({ publicUrl: 'https://normal.example', serviceRoleKey: 'normal' }),
      { url: 'https://normal.example', serviceKey: 'normal' });
  });
  it('reuses only the existing isolated credential, ignoring the inherited live credential', () => {
    assert.deepEqual(serverDatabaseConfig(isolated), { url: isolated.publicUrl, serviceKey: 'isolated-placeholder' });
  });
  for (const patch of [
    { vercelEnv: 'production' }, { vercelEnv: 'development' }, { vercelEnv: undefined },
    { branch: 'main' }, { branch: undefined },
    { publicUrl: 'https://normal.example' }, { publicUrl: undefined },
    { stagingUrl: 'https://normal.example' }, { stagingUrl: undefined },
    { stagingServiceKey: '' }, { stagingServiceKey: '  ' },
  ]) it('fails closed for ' + JSON.stringify(patch), () => {
    assert.throws(() => serverDatabaseConfig({ ...isolated, ...patch }), /Isolated calendar database/);
  });
});
