import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createEncryptedRecoveryBundle, readRecoveryJson, signRecoveryDigest, verifyRecoverySignature, writeRecoveryJson } from '../recovery-export.ts';
import { RecoveryDrive, uploadRecoveryBundle, recoveryReceiptDigest } from '../recovery-drive.ts';
import { createRecoveryTokenProvider } from '../recovery-google-auth.ts';
import { recoveryManifestDigest } from '../recovery-bundle.ts';

const keys = generateKeyPairSync('ed25519');
const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const scope = { projectRef: 'a'.repeat(20), environment: 'staging' as const };
const driveId = 'synthetic_drive', folderId = 'synthetic_folder', digest = 'b'.repeat(64);
const age = process.env.RECOVERY_TEST_AGE, keygen = process.env.RECOVERY_TEST_AGE_KEYGEN;
const ageOptions = { skip: !age || !keygen ? 'Set RECOVERY_TEST_AGE and RECOVERY_TEST_AGE_KEYGEN for the real encryption drill' : false, timeout: 30_000 };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

type Stored = { id: string; name: string; parents: string[]; appProperties: Record<string, string>; data: Buffer };
class FakeDrive {
  files = new Map<string, Stored>();
  sessions = new Map<string, { metadata: Omit<Stored, 'data'>; data: Buffer; size: number }>();
  calls: { url: string; method: string; range: string | null; size: number }[] = [];
  creates = 0; generated = 0; interruptions = 0;
  mode = ''; corruptName = ''; redirect = ''; statusQueries = 0; throttles = 0;
  fetch: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input)), method = init.method ?? 'GET', headers = new Headers(init.headers);
    assert.equal(init.redirect, 'manual');
    assert.equal(headers.get('Authorization'), 'Bearer synthetic-token');
    assert.equal(url.origin, 'https://www.googleapis.com');
    const body = init.body ? Buffer.from(init.body as Uint8Array) : Buffer.alloc(0);
    this.calls.push({ url: url.toString(), method, range: headers.get('content-range'), size: body.length });
    if (this.mode === 'rate-limit-once' && this.throttles++ === 0) return json({}, 429);
    if (url.pathname.endsWith('/generateIds')) {
      this.generated++;
      return json({ ids: Array.from({ length: 5 }, (_, i) => `synthetic_file_${this.generated}_${i}`) });
    }
    if (url.pathname.endsWith('/' + folderId)) return json({ id: folderId, driveId, mimeType: 'application/vnd.google-apps.folder', trashed: false, capabilities: { canAddChildren: this.mode !== 'read-only' } });
    if (method === 'GET') {
      const file = this.files.get(url.pathname.split('/').at(-1)!);
      if (!file) return json({}, 404);
      if (url.searchParams.get('alt') === 'media') {
        const bytes = Buffer.from(file.data);
        if (file.name === this.corruptName) bytes[bytes.length - 1] ^= 1;
        return new Response(bytes);
      }
      return json({ id: file.id, name: file.name, parents: file.parents, driveId: this.mode === 'wrong-drive' ? 'different_drive' : driveId,
        appProperties: file.appProperties, trashed: false, size: String(file.data.length) });
    }
    if (method === 'POST') {
      const metadata = JSON.parse(body.toString());
      if (this.files.has(metadata.id)) return json({}, 409);
      const sessionId = String(this.sessions.size + 1);
      this.sessions.set(sessionId, { metadata, data: Buffer.alloc(0), size: Number(headers.get('x-upload-content-length')) });
      return new Response(null, { status: 200, headers: { location: this.redirect || `https://www.googleapis.com/upload/drive/v3/files?upload_id=${sessionId}` } });
    }
    const sessionId = url.searchParams.get('upload_id')!, session = this.sessions.get(sessionId);
    if (!session) return json({}, 404);
    const range = headers.get('content-range')!;
    if (range.startsWith('bytes */')) {
      this.statusQueries++;
      if (session.data.length === session.size) return json({}, 200);
      return new Response(null, { status: 308, headers: session.data.length ? { range: `bytes=0-${session.data.length - 1}` } : {} });
    }
    const match = range.match(/^bytes (\d+)-(\d+)\/(\d+)$/)!;
    assert.ok(match);
    assert.equal(Number(match[1]), session.data.length);
    assert.equal(body.length, Number(match[2]) - Number(match[1]) + 1);
    assert.equal(body.length, Number(headers.get('content-length')));
    if (this.mode === 'expire-once' && this.interruptions++ === 0) { this.sessions.delete(sessionId); return json({}, 404); }
    if (this.mode === 'stall') return new Response(null, { status: 308 });
    if (this.mode === 'bad-range') return new Response(null, { status: 308, headers: { range: 'bytes=0-99999999999' } });
    if (this.mode === 'interrupt-partial' && this.interruptions++ === 0) {
      session.data = Buffer.concat([session.data, body.subarray(0, Math.floor(body.length / 2))]);
      throw new Error('synthetic secret in upstream exception');
    }
    session.data = Buffer.concat([session.data, body]);
    if (session.data.length === session.size) {
      this.creates++;
      this.files.set(session.metadata.id, { ...session.metadata, data: session.data });
      if (this.mode === 'lose-final' && this.interruptions++ === 0) throw new Error('synthetic secret');
      return json({}, 201);
    }
    return new Response(null, { status: 308, headers: { range: `bytes=0-${session.data.length - 1}` } });
  };
}
function transport(fake: FakeDrive) {
  return { driveId, folderId, getAccessToken: async () => 'synthetic-token', signal: AbortSignal.timeout(20_000), fetch: fake.fetch, sleep: async () => {} };
}
async function fixture(t: { after: (fn: () => Promise<unknown>) => void }, size = 2_500_000) {
  const directory = await mkdtemp(join(tmpdir(), 'helm-recovery-worker-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.alloc(size, 42), name = 'database.age' as const, fileId = 'synthetic_file_fixture';
  await writeFile(join(directory, name), bytes, { mode: 0o600 });
  return { directory, bytes, file: { name, id: fileId, bytes: size, sha256: sha256(bytes) } };
}
async function bundle(t: { after: (fn: () => Promise<unknown>) => void }, fail?: string) {
  const root = await mkdtemp(join(tmpdir(), 'helm-recovery-age-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const identity = join(root, 'synthetic-identity.txt');
  execFileSync(keygen!, ['-o', identity], { stdio: 'ignore' });
  const recipient = execFileSync(keygen!, ['-y', identity], { encoding: 'utf8' }).trim();
  const backupId = randomUUID(), content = Buffer.from('Synthetic restore fixture\n'.repeat(100_000));
  const source = (component: string) => ({
    open: () => component === fail ? Readable.from((async function* () { yield content.subarray(0, 1024); throw new Error('secret source failure'); })()) : Readable.from([content]),
    assertComplete: async () => { if (fail === 'inventory') throw new Error('secret missing object'); },
  });
  const sources = { database: source('database'), storage: source('storage'), configuration: source('configuration') };
  const options = { metadata: { backupId, scope, snapshotAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(), appCommit: 'c'.repeat(40) },
    parentDirectory: root, ageExecutable: age!, recipient, sources, signingPrivateKey: privateKey, trustedSigningPublicKey: publicKey,
    maxArtifactBytes: 10_000_000, timeoutMs: 15_000 };
  return { root, identity, content, options, directory: join(root, backupId) };
}

test('signed evidence rejects tampering, wrong keys, wrong purpose, and extra fields', () => {
  const signature = signRecoveryDigest('manifest', digest, privateKey, publicKey);
  verifyRecoverySignature('manifest', digest, signature, publicKey);
  assert.throws(() => verifyRecoverySignature('manifest', 'a'.repeat(64), signature, publicKey));
  assert.throws(() => verifyRecoverySignature('receipt', digest, signature, publicKey));
  assert.throws(() => verifyRecoverySignature('manifest', digest, { ...signature, private_key: 'secret' }, publicKey));
  const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
  assert.throws(() => verifyRecoverySignature('manifest', digest, signature, other));
  assert.throws(() => signRecoveryDigest('manifest', digest, privateKey, other));
});
test('dedicated auth rejects mismatched identity and invalid credentials without exposing secrets', () => {
  for (const input of ['secret', '{}', JSON.stringify({ type: 'authorized_user', private_key: 'secret' }),
    JSON.stringify({ type: 'service_account', client_email: 'backup@test-project.iam.gserviceaccount.com', private_key: 'secret' })]) {
    assert.throws(() => createRecoveryTokenProvider(input, 'other@test-project.iam.gserviceaccount.com'), { message: 'Invalid dedicated recovery identity' });
  }
});
test('local evidence is atomically published, private, and never overwritten', async t => {
  const { directory } = await fixture(t, 100);
  await writeRecoveryJson(directory, 'upload.journal.json', { version: 1 });
  assert.deepEqual(await readRecoveryJson(join(directory, 'upload.journal.json')), { version: 1 });
  assert.equal((await stat(join(directory, 'upload.journal.json'))).mode & 0o777, 0o600);
  await assert.rejects(writeRecoveryJson(directory, 'upload.journal.json', { version: 2 }));
  await assert.rejects(writeRecoveryJson(directory, '../evil.json', {}));
});
for (const mode of ['', 'interrupt-partial', 'lose-final', 'expire-once', 'rate-limit-once']) {
  test(`Drive upload handles ${mode || 'multiple chunks'} and verifies downloaded bytes`, async t => {
    const { directory, file, bytes } = await fixture(t);
    const fake = new FakeDrive(); fake.mode = mode;
    const drive = new RecoveryDrive(transport(fake));
    await drive.checkDestination(); await drive.upload(directory, file, digest);
    assert.deepEqual(fake.files.get(file.id)!.data, bytes);
    assert.equal(fake.creates, 1);
    assert.ok(fake.calls.filter(c => c.method === 'PUT').every(c => c.size <= 1024 * 1024));
    if (mode.startsWith('interrupt') || mode === 'lose-final') assert.ok(fake.statusQueries > 0);
    const before = fake.calls.filter(c => c.method === 'POST').length;
    await drive.upload(directory, file, digest);
    assert.equal(fake.calls.filter(c => c.method === 'POST').length, before);
  });
}
for (const mode of ['stall', 'bad-range', 'wrong-drive']) {
  test(`Drive fails closed on ${mode}`, async t => {
    const { directory, file } = await fixture(t);
    const fake = new FakeDrive(); fake.mode = mode;
    await assert.rejects(new RecoveryDrive(transport(fake)).upload(directory, file, digest));
    assert.ok(fake.calls.length < 80);
  });
}
test('readback catches corruption even with matching uploaded metadata', async t => {
  const { directory, file } = await fixture(t);
  const fake = new FakeDrive(); fake.corruptName = file.name;
  await assert.rejects(new RecoveryDrive(transport(fake)).upload(directory, file, digest), /readback failed/);
});
test('foreign upload session cannot receive a token or ciphertext', async t => {
  const { directory, file } = await fixture(t);
  const fake = new FakeDrive(); fake.redirect = 'https://example.invalid/collect?upload_id=secret';
  await assert.rejects(new RecoveryDrive(transport(fake)).upload(directory, file, digest), /Invalid recovery upload session/);
  assert.equal(fake.calls.filter(c => c.method === 'PUT').length, 0);
});
test('cancelled and read-only destinations fail without uploading', async t => {
  const { directory, file } = await fixture(t);
  const fake = new FakeDrive(); fake.mode = 'read-only';
  await assert.rejects(new RecoveryDrive(transport(fake)).checkDestination());
  await assert.rejects(new RecoveryDrive({ ...transport(fake), signal: AbortSignal.abort() }).upload(directory, file, digest));
});

test('real age roundtrip, signed upload, interrupted restart, and receipt verification', ageOptions, async t => {
  const f = await bundle(t);
  const result = await createEncryptedRecoveryBundle(f.options);
  const publicFile = join(f.root, 'trusted-public.pem'); await writeFile(publicFile, publicKey);
  const cliArgs = ['scripts/verify-recovery-bundle.mts', '--signed-manifest', join(result.directory, 'manifest.signed.json'),
    '--trusted-signing-key', publicFile, '--directory', result.directory, '--project', scope.projectRef, '--environment', 'staging'];
  const cli = spawnSync(process.execPath, cliArgs, { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).manifestSignatureVerified, true);
  await writeFile(publicFile, generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }));
  assert.equal(spawnSync(process.execPath, cliArgs, { encoding: 'utf8' }).status, 1);
  for (const artifact of result.manifest.artifacts) {
    const encrypted = await readFile(join(result.directory, artifact.filename));
    assert.ok(!encrypted.includes(f.content.subarray(0, 100)));
    const decrypted = execFileSync(age!, ['--decrypt', '-i', f.identity, join(result.directory, artifact.filename)], { maxBuffer: 4_000_000 });
    assert.deepEqual(decrypted, f.content);
    assert.equal((await stat(join(result.directory, artifact.filename))).mode & 0o777, 0o600);
  }
  const fake = new FakeDrive(); fake.corruptName = 'storage.age';
  const options = { ...transport(fake), directory: result.directory, expectedScope: scope, trustedSigningPublicKey: publicKey, signingPrivateKey: privateKey };
  await assert.rejects(uploadRecoveryBundle(options));
  assert.ok(!(await readdir(result.directory)).includes('receipt.signed.json'));
  assert.ok(![...fake.files.values()].some(f => f.name === 'manifest.signed.json'));
  const journal = await readRecoveryJson(join(result.directory, 'upload.journal.json'));
  fake.corruptName = '';
  const report = await uploadRecoveryBundle(options);
  assert.equal(report.downloadIntegrityVerified, true);
  assert.equal(report.databaseRestoreVerified, false);
  assert.equal(report.productionCutoverAuthorized, false);
  assert.equal(fake.generated, 1);
  assert.equal(fake.creates, 5);
  assert.deepEqual(await readRecoveryJson(join(result.directory, 'upload.journal.json')), journal);
  const envelope = await readRecoveryJson(join(result.directory, 'receipt.signed.json')) as { receipt: unknown; signature: unknown };
  verifyRecoverySignature('receipt', recoveryReceiptDigest(envelope.receipt), envelope.signature, publicKey);
  await uploadRecoveryBundle(options);
  assert.equal(fake.creates, 5);
  assert.equal(report.manifestSha256, recoveryManifestDigest(result.manifest));
  // A stale lock, wrong environment, altered journal, or changed ciphertext must
  // fail before an extra file is created. An operator must resolve stale locks.
  await writeFile(join(result.directory, '.upload.lock'), '');
  await assert.rejects(uploadRecoveryBundle(options));
  await rm(join(result.directory, '.upload.lock'));
  await assert.rejects(uploadRecoveryBundle({ ...options, expectedScope: { ...scope, environment: 'production' } }));
  const journalPath = join(result.directory, 'upload.journal.json');
  const journalBytes = await readFile(journalPath);
  await writeFile(journalPath, journalBytes.toString().replace(folderId, 'wrong_folder'));
  await assert.rejects(uploadRecoveryBundle(options));
  await writeFile(journalPath, journalBytes);
  const cipherPath = join(result.directory, 'database.age'), cipher = await readFile(cipherPath);
  cipher[cipher.length - 1] ^= 1;
  await writeFile(cipherPath, cipher);
  await assert.rejects(uploadRecoveryBundle(options));
  assert.equal(fake.creates, 5);
});
for (const failure of ['database', 'inventory']) {
  test(`real age export refuses completion after ${failure} failure`, ageOptions, async t => {
    const f = await bundle(t, failure);
    await assert.rejects(createEncryptedRecoveryBundle(f.options), { message: 'Recovery export failed; do not treat this run as completed' });
    assert.ok(!(await readdir(f.directory)).includes('manifest.signed.json'));
  });
}
test('real age artifact quota fails closed; invalid recipient never opens a source', ageOptions, async t => {
  const f = await bundle(t); let opened = false;
  await assert.rejects(createEncryptedRecoveryBundle({ ...f.options, recipient: 'ssh-rsa unsafe', sources: {
    ...f.options.sources, database: { open: () => { opened = true; return Readable.from([]); }, assertComplete: async () => {} },
  } }));
  assert.equal(opened, false);
  await assert.rejects(createEncryptedRecoveryBundle({ ...f.options, maxArtifactBytes: 1024 }));
  assert.ok(!(await readdir(f.directory)).includes('manifest.signed.json'));
});
test('real age timeout stops a stalled source and never publishes completion', ageOptions, async t => {
  const f = await bundle(t);
  await assert.rejects(createEncryptedRecoveryBundle({ ...f.options, timeoutMs: 100, sources: {
    ...f.options.sources, database: { open: () => new Readable({ read() {} }), assertComplete: async () => {} },
  } }));
  assert.ok(!(await readdir(f.directory)).includes('manifest.signed.json'));
});
test('missing encryption executable and cancelled inventory check fail closed', ageOptions, async t => {
  const f = await bundle(t);
  await assert.rejects(createEncryptedRecoveryBundle({ ...f.options, ageExecutable: '/does-not-exist/age' }));
  assert.ok(!(await readdir(f.directory)).includes('manifest.signed.json'));
  const other = await bundle(t);
  // The wrapper's deadline still fires if a misbehaving adapter never resolves.
  await assert.rejects(createEncryptedRecoveryBundle({ ...other.options, timeoutMs: 100, sources: {
    ...other.options.sources, database: { ...other.options.sources.database, assertComplete: () => new Promise<void>(() => {}) },
  } }));
  assert.ok(!(await readdir(other.directory)).includes('manifest.signed.json'));
});
