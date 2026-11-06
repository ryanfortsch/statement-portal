/** Read-only local preflight; never creates an export, uploads, or restores a DB. */
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { assessRestoreEvidence, recoveryManifestDigest, verifyRecoveryBundle } from '../src/lib/recovery-bundle.ts';
import { verifyRecoverySignature } from '../src/lib/recovery-export.ts';

async function boundedText(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const limit = 128 * 1024;
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size > limit) throw new Error('Invalid evidence file');
    // Bound the actual read too, so a growing file cannot bypass the stat check.
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > limit) throw new Error('Evidence file too large');
    return buffer.subarray(0, length).toString('utf8');
  } finally { await file.close(); }
}
const boundedJson = async (path: string) => JSON.parse(await boundedText(path)) as unknown;

try {
  const { values: v } = parseArgs({ options: {
    manifest: { type: 'string' }, directory: { type: 'string' }, project: { type: 'string' },
    environment: { type: 'string' }, drill: { type: 'string' }, commit: { type: 'string' },
    'max-age-hours': { type: 'string' }, 'max-restore-minutes': { type: 'string' },
    'signed-manifest': { type: 'string' }, 'trusted-signing-key': { type: 'string' },
    help: { type: 'boolean' },
  }, strict: true, allowPositionals: false });
  if (v.help) {
    console.log('Local integrity check: --manifest PATH --directory DIR --project REF --environment staging|production');
    console.log('To also check restore evidence: --drill PATH --commit SHA --max-age-hours NUMBER --max-restore-minutes NUMBER');
    console.log('Integrity alone does not prove decryption, completeness, or successful database restore.');
    console.log('For authenticated manifests replace --manifest with --signed-manifest PATH --trusted-signing-key PUBLIC_PEM_PATH.');
  } else {
    if ((!v.manifest && !v['signed-manifest']) || (v.manifest && v['signed-manifest']) ||
        Boolean(v['signed-manifest']) !== Boolean(v['trusted-signing-key']) ||
        !v.directory || !v.project || !['staging', 'production'].includes(v.environment ?? '')) throw new Error('Missing required options');
    const drillOptions = [v.drill, v.commit, v['max-age-hours'], v['max-restore-minutes']];
    if (drillOptions.some(Boolean) && !drillOptions.every(Boolean)) throw new Error('Incomplete drill options');
    const expected = { projectRef: v.project, environment: v.environment as 'staging' | 'production' };
    const now = new Date();
    let manifest: unknown;
    if (v['signed-manifest']) {
      const raw = await boundedJson(v['signed-manifest']);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join(',') !== 'manifest,signature') throw new Error();
      const envelope = raw as { manifest: unknown; signature: unknown };
      verifyRecoverySignature('manifest', recoveryManifestDigest(envelope.manifest), envelope.signature, await boundedText(v['trusted-signing-key']!));
      manifest = envelope.manifest;
    } else manifest = await boundedJson(v.manifest!);
    const integrity = await verifyRecoveryBundle(manifest, v.directory, expected, now);
    const restore = v.drill ? assessRestoreEvidence(manifest, await boundedJson(v.drill), {
      expected, now, expectedAppCommit: v.commit!, maxSnapshotAgeHours: Number(v['max-age-hours']),
      maxRestoreMinutes: Number(v['max-restore-minutes']),
    }) : null;
    console.log(JSON.stringify({ integrity, manifestSignatureVerified: Boolean(v['signed-manifest']), restore, productionCutoverAuthorized: false }, null, 2));
    if (restore && !restore.restoreEvidenceAccepted) process.exitCode = 2;
  }
} catch {
  // Never echo JSON contents, filesystem paths, argument values, or native errors.
  console.error('Recovery verification failed. Check required options, manifest, and encrypted artifacts.');
  process.exitCode = 1;
}
