import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  RECOVERY_COMPONENTS, RESTORE_CHECKS, parseRecoveryManifest, recoveryManifestDigest,
  verifyRecoveryBundle, assessRestoreEvidence,
  type RecoveryManifest, type RestoreDrillEvidence,
} from '../recovery-bundle.ts';

const scope = { environment: 'staging' as const, projectRef: 'a'.repeat(20) };
const now = new Date('2026-11-06T12:00:00Z');
const commit = 'c'.repeat(40);
// Synthetic format-shaped bytes only; these are deliberately NOT encrypted data.
// Integrity verification must never report authenticated encryption or DB restore.
const content = (kind: string) => Buffer.from(`age-encryption.org/v1\nsynthetic-${kind}-fixture`);
function manifest(): RecoveryManifest {
  return {
    version: 1, backupId: 'e31d310a-630d-4c0a-b589-81a105fd2d75', scope,
    snapshotAt: '2026-11-06T09:00:00Z', completedAt: '2026-11-06T09:10:00Z',
    expiresAt: '2026-12-06T09:00:00Z', appCommit: commit,
    encryption: 'age-v1', recipientFingerprint: 'd'.repeat(64),
    artifacts: RECOVERY_COMPONENTS.map(component => ({ component, filename: `${component}.age`,
      bytes: content(component).length, sha256: createHash('sha256').update(content(component)).digest('hex'),
    })),
  };
}
function drill(m = manifest()): RestoreDrillEvidence {
  return {
    version: 1, manifestSha256: recoveryManifestDigest(m), testedAppCommit: commit, source: scope,
    targetProjectRef: 'b'.repeat(20), targetEnvironment: 'isolated-recovery',
    startedAt: '2026-11-06T10:00:00Z', finishedAt: '2026-11-06T10:20:00Z',
    outboundNetworkBlocked: true, schedulersDisabled: true,
    checks: Object.fromEntries(RESTORE_CHECKS.map(key => [key, true])) as RestoreDrillEvidence['checks'],
  };
}
const options = () => ({ expected: scope, expectedAppCommit: commit, now,
  maxSnapshotAgeHours: 26, maxRestoreMinutes: 120 });
async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'helm-recovery-test-'));
  try {
    for (const c of RECOVERY_COMPONENTS) await writeFile(join(directory, `${c}.age`), content(c), { mode: 0o600 });
    await run(directory);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('complete artifacts verify exact bytes without claiming decryption or restoration', async () => {
  await fixture(async directory => {
    const result = await verifyRecoveryBundle(manifest(), directory, scope, now);
    assert.equal(result.byteIntegrityVerified, true);
    assert.equal(result.artifactCount, 3);
    assert.equal(result.encryptionAuthenticated, false);
    assert.equal(result.databaseRestoreVerified, false);
  });
});

test('missing storage, truncated and same-length corrupted artifacts fail closed', async () => {
  for (const mode of ['missing', 'truncated', 'corrupt']) {
    await fixture(async directory => {
      const path = join(directory, 'storage.age');
      if (mode === 'missing') await rm(path);
      else {
        const bytes = content('storage');
        bytes[bytes.length - 1] ^= 1;
        await writeFile(path, mode === 'truncated' ? bytes.subarray(0, bytes.length - 1) : bytes);
      }
      await assert.rejects(verifyRecoveryBundle(manifest(), directory, scope, now), /failed: storage/);
    });
  }
});

test('symlinks and directories are refused even when bytes or names would match', async () => {
  await fixture(async directory => {
    const path = join(directory, 'database.age');
    const other = join(directory, 'outside.age');
    await writeFile(other, content('database'));
    await rm(path);
    await symlink(other, path);
    await assert.rejects(verifyRecoveryBundle(manifest(), directory, scope, now), /failed: database/);
    await rm(path);
    await symlink(directory, path);
    await assert.rejects(verifyRecoveryBundle(manifest(), directory, scope, now), /failed: database/);
  });
});

test('plaintext renamed to age is refused even with a matching checksum', async () => {
  await fixture(async directory => {
    const m = manifest(), bytes = Buffer.from('SELECT sensitive_test_fixture;');
    m.artifacts[0].bytes = bytes.length;
    m.artifacts[0].sha256 = createHash('sha256').update(bytes).digest('hex');
    await writeFile(join(directory, 'database.age'), bytes);
    await assert.rejects(verifyRecoveryBundle(m, directory, scope, now), /failed: database/);
  });
});

test('manifest rejects traversal, duplicate or absent components, unknown fields and invalid times', () => {
  const cases: unknown[] = [];
  let m = manifest(); m.artifacts[0].filename = '../secret.age' as 'database.age'; cases.push(m);
  m = manifest(); m.artifacts[1] = m.artifacts[0]; cases.push(m);
  m = manifest(); m.artifacts.pop(); cases.push(m);
  cases.push({ ...manifest(), secret: 'synthetic-private-content' });
  m = manifest(); m.completedAt = '2026-11-06T08:00:00Z'; cases.push(m);
  m = manifest(); m.expiresAt = m.completedAt; cases.push(m);
  m = manifest(); m.artifacts[0].bytes = 0; cases.push(m);
  for (const bad of cases) assert.throws(() => parseRecoveryManifest(bad), /^Error: Invalid recovery manifest$/);
});

test('project, environment, expired copies and future timestamps cannot pass', async () => {
  await fixture(async directory => {
    await assert.rejects(verifyRecoveryBundle(manifest(), directory, { ...scope, environment: 'production' }, now), /scope mismatch/);
    await assert.rejects(verifyRecoveryBundle(manifest(), directory, { ...scope, projectRef: 'b'.repeat(20) }, now), /scope mismatch/);
    await assert.rejects(verifyRecoveryBundle(manifest(), directory, scope, new Date('2027-01-01Z')), /expired/);
    await assert.rejects(verifyRecoveryBundle(manifest(), directory, scope, new Date('2026-11-05Z')), /clock/);
    await assert.rejects(verifyRecoveryBundle(manifest(), directory, scope, new Date('invalid')), /clock/);
  });
});

test('manifest binding ignores artifact ordering but changes with artifact identity or scope', () => {
  const m = manifest(), reordered = manifest(); reordered.artifacts.reverse();
  assert.equal(recoveryManifestDigest(m), recoveryManifestDigest(reordered));
  for (const field of ['scope', 'artifact', 'backupId', 'key']) {
    const altered = manifest();
    if (field === 'scope') altered.scope = { ...scope, environment: 'production' };
    if (field === 'artifact') altered.artifacts[0].sha256 = 'e'.repeat(64);
    if (field === 'backupId') altered.backupId = 'e31d310a-630d-4c0a-b589-81a105fd2d76';
    if (field === 'key') altered.recipientFingerprint = 'f'.repeat(64);
    assert.notEqual(recoveryManifestDigest(m), recoveryManifestDigest(altered));
  }
});

test('valid drill evidence remains separate from production cutover authorization', () => {
  const result = assessRestoreEvidence(manifest(), drill(), options());
  assert.equal(result.restoreEvidenceAccepted, true);
  assert.equal(result.productionCutoverAuthorized, false);
  assert.deepEqual(result.blockers, []);
});

test('an uploaded bundle or a malformed receipt cannot stand in for a restore drill', () => {
  for (const raw of [null, {}, { uploaded: true }, { ...drill(), extra: 'unknown' }]) {
    assert.deepEqual(assessRestoreEvidence(manifest(), raw, options()).blockers, ['restore_evidence_missing_or_invalid']);
  }
});

test('every restore check is required, including message dedup, deletion replay and file contents', () => {
  for (const check of RESTORE_CHECKS) {
    const d = drill(); d.checks[check] = false;
    assert.deepEqual(assessRestoreEvidence(manifest(), d, options()).blockers, [`restore_check_failed:${check}`]);
  }
});

test('unsafe targets, old app versions and receipts for another backup are blocked', () => {
  const mutations: [string, (d: RestoreDrillEvidence) => void][] = [
    ['restore_target_is_source', d => { d.targetProjectRef = scope.projectRef; }],
    ['restore_not_isolated', d => { d.outboundNetworkBlocked = false; }],
    ['restore_not_isolated', d => { d.schedulersDisabled = false; }],
    ['restore_evidence_wrong_bundle', d => { d.manifestSha256 = 'f'.repeat(64); }],
    ['restore_evidence_wrong_source', d => { d.source = { ...scope, environment: 'production' }; }],
    ['restore_evidence_wrong_application', d => { d.testedAppCommit = 'f'.repeat(40); }],
    ['restore_evidence_invalid_time', d => { d.startedAt = '2026-11-05T10:00:00Z'; d.finishedAt = '2026-11-05T10:01:00Z'; }],
    ['restore_evidence_invalid_time', d => { d.finishedAt = '2026-11-06T09:00:00Z'; }],
  ];
  for (const [blocker, mutate] of mutations) {
    const d = drill(); mutate(d);
    assert.ok(assessRestoreEvidence(manifest(), d, options()).blockers.includes(blocker));
  }
});

test('age and restore duration policies have exact boundaries and reject invalid policy', () => {
  assert.equal(assessRestoreEvidence(manifest(), drill(), { ...options(), maxSnapshotAgeHours: 3 }).restoreEvidenceAccepted, true);
  assert.ok(assessRestoreEvidence(manifest(), drill(), { ...options(), maxSnapshotAgeHours: 2.99 }).blockers.includes('snapshot_too_old'));
  assert.ok(assessRestoreEvidence(manifest(), drill(), { ...options(), maxRestoreMinutes: 19 }).blockers.includes('restore_time_exceeded'));
  assert.ok(assessRestoreEvidence(manifest(), drill(), { ...options(), expectedAppCommit: 'f'.repeat(40) }).blockers.includes('application_version_mismatch'));
  for (const bad of [0, -1, NaN, Infinity]) assert.throws(() => assessRestoreEvidence(manifest(), drill(), { ...options(), maxSnapshotAgeHours: bad }), /policy/);
});

test('CLI reports integrity alone, blocks missing evidence, and never echoes sensitive input', async () => {
  await fixture(async directory => {
    const m = manifest();
    m.snapshotAt = new Date(Date.now() - 3_600_000).toISOString();
    m.completedAt = new Date(Date.now() - 1_800_000).toISOString();
    m.expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const path = join(directory, 'manifest.json');
    await writeFile(path, JSON.stringify(m));
    const args = ['scripts/verify-recovery-bundle.mts', '--manifest', path, '--directory', directory,
      '--project', scope.projectRef, '--environment', scope.environment];
    const run = (extra: string[] = []) => spawnSync(process.execPath, [...args, ...extra], { encoding: 'utf8' });
    const good = run(); assert.equal(good.status, 0, good.stderr);
    const report = JSON.parse(good.stdout);
    assert.equal(report.restore, null); assert.equal(report.productionCutoverAuthorized, false);
    const receipt = join(directory, 'drill.json'); await writeFile(receipt, '{}');
    const blocked = run(['--drill', receipt, '--commit', commit, '--max-age-hours', '26', '--max-restore-minutes', '120']);
    assert.equal(blocked.status, 2);
    await writeFile(path, JSON.stringify({ ...m, secret: 'do-not-echo-this-value' }));
    const failed = run(); assert.equal(failed.status, 1);
    assert.ok(!`${failed.stdout}${failed.stderr}`.includes('do-not-echo-this-value'));
    assert.ok(!failed.stderr.includes(directory));
    assert.ok((await readFile(join(directory, 'database.age'))).equals(content('database')));
    await writeFile(path, ' '.repeat(128 * 1024 + 1));
    assert.equal(run().status, 1, 'oversized evidence is refused');
    await rm(path);
    await symlink(receipt, path);
    assert.equal(run().status, 1, 'symlinked evidence is refused');
  });
});
