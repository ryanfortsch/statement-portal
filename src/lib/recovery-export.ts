/** Offline packaging. Sources own snapshot consistency; this module never queries a live DB. */
import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { mkdir, open, link, unlink, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { RECOVERY_COMPONENTS, parseRecoveryManifest, recoveryManifestDigest, verifyRecoveryBundle,
  type RecoveryManifest } from './recovery-bundle.ts';

const DOMAIN = 'helm-recovery-signature-v1\n';
const signatureSchema = z.object({
  version: z.literal(1), algorithm: z.literal('Ed25519'),
  keyFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
}).strict();
export type RecoverySignature = z.infer<typeof signatureSchema>;

/** Reject promptly on deadline; source adapters must also stop their underlying work. */
export function withRecoveryAbort<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error('Recovery operation cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    task.then(value => { signal.removeEventListener('abort', abort); resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); });
    if (signal.aborted) { signal.removeEventListener('abort', abort); abort(); }
  });
}

function publicKey(pem: string | KeyObject) {
  if (typeof pem === 'string' && !pem.startsWith('-----BEGIN PUBLIC KEY-----')) throw new Error('Invalid recovery signing key');
  const key = typeof pem === 'string' ? createPublicKey(pem) : pem;
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') throw new Error('Invalid recovery signing key');
  return key;
}
function fingerprint(key: KeyObject) {
  return createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex');
}
function signedBytes(purpose: 'manifest' | 'receipt', digest: string) {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid recovery digest');
  return Buffer.from(`${DOMAIN}${purpose}\n${digest}`, 'utf8');
}
export function signRecoveryDigest(purpose: 'manifest' | 'receipt', digest: string, privatePem: string, trustedPublicPem: string): RecoverySignature {
  try {
    const privateKey = createPrivateKey(privatePem), trusted = publicKey(trustedPublicPem);
    if (privateKey.asymmetricKeyType !== 'ed25519' || fingerprint(createPublicKey(privateKey)) !== fingerprint(trusted)) throw new Error();
    return { version: 1, algorithm: 'Ed25519', keyFingerprint: fingerprint(trusted),
      signature: sign(null, signedBytes(purpose, digest), privateKey).toString('base64') };
  } catch { throw new Error('Recovery signing failed'); }
}
export function verifyRecoverySignature(purpose: 'manifest' | 'receipt', digest: string, raw: unknown, trustedPublicPem: string) {
  try {
    const s = signatureSchema.parse(raw), trusted = publicKey(trustedPublicPem);
    if (s.keyFingerprint !== fingerprint(trusted) || !verify(null, signedBytes(purpose, digest), trusted, Buffer.from(s.signature, 'base64'))) throw new Error();
  } catch { throw new Error('Recovery signature verification failed'); }
}

/** Private, quiescent directory required. Does not overwrite a completed file. */
export async function writeRecoveryJson(directory: string, filename: string, value: unknown) {
  if (!/^[a-z.-]+\.json$/.test(filename)) throw new Error('Invalid recovery filename');
  const pending = join(directory, `${filename}.pending`);
  const file = await open(pending, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value) + '\n'); await file.sync(); }
  finally { await file.close(); }
  // Atomic publication without overwriting an existing completion marker.
  try { await link(pending, join(directory, filename)); }
  catch { await unlink(pending); throw new Error('Recovery evidence already exists'); }
  await unlink(pending);
  const parent = await open(directory, 'r');
  try { await parent.sync(); } finally { await parent.close(); }
}

export async function readRecoveryJson(path: string): Promise<unknown> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const limit = 128 * 1024, stat = await file.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error();
    const bytes = Buffer.alloc(limit + 1); let length = 0;
    while (length < bytes.length) {
      const r = await file.read(bytes, length, bytes.length - length, length);
      if (!r.bytesRead) break;
      length += r.bytesRead;
    }
    if (length > limit) throw new Error();
    return JSON.parse(bytes.subarray(0, length).toString('utf8')) as unknown;
  } catch { throw new Error('Invalid recovery evidence file'); }
  finally { await file.close(); }
}

export type RecoverySource = {
  /** Must honor abort, report producer/process failure, and stream a restore-ready archive. */
  open: (signal: AbortSignal) => Readable;
  /** Called after EOF; reject if the source changed or the inventory/snapshot is incomplete. */
  assertComplete: (signal: AbortSignal) => Promise<void>;
};
type ExportOptions = {
  metadata: Pick<RecoveryManifest, 'backupId' | 'scope' | 'snapshotAt' | 'expiresAt' | 'appCommit'>;
  parentDirectory: string; ageExecutable: string; recipient: string;
  sources: Record<typeof RECOVERY_COMPONENTS[number], RecoverySource>;
  signingPrivateKey: string; trustedSigningPublicKey: string;
  maxArtifactBytes: number; timeoutMs: number; signal?: AbortSignal;
};

/** Only ciphertext touches disk. age is an administrator-installed, absolute executable. */
export async function createEncryptedRecoveryBundle(options: ExportOptions) {
  const o = options;
  if (!isAbsolute(o.ageExecutable) || !/^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(o.recipient) ||
      !Number.isSafeInteger(o.maxArtifactBytes) || o.maxArtifactBytes < 1024 ||
      !Number.isSafeInteger(o.timeoutMs) || o.timeoutMs < 1 || o.timeoutMs > 86_400_000) throw new Error('Invalid recovery export configuration');
  const template = parseRecoveryManifest({ ...o.metadata, version: 1, encryption: 'age-v1',
    completedAt: new Date().toISOString(), recipientFingerprint: createHash('sha256').update(o.recipient).digest('hex'),
    artifacts: RECOVERY_COMPONENTS.map(component => ({ component, filename: `${component}.age`, sha256: '0'.repeat(64), bytes: 1 })) });
  // Fail before opening source streams if key configuration is wrong.
  signRecoveryDigest('manifest', recoveryManifestDigest(template), o.signingPrivateKey, o.trustedSigningPublicKey);
  const directory = join(await realpath(o.parentDirectory), template.backupId);
  await mkdir(directory, { mode: 0o700 }); // never reuse another run's directory
  const signal = AbortSignal.any([AbortSignal.timeout(o.timeoutMs), ...(o.signal ? [o.signal] : [])]);
  const artifacts: RecoveryManifest['artifacts'] = [];
  try {
    for (const component of RECOVERY_COMPONENTS) {
      signal.throwIfAborted();
      const filename = `${component}.age` as RecoveryManifest['artifacts'][number]['filename'];
      const file = await open(join(directory, filename), 'wx', 0o600);
      const child = spawn(o.ageExecutable, ['--encrypt', '--recipient', o.recipient], {
        shell: false, stdio: ['pipe', 'pipe', 'pipe'], env: { LANG: 'C', PATH: '/usr/bin:/bin', NODE_ENV: 'production' },
      });
      // Diagnostics can echo source information. Drain them, never collect/log them.
      child.stderr.resume();
      const controller = new AbortController();
      const operationSignal = AbortSignal.any([signal, controller.signal]);
      const stop = () => { child.kill('SIGKILL'); };
      operationSignal.addEventListener('abort', stop, { once: true });
      const exited = new Promise<void>((resolve, reject) => {
        child.once('error', () => reject(new Error('Encryption process failed')));
        child.once('close', code => code === 0 ? resolve() : reject(new Error('Encryption process failed')));
      });
      // Install rejection handling before constructing a potentially throwing source.
      void exited.catch(() => controller.abort());
      let bytes = 0;
      const hash = createHash('sha256');
      const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > o.maxArtifactBytes) { callback(new Error('Encrypted artifact exceeds limit')); return; }
        hash.update(chunk); callback(null, chunk);
      } });
      try {
        const source = o.sources[component].open(operationSignal);
        // Keep descriptor ownership here. FileHandle.createWriteStream with
        // autoClose:false can leave pipeline waiting for a close it does not own.
        const output = new Writable({ write(chunk: Buffer, _encoding, callback) {
          (async () => {
            let offset = 0;
            while (offset < chunk.length) {
              const result = await file.write(chunk, offset, chunk.length - offset);
              if (!result.bytesWritten) throw new Error('Recovery artifact write failed');
              offset += result.bytesWritten;
            }
          })().then(() => callback(), () => callback(new Error('Recovery artifact write failed')));
        } });
        const tasks = [
          pipeline(source, child.stdin, { signal: operationSignal }),
          pipeline(child.stdout, meter, output, { signal: operationSignal }),
          exited,
        ].map(task => task.catch(error => { controller.abort(); throw error; }));
        const results = await Promise.allSettled(tasks);
        if (results.some(result => result.status === 'rejected')) throw new Error();
        await withRecoveryAbort(o.sources[component].assertComplete(operationSignal), operationSignal);
        signal.throwIfAborted();
        await file.sync();
        artifacts.push({ component, filename, bytes, sha256: hash.digest('hex') });
      } finally {
        controller.abort(); await exited.catch(() => {});
        operationSignal.removeEventListener('abort', stop); await file.close();
      }
    }
    const manifest = parseRecoveryManifest({ ...template, completedAt: new Date().toISOString(), artifacts });
    await verifyRecoveryBundle(manifest, directory, manifest.scope, new Date());
    const signature = signRecoveryDigest('manifest', recoveryManifestDigest(manifest), o.signingPrivateKey, o.trustedSigningPublicKey);
    // A single signed envelope is the commit marker, only published after every source completes.
    await writeRecoveryJson(directory, 'manifest.signed.json', { manifest, signature });
    return { directory, manifest, signature };
  } catch {
    // Retain only this run's ciphertext for investigation; never publish a completion marker.
    throw new Error('Recovery export failed; do not treat this run as completed');
  }
}
