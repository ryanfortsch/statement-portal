/** Local recovery evidence only. No network, database access, or restore execution. */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime();
const project = z.string().regex(/^[a-z]{20}$/);
const scopeSchema = z.object({
  environment: z.enum(['staging', 'production']),
  projectRef: project,
}).strict();
export type RecoveryScope = z.infer<typeof scopeSchema>;
export const RECOVERY_COMPONENTS = ['database', 'storage', 'configuration'] as const;
const artifactSchema = z.object({
  component: z.enum(RECOVERY_COMPONENTS),
  filename: z.enum(['database.age', 'storage.age', 'configuration.age']),
  sha256: digest,
  bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();
const manifestSchema = z.object({
  version: z.literal(1),
  backupId: z.string().uuid(),
  scope: scopeSchema,
  snapshotAt: timestamp,
  completedAt: timestamp,
  expiresAt: timestamp,
  appCommit: z.string().regex(/^[a-f0-9]{40}$/),
  encryption: z.literal('age-v1'),
  recipientFingerprint: digest,
  artifacts: z.array(artifactSchema).length(RECOVERY_COMPONENTS.length),
}).strict();
export type RecoveryManifest = z.infer<typeof manifestSchema>;

/** Do not expose validation errors: input can contain credentials or guest data. */
export function parseRecoveryManifest(raw: unknown): RecoveryManifest {
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) throw new Error('Invalid recovery manifest');
  const m = parsed.data;
  if (new Set(m.artifacts.map(a => a.component)).size !== RECOVERY_COMPONENTS.length ||
      m.artifacts.some(a => a.filename !== `${a.component}.age`) ||
      Date.parse(m.completedAt) < Date.parse(m.snapshotAt) ||
      Date.parse(m.expiresAt) <= Date.parse(m.completedAt)) {
    throw new Error('Invalid recovery manifest');
  }
  return m;
}

/** Stable digest binds operator restore evidence to this exact manifest. */
export function recoveryManifestDigest(raw: unknown): string {
  const m = parseRecoveryManifest(raw);
  const normalized = { ...m, artifacts: [...m.artifacts].sort((a, b) => a.component.localeCompare(b.component)) };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export type BundleVerification = {
  manifestSha256: string;
  byteIntegrityVerified: true;
  artifactCount: number;
  encryptionAuthenticated: false;
  databaseRestoreVerified: false;
};

/**
 * Hash each encrypted artifact with bounded memory. An age header is only a format
 * check; decryption/authentication and database restore are separate drill steps.
 * The local directory must be private and quiescent for the entire operation.
 */
export async function verifyRecoveryBundle(
  raw: unknown, directory: string, expected: RecoveryScope, now: Date,
): Promise<BundleVerification> {
  const m = parseRecoveryManifest(raw);
  assertScopeAndTime(m, expected, now);
  const root = await realpath(directory);
  for (const artifact of m.artifacts) {
    // A fixed flat allowlist and O_NOFOLLOW prevent manifest paths or symlinks
    // from making this tool read some other local file (including credentials).
    let file;
    try {
      file = await open(join(root, artifact.filename), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const before = await file.stat();
      if (!before.isFile() || before.size !== artifact.bytes) throw new Error('Invalid artifact');
      const header = Buffer.alloc(22);
      await file.read(header, 0, header.length, 0);
      if (header.toString('ascii') !== 'age-encryption.org/v1\n') {
        // The format marker is 22 bytes, including its newline.
        throw new Error('Invalid artifact');
      }
      const hash = createHash('sha256');
      let bytes = 0;
      for await (const chunk of file.createReadStream({ start: 0, autoClose: false })) {
        bytes += chunk.length;
        if (bytes > artifact.bytes) throw new Error('Artifact changed');
        hash.update(chunk);
      }
      const after = await file.stat();
      if (bytes !== artifact.bytes || hash.digest('hex') !== artifact.sha256 ||
          before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
        throw new Error('Artifact changed');
      }
    } catch {
      throw new Error(`Recovery artifact verification failed: ${artifact.component}`);
    } finally {
      await file?.close();
    }
  }
  return {
    manifestSha256: recoveryManifestDigest(m), byteIntegrityVerified: true,
    artifactCount: m.artifacts.length, encryptionAuthenticated: false, databaseRestoreVerified: false,
  };
}

function assertScopeAndTime(m: RecoveryManifest, expected: RecoveryScope, now: Date) {
  if (!scopeSchema.safeParse(expected).success || m.scope.projectRef !== expected.projectRef ||
      m.scope.environment !== expected.environment) throw new Error('Recovery source scope mismatch');
  if (!Number.isFinite(now.getTime()) || Date.parse(m.completedAt) > now.getTime() ||
      Date.parse(m.snapshotAt) > now.getTime()) throw new Error('Invalid recovery clock');
  if (Date.parse(m.expiresAt) <= now.getTime()) throw new Error('Recovery copy has expired');
}

export const RESTORE_CHECKS = [
  'decryptionAuthenticated', 'schemaAndRoles', 'rlsAndAccess', 'canonicalBookings',
  'cancellationsAndInventory', 'messageReceiptsAndDedup', 'messageTimesAndHolds',
  'financialRecordsUnchanged', 'storageInventoryAndContents', 'configurationAndKeyRecovery',
  'deletionRequestsReapplied',
] as const;
const checkSchema = z.object(Object.fromEntries(RESTORE_CHECKS.map(name => [name, z.boolean()])) as
  Record<typeof RESTORE_CHECKS[number], z.ZodBoolean>).strict();
const drillSchema = z.object({
  version: z.literal(1),
  manifestSha256: digest,
  testedAppCommit: z.string().regex(/^[a-f0-9]{40}$/),
  source: scopeSchema,
  targetProjectRef: project,
  targetEnvironment: z.literal('isolated-recovery'),
  startedAt: timestamp,
  finishedAt: timestamp,
  outboundNetworkBlocked: z.boolean(),
  schedulersDisabled: z.boolean(),
  checks: checkSchema,
}).strict();
export type RestoreDrillEvidence = z.infer<typeof drillSchema>;

/**
 * Checks consistency of trusted operator evidence; it is NOT an attestation or
 * production cutover permission. Call verifyRecoveryBundle independently first.
 */
export function assessRestoreEvidence(rawManifest: unknown, rawDrill: unknown, options: {
  expected: RecoveryScope; expectedAppCommit: string; now: Date;
  maxSnapshotAgeHours: number; maxRestoreMinutes: number;
}) {
  const m = parseRecoveryManifest(rawManifest);
  assertScopeAndTime(m, options.expected, options.now);
  if (!/^[a-f0-9]{40}$/.test(options.expectedAppCommit) ||
      !Number.isFinite(options.maxSnapshotAgeHours) || options.maxSnapshotAgeHours <= 0 ||
      !Number.isFinite(options.maxRestoreMinutes) || options.maxRestoreMinutes <= 0) {
    throw new Error('Invalid recovery policy');
  }
  const blockers: string[] = [];
  const sha = recoveryManifestDigest(m);
  if (options.now.getTime() - Date.parse(m.snapshotAt) > options.maxSnapshotAgeHours * 3_600_000) blockers.push('snapshot_too_old');
  if (m.appCommit !== options.expectedAppCommit) blockers.push('application_version_mismatch');
  const parsed = drillSchema.safeParse(rawDrill);
  if (!parsed.success) blockers.push('restore_evidence_missing_or_invalid');
  else {
    const d = parsed.data;
    if (d.manifestSha256 !== sha) blockers.push('restore_evidence_wrong_bundle');
    if (d.source.projectRef !== m.scope.projectRef || d.source.environment !== m.scope.environment) blockers.push('restore_evidence_wrong_source');
    if (d.testedAppCommit !== options.expectedAppCommit) blockers.push('restore_evidence_wrong_application');
    if (d.targetProjectRef === m.scope.projectRef) blockers.push('restore_target_is_source');
    if (!d.outboundNetworkBlocked || !d.schedulersDisabled) blockers.push('restore_not_isolated');
    const start = Date.parse(d.startedAt), finish = Date.parse(d.finishedAt);
    if (start < Date.parse(m.completedAt) || finish < start || finish > options.now.getTime()) blockers.push('restore_evidence_invalid_time');
    if (finish - start > options.maxRestoreMinutes * 60_000) blockers.push('restore_time_exceeded');
    for (const check of RESTORE_CHECKS) if (!d.checks[check]) blockers.push(`restore_check_failed:${check}`);
  }
  return { manifestSha256: sha, restoreEvidenceAccepted: blockers.length === 0, blockers,
    productionCutoverAuthorized: false as const };
}
