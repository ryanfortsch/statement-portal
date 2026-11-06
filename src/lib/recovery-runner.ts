/** Explicit one-shot worker coordination; importing this module never starts a backup. */
import { createHash, createPublicKey } from 'node:crypto';
import { lstat, mkdir, open, realpath, statfs, unlink } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { parseRecoveryManifest, recoveryManifestDigest, verifyRecoveryBundle } from './recovery-bundle.ts';
import { createEncryptedRecoveryBundle, readRecoveryJson, signRecoveryDigest, verifyRecoverySignature, writeRecoveryJson, type RecoverySource } from './recovery-export.ts';
import { uploadRecoveryBundle } from './recovery-drive.ts';

const path = z.string().max(1024).refine(v => isAbsolute(v) && !/[\0\r\n]/.test(v));
const envName = z.string().regex(/^RECOVERY_[A-Z0-9_]{1,100}$/);
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const access = z.enum(['private', 'public']);
const planSchema = z.object({
  version: z.literal(1), enabled: z.boolean(),
  scope: z.object({ projectRef: z.string().regex(/^[a-z]{20}$/), environment: z.enum(['staging', 'production']) }).strict(),
  appCommit: z.string().regex(/^[a-f0-9]{40}$/), spoolDirectory: path,
  ageExecutable: path, pgDumpExecutable: path, pgDumpAllExecutable: path,
  recipient: z.string().regex(/^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/),
  signingPublicKey: z.string().max(1024).startsWith('-----BEGIN PUBLIC KEY-----'),
  database: z.object({ host: z.string().max(200), port: z.literal(5432), database: z.literal('postgres'),
    user: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/), rootCertificate: path }).strict(),
  storage: z.object({ region: z.string().regex(/^[a-z0-9-]{3,64}$/),
    buckets: z.record(z.string().regex(/^[A-Za-z0-9._-]{1,100}$/), access),
    blobs: z.array(z.object({ storeId: z.string().regex(/^[a-z0-9]{1,50}$/), access, tokenEnvironment: envName }).strict()).max(19) }).strict(),
  drive: z.object({ driveId: z.string().regex(/^[A-Za-z0-9_-]{10,200}$/), folderId: z.string().regex(/^[A-Za-z0-9_-]{10,200}$/),
    serviceAccountEmail: z.string().regex(/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/) }).strict(),
  // These references describe independently reviewed records; they are not proof of access or custody.
  custody: z.object({ kind: z.literal('business-password-manager'), recordReference: z.string().regex(/^[A-Za-z0-9_./:-]{1,200}$/) }).strict(),
  limits: z.object({ maxArtifactBytes: positive.max(110 * 1024 ** 3), maxDatabaseBytes: positive.max(100 * 1024 ** 3),
    maxObjects: positive.max(1_000_000), maxObjectBytes: positive, maxStorageBytes: positive,
    maxInventoryBytes: positive.max(64 * 1024 ** 2), timeoutMs: positive.max(86_400_000), retentionDays: positive.max(30) }).strict(),
}).strict();
export type RecoveryPlan = z.infer<typeof planSchema>;
const failure = () => new Error('Recovery worker failed; inspect configuration and retained run evidence');
export function parseRecoveryPlan(raw: unknown): RecoveryPlan {
  const result = planSchema.safeParse(raw);
  if (!result.success) throw new Error('Invalid recovery worker plan');
  const p = result.data;
  try {
    const publicKey = createPublicKey(p.signingPublicKey);
    if (publicKey.asymmetricKeyType !== 'ed25519' ||
        publicKey.export({ type: 'spki', format: 'pem' }).toString().trim() !== p.signingPublicKey.trim()) throw new Error();
  } catch { throw new Error('Invalid recovery worker plan'); }
  // First worker release supports the direct Supabase endpoint only, with verified TLS.
  if (p.database.host !== `db.${p.scope.projectRef}.supabase.co` || Object.keys(p.storage.buckets).length > 1000 ||
      new Set(p.storage.blobs.map(b => b.storeId)).size !== p.storage.blobs.length ||
      new Set(p.storage.blobs.map(b => b.tokenEnvironment)).size !== p.storage.blobs.length ||
      new Set(recoveryEnvironmentNames(p)).size !== recoveryEnvironmentNames(p).length ||
      p.limits.maxDatabaseBytes > p.limits.maxArtifactBytes || p.limits.maxStorageBytes > p.limits.maxArtifactBytes ||
      p.limits.maxObjectBytes > p.limits.maxStorageBytes) throw new Error('Invalid recovery worker plan');
  return p;
}
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export const recoveryPlanDigest = (plan: RecoveryPlan) => digest(JSON.stringify(parseRecoveryPlan(plan)));
export function recoveryEnvironmentNames(plan: RecoveryPlan) {
  return ['RECOVERY_DATABASE_PASSWORD', 'RECOVERY_S3_ACCESS_KEY_ID', 'RECOVERY_S3_SECRET_ACCESS_KEY',
    'RECOVERY_GOOGLE_SERVICE_ACCOUNT_KEY', 'RECOVERY_SIGNING_PRIVATE_KEY', ...plan.storage.blobs.map(b => b.tokenEnvironment)];
}
/** Stable daily identity: retry a completed export with the same Drive IDs. No timer is installed. */
export function recoveryDailyId(plan: RecoveryPlan, now: Date) {
  const h = digest(`${recoveryPlanDigest(plan)}\n${now.toISOString().slice(0, 10)}`).slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20)}`;
}
async function exists(path: string) {
  try { await lstat(path); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw failure(); }
}
async function privateDirectory(directory: string, create = false) {
  if (create) await mkdir(directory, { mode: 0o700 }).catch(e => { if (e.code !== 'EEXIST') throw failure(); });
  const s = await lstat(directory);
  if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o077) !== 0 ||
      (process.getuid && s.uid !== process.getuid()) || await realpath(directory) !== resolve(directory)) throw failure();
}
type Dependencies = {
  sources: (plan: RecoveryPlan) => Promise<Record<'database' | 'storage' | 'configuration', RecoverySource>>;
  encrypt?: typeof createEncryptedRecoveryBundle; upload?: typeof uploadRecoveryBundle;
};
export async function runRecoveryOnce(options: {
  plan: RecoveryPlan; backupId?: string; signingPrivateKey: string; getAccessToken: () => Promise<string>;
  signal: AbortSignal; dependencies: Dependencies;
}) {
  const p = parseRecoveryPlan(options.plan);
  if (!p.enabled || options.signal.aborted) throw failure();
  const planDigest = recoveryPlanDigest(p), backupId = options.backupId ?? recoveryDailyId(p, new Date());
  if (!z.string().uuid().safeParse(backupId).success) throw failure();
  // Reject mismatched keys before opening sources or writing a run intent.
  signRecoveryDigest('manifest', planDigest, options.signingPrivateKey, p.signingPublicKey);
  await privateDirectory(p.spoolDirectory);
  const lockPath = join(p.spoolDirectory, '.worker.lock'), lock = await open(lockPath, 'wx', 0o600);
  try {
    await lock.writeFile(JSON.stringify({ backupId, pid: process.pid, startedAt: new Date().toISOString() }) + '\n'); await lock.sync();
    const bundles = join(p.spoolDirectory, 'bundles'), intents = join(p.spoolDirectory, 'intents');
    await privateDirectory(bundles, true); await privateDirectory(intents, true);
    const runIntent = join(intents, backupId); await privateDirectory(runIntent, true);
    const intentPath = join(runIntent, 'intent.json');
    if (!await exists(intentPath)) {
      const snapshotAt = new Date().toISOString();
      await writeRecoveryJson(runIntent, 'intent.json', { version: 1, backupId, planDigest, snapshotAt,
        expiresAt: new Date(Date.parse(snapshotAt) + p.limits.retentionDays * 86_400_000).toISOString() });
    }
    const intent = z.object({ version: z.literal(1), backupId: z.literal(backupId), planDigest: z.literal(planDigest),
      snapshotAt: z.iso.datetime(), expiresAt: z.iso.datetime() }).strict().parse(await readRecoveryJson(intentPath));
    const directory = join(bundles, backupId), signedPath = join(directory, 'manifest.signed.json');
    const resumed = await exists(signedPath);
    if (!resumed) {
      // Never overwrite partial ciphertext; an operator can start a separate UUID after investigation.
      if (await exists(directory) || Date.parse(intent.snapshotAt) > Date.now() || Date.now() - Date.parse(intent.snapshotAt) > p.limits.timeoutMs) throw failure();
      const disk = await statfs(p.spoolDirectory, { bigint: true });
      if (disk.bavail * disk.bsize < BigInt(p.limits.maxArtifactBytes) * BigInt(3) + BigInt(64 * 1024 ** 2)) throw failure();
      const sources = await options.dependencies.sources(p);
      await (options.dependencies.encrypt ?? createEncryptedRecoveryBundle)({ metadata: { backupId, scope: p.scope,
        snapshotAt: intent.snapshotAt, expiresAt: intent.expiresAt, appCommit: p.appCommit },
        sources, parentDirectory: bundles, ageExecutable: p.ageExecutable, recipient: p.recipient,
        signingPrivateKey: options.signingPrivateKey, trustedSigningPublicKey: p.signingPublicKey,
        maxArtifactBytes: p.limits.maxArtifactBytes, timeoutMs: p.limits.timeoutMs, signal: options.signal });
    }
    await privateDirectory(directory);
    const envelope = z.object({ manifest: z.unknown(), signature: z.unknown() }).strict().parse(await readRecoveryJson(signedPath));
    const m = parseRecoveryManifest(envelope.manifest);
    verifyRecoverySignature('manifest', recoveryManifestDigest(m), envelope.signature, p.signingPublicKey);
    if (m.backupId !== backupId || m.snapshotAt !== intent.snapshotAt || m.expiresAt !== intent.expiresAt ||
        m.appCommit !== p.appCommit || m.recipientFingerprint !== digest(p.recipient)) throw failure();
    await verifyRecoveryBundle(m, directory, p.scope, new Date());
    const report = await (options.dependencies.upload ?? uploadRecoveryBundle)({ directory, expectedScope: p.scope,
      driveId: p.drive.driveId, folderId: p.drive.folderId, getAccessToken: options.getAccessToken,
      signingPrivateKey: options.signingPrivateKey, trustedSigningPublicKey: p.signingPublicKey, signal: options.signal });
    return { backupId, resumed, snapshotAt: m.snapshotAt, ...report };
  } catch { throw failure(); }
  finally { await lock.close(); await unlink(lockPath); }
}
