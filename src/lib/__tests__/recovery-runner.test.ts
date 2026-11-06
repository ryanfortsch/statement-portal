import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { parseRecoveryPlan, recoveryDailyId, runRecoveryOnce, type RecoveryPlan } from '../recovery-runner.ts';
import { parseRecoveryManifest, recoveryManifestDigest, RECOVERY_COMPONENTS } from '../recovery-bundle.ts';
import { signRecoveryDigest, writeRecoveryJson } from '../recovery-export.ts';

const keys = generateKeyPairSync('ed25519'), privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
function plan(directory: string): RecoveryPlan { return parseRecoveryPlan({ version: 1, enabled: true,
  scope: { projectRef: 'a'.repeat(20), environment: 'staging' }, appCommit: 'b'.repeat(40), spoolDirectory: directory,
  ageExecutable: '/opt/bin/age', pgDumpExecutable: '/opt/bin/pg_dump', pgDumpAllExecutable: '/opt/bin/pg_dumpall', recipient: 'age1' + 'q'.repeat(58),
  signingPublicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  database: { host: `db.${'a'.repeat(20)}.supabase.co`, port: 5432, database: 'postgres', user: 'backup_reader', rootCertificate: '/private/root.crt' },
  storage: { region: 'us-east-2', buckets: { documents: 'private' }, blobs: [] },
  drive: { driveId: 'synthetic_drive', folderId: 'synthetic_folder', serviceAccountEmail: 'recovery@synthetic-project.iam.gserviceaccount.com' },
  custody: { kind: 'business-password-manager', recordReference: 'synthetic/vault/recovery' },
  limits: { maxArtifactBytes: 1024 * 1024, maxDatabaseBytes: 10000, maxObjects: 100, maxObjectBytes: 10000, maxStorageBytes: 10000, maxInventoryBytes: 10000, timeoutMs: 10000, retentionDays: 30 } }); }
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-runner-'))); t.after(() => rm(directory, { recursive: true, force: true }));
  const p = plan(directory); let exports = 0, uploads = 0, sources = 0, failUpload = false;
  const dependencies: Parameters<typeof runRecoveryOnce>[0]['dependencies'] = {
    sources: async () => { sources++; const s = { open: () => Readable.from(['fixture']), assertComplete: async () => {} }; return { database: s, storage: s, configuration: s }; },
    encrypt: async o => {
      exports++; const dir = join(o.parentDirectory, o.metadata.backupId); await mkdir(dir, { mode: 0o700 });
      // Synthetic format markers only: encryption itself is covered by the real-age tests.
      const bytes = Buffer.from('age-encryption.org/v1\nsynthetic transport fixture');
      for (const c of RECOVERY_COMPONENTS) await writeFile(join(dir, `${c}.age`), bytes, { mode: 0o600 });
      const manifest = parseRecoveryManifest({ ...o.metadata, version: 1, completedAt: new Date().toISOString(), encryption: 'age-v1',
        recipientFingerprint: sha(o.recipient), artifacts: RECOVERY_COMPONENTS.map(component => ({ component, filename: `${component}.age`, bytes: bytes.length, sha256: sha(bytes) })) });
      const signature = signRecoveryDigest('manifest', recoveryManifestDigest(manifest), privateKey, p.signingPublicKey);
      await writeRecoveryJson(dir, 'manifest.signed.json', { manifest, signature }); return { directory: dir, manifest, signature };
    },
    upload: async o => { uploads++; if (failUpload) throw new Error('synthetic private diagnostics');
      const { manifest } = JSON.parse(await readFile(join(o.directory, 'manifest.signed.json'), 'utf8'));
      return { manifestSha256: recoveryManifestDigest(manifest), downloadIntegrityVerified: true, databaseRestoreVerified: false, productionCutoverAuthorized: false }; },
  };
  const options = { plan: p, signingPrivateKey: privateKey, getAccessToken: async () => 'synthetic', signal: AbortSignal.timeout(10000), dependencies };
  return { directory, p, options, counts: () => ({ exports, uploads, sources }), failUpload: (value: boolean) => { failUpload = value; } };
}
test('daily worker identity is stable within UTC day and changes with scope or plan', () => {
  const p = plan('/private/test');
  assert.equal(recoveryDailyId(p, new Date('2026-11-06T00:00:00Z')), recoveryDailyId(p, new Date('2026-11-06T23:59:59Z')));
  assert.notEqual(recoveryDailyId(p, new Date('2026-11-06')), recoveryDailyId(p, new Date('2026-11-07')));
  assert.notEqual(recoveryDailyId(p, new Date('2026-11-06')), recoveryDailyId({ ...p, appCommit: 'c'.repeat(40) }, new Date('2026-11-06')));
});
test('retry after failed upload reuses the signed export without reading sources again', async t => {
  const f = await fixture(t); f.failUpload(true); await assert.rejects(runRecoveryOnce(f.options), /Recovery worker failed/);
  f.failUpload(false); const report = await runRecoveryOnce(f.options);
  assert.equal(report.resumed, true); assert.equal(report.databaseRestoreVerified, false);
  assert.deepEqual(f.counts(), { exports: 1, sources: 1, uploads: 2 });
  assert.equal((await readdir(f.directory)).includes('.worker.lock'), false);
});
test('partial export is retained and cannot be overwritten or uploaded', async t => {
  const f = await fixture(t);
  f.options.dependencies.encrypt = async o => { await mkdir(join(o.parentDirectory, o.metadata.backupId), { mode: 0o700 }); throw new Error('private database error'); };
  await assert.rejects(runRecoveryOnce(f.options)); await assert.rejects(runRecoveryOnce(f.options));
  assert.equal(f.counts().sources, 1); assert.equal(f.counts().uploads, 0);
});
test('disabled worker and wrong signing identity never open sources', async t => {
  const f = await fixture(t);
  await assert.rejects(runRecoveryOnce({ ...f.options, plan: { ...f.p, enabled: false } }));
  await assert.rejects(runRecoveryOnce({ ...f.options, signingPrivateKey: 'invalid' }));
  assert.deepEqual(await readdir(f.directory), []); assert.equal(f.counts().sources, 0);
});
test('an existing worker lock is never stolen', async t => {
  const f = await fixture(t); await writeFile(join(f.directory, '.worker.lock'), 'existing worker');
  await assert.rejects(runRecoveryOnce(f.options)); assert.equal(f.counts().sources, 0);
  assert.equal(await readFile(join(f.directory, '.worker.lock'), 'utf8'), 'existing worker');
});
test('world-readable and symlink spool directories are rejected', async t => {
  const f = await fixture(t); await chmod(f.directory, 0o755);
  await assert.rejects(runRecoveryOnce(f.options)); await chmod(f.directory, 0o700);
  const alias = join(f.directory, 'alias'); await symlink(f.directory, alias);
  await assert.rejects(runRecoveryOnce({ ...f.options, plan: { ...f.p, spoolDirectory: alias } })); assert.equal(f.counts().sources, 0);
});
test('same explicit UUID cannot be adopted under a changed plan', async t => {
  const f = await fixture(t), backupId = randomUUID(); await runRecoveryOnce({ ...f.options, backupId });
  await assert.rejects(runRecoveryOnce({ ...f.options, backupId, plan: { ...f.p, appCommit: 'd'.repeat(40) } }));
  assert.equal(f.counts().uploads, 1);
});
test('corrupt completed ciphertext fails before retry upload', async t => {
  const f = await fixture(t), report = await runRecoveryOnce(f.options);
  await writeFile(join(f.directory, 'bundles', report.backupId, 'database.age'), 'corrupted');
  await assert.rejects(runRecoveryOnce(f.options)); assert.equal(f.counts().uploads, 1);
});
test('strict plan rejects wrong source host, unknown secret fields and unsafe limits', () => {
  const p = plan('/private/test');
  assert.throws(() => parseRecoveryPlan({ ...p, database: { ...p.database, host: 'wrong.supabase.co' } }));
  assert.throws(() => parseRecoveryPlan({ ...p, password: 'do-not-log' }));
  assert.throws(() => parseRecoveryPlan({ ...p, signingPublicKey: p.signingPublicKey + privateKey }));
  assert.throws(() => parseRecoveryPlan({ ...p, storage: { ...p.storage, blobs: [{ storeId: 'fake', access: 'private', tokenEnvironment: 'RECOVERY_DATABASE_PASSWORD' }] } }));
  assert.throws(() => parseRecoveryPlan({ ...p, limits: { ...p.limits, maxDatabaseBytes: p.limits.maxArtifactBytes + 1 } }));
});
test('default CLI check reports only missing names and never executes a source', async t => {
  const f = await fixture(t), file = join(f.directory, 'plan.json'); await writeFile(file, JSON.stringify(f.p));
  const output = execFileSync(process.execPath, ['scripts/run-recovery-worker.mts', '--plan', file], { cwd: process.cwd(),
    env: { NODE_ENV: 'test', PATH: '/usr/bin:/bin', RECOVERY_DATABASE_PASSWORD: 'synthetic-never-output' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.ok(!output.includes('synthetic-never-output'));
  const report = JSON.parse(output); assert.equal(report.sourcesContacted, false); assert.equal(report.schedulerInstalled, false);
  assert.ok(report.missingEnvironmentNames.includes('RECOVERY_SIGNING_PRIVATE_KEY'));
  assert.deepEqual(await readdir(f.directory), ['plan.json']);
});
