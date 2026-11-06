/** Disabled-by-default, explicit one-shot exporter. Never loads .env or runs from a web request. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { parseArgs } from 'node:util';
import { parseRecoveryPlan, recoveryEnvironmentNames, recoveryDailyId, runRecoveryOnce } from '../src/lib/recovery-runner.ts';
import { createPostgresRecoverySource, createPostgresRolesSource } from '../src/lib/recovery-postgres.ts';
import { createDatabaseArchiveSource } from '../src/lib/recovery-database-archive.ts';
import { createStorageRecoverySource } from '../src/lib/recovery-storage.ts';
import { createRecoveryS3Client, createSupabaseStorageStore, createVercelBlobStore } from '../src/lib/recovery-storage-providers.ts';
import { createRecoveryTokenProvider } from '../src/lib/recovery-google-auth.ts';
import { readRecoveryJson } from '../src/lib/recovery-export.ts';

const clients: { destroy(): void }[] = [];
try {
  const { values: v } = parseArgs({ options: { plan: { type: 'string' }, check: { type: 'boolean' }, once: { type: 'boolean' },
    'backup-id': { type: 'string' }, help: { type: 'boolean' } }, strict: true, allowPositionals: false });
  if (v.help) {
    console.log('Offline configuration check: node scripts/run-recovery-worker.mts --plan /private/plan.json --check');
    console.log('Explicit authorized export/upload: same command with --once (requires enabled:true).');
    console.log('Daily retries reuse one ID. --backup-id UUID starts/retries a distinct reviewed run. No scheduler or secret file loading.');
  } else {
    if (!v.plan || (v.once && v.check) || (v['backup-id'] && !v.once)) throw new Error();
    const plan = parseRecoveryPlan(await readRecoveryJson(resolve(v.plan)));
    const names = recoveryEnvironmentNames(plan), missing = names.filter(name => !process.env[name]);
    if (!v.once) {
      console.log(JSON.stringify({ planValid: true, enabled: plan.enabled, scope: plan.scope, dailyBackupId: recoveryDailyId(plan, new Date()),
        requiredEnvironmentNames: names, missingEnvironmentNames: missing, credentialsVerified: false, destinationAccessVerified: false,
        sourcesContacted: false, schedulerInstalled: false }));
    } else {
      if (missing.length || !plan.enabled) throw new Error();
      const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(); return value; };
      const root = dirname(dirname(fileURLToPath(import.meta.url)));
      const gitEnv = { PATH: '/usr/bin:/bin', LANG: 'C', NODE_ENV: 'production' as const };
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, env: gitEnv, timeout: 10000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      if (commit !== plan.appCommit) throw new Error();
      execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'src/lib/recovery-*', 'scripts/run-recovery-worker.mts', 'supabase/migrations'], { cwd: root, env: gitEnv, timeout: 10000, stdio: 'pipe' });
      if (execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', 'src/lib/recovery-*', 'scripts/run-recovery-worker.mts', 'supabase/migrations'], { cwd: root, env: gitEnv, timeout: 10000, stdio: 'pipe' }).length) throw new Error();
      const signal = AbortSignal.timeout(plan.limits.timeoutMs);
      const report = await runRecoveryOnce({ plan, backupId: v['backup-id'], signal,
        signingPrivateKey: required('RECOVERY_SIGNING_PRIVATE_KEY'),
        getAccessToken: createRecoveryTokenProvider(required('RECOVERY_GOOGLE_SERVICE_ACCOUNT_KEY'), plan.drive.serviceAccountEmail),
        dependencies: { sources: async p => {
          const migrations: { path: string; bytes: number; sha256: string }[] = [];
          const migrationDirectory = join(root, 'supabase/migrations'); let totalBytes = 0;
          const files = (await readdir(migrationDirectory)).filter(name => name.endsWith('.sql')).sort();
          if (!files.length || files.length > 10000) throw new Error();
          for (const name of files) {
            const file = join(migrationDirectory, name), stat = await lstat(file);
            if (!stat.isFile() || stat.size > 10 * 1024 ** 2 || await realpath(file) !== file) throw new Error();
            totalBytes += stat.size; if (totalBytes > 64 * 1024 ** 2) throw new Error();
            const bytes = await readFile(file);
            migrations.push({ path: `supabase/migrations/${name}`, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
          }
          const version = (binary: string) => execFileSync(binary, ['--version'], { env: gitEnv, timeout: 5000, encoding: 'utf8', maxBuffer: 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
          const tools = { pgDump: version(p.pgDumpExecutable), pgDumpAll: version(p.pgDumpAllExecutable), age: version(p.ageExecutable) };
          // Random psql guard handling in the role archive is verified against PostgreSQL 18.
          if (!/^pg_dump \(PostgreSQL\) 18\./.test(tools.pgDump) || !/^pg_dumpall \(PostgreSQL\) 18\./.test(tools.pgDumpAll)) throw new Error();
          const connection = { ...p.database, expectedHost: p.database.host, password: required('RECOVERY_DATABASE_PASSWORD'),
            tls: { mode: 'verify-full' as const, rootCertificate: p.database.rootCertificate } };
          const database = createDatabaseArchiveSource({ maxDatabaseBytes: p.limits.maxDatabaseBytes, timeoutMs: p.limits.timeoutMs,
            database: createPostgresRecoverySource({ pgDumpExecutable: p.pgDumpExecutable, connection, timeoutMs: p.limits.timeoutMs }),
            roles: () => createPostgresRolesSource({ pgDumpAllExecutable: p.pgDumpAllExecutable, connection, timeoutMs: p.limits.timeoutMs }) });
          const s3 = createRecoveryS3Client({ projectRef: p.scope.projectRef, region: p.storage.region,
            accessKeyId: required('RECOVERY_S3_ACCESS_KEY_ID'), secretAccessKey: required('RECOVERY_S3_SECRET_ACCESS_KEY') });
          clients.push(s3);
          const storage = createStorageRecoverySource({ stores: [createSupabaseStorageStore(s3, p.storage.buckets),
            ...p.storage.blobs.map(b => createVercelBlobStore({ token: required(b.tokenEnvironment), expectedStoreId: b.storeId, access: b.access }))],
            maxObjects: p.limits.maxObjects, maxObjectBytes: p.limits.maxObjectBytes, maxTotalBytes: p.limits.maxStorageBytes,
            maxInventoryBytes: p.limits.maxInventoryBytes, timeoutMs: p.limits.timeoutMs });
          const configuration = Buffer.from(JSON.stringify({ version: 1, format: 'helm-configuration-v1', plan: p, tools, migrations,
            credentialEnvironmentNames: names, secretsIncluded: false, hostedRestoreVerified: false,
            restoreRunbook: 'docs/operations/hosted-supabase-recovery.md',
            warnings: ['Cluster role passwords and external encryption keys require independent custody.',
              'Database and object storage are not an atomic snapshot. Reconcile references during restore.',
              'Provider settings, effective ACLs and application secret versions require independent recovery records.'] }) + '\n');
          return { database, storage, configuration: { open: () => Readable.from([configuration]), assertComplete: async () => {} } };
        } },
      });
      console.log(JSON.stringify(report));
    }
  }
} catch {
  console.error('Recovery worker failed. No new success is recorded. Run --check and inspect private run evidence; never paste credentials or dump output into logs.');
  process.exitCode = 1;
} finally { for (const client of clients) client.destroy(); }
