/** Encrypted recovery transport. No deletes, permission changes, plaintext uploads, or restores. */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { parseRecoveryManifest, recoveryManifestDigest, verifyRecoveryBundle, type RecoveryScope } from './recovery-bundle.ts';
import { readRecoveryJson, writeRecoveryJson, verifyRecoverySignature, signRecoveryDigest, withRecoveryAbort } from './recovery-export.ts';

const ORIGIN = 'https://www.googleapis.com';
const API = `${ORIGIN}/drive/v3/files`;
const UPLOAD = `${ORIGIN}/upload/drive/v3/files`;
const CHUNK = 1024 * 1024; // Drive requires multiples of 256 KiB, except the last chunk.
const id = z.string().regex(/^[A-Za-z0-9_-]{10,200}$/);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const names = ['database.age', 'storage.age', 'configuration.age', 'manifest.signed.json', 'receipt.signed.json'] as const;
const journalSchema = z.object({
  version: z.literal(1), manifestSha256: sha, driveId: id, folderId: id,
  files: z.array(z.object({ name: z.enum(names), id }).strict()).length(names.length),
}).strict();
const metadataSchema = z.object({
  id, name: z.string(), driveId: id, parents: z.array(id), trashed: z.boolean(),
  size: z.string().regex(/^\d+$/), appProperties: z.record(z.string(), z.string()),
});
const receiptSchema = z.object({
  version: z.literal(1), manifestSha256: sha, driveId: id, folderId: id,
  verifiedAt: z.string().datetime(),
  files: z.array(z.object({ name: z.enum(names), id, sha256: sha, bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict()).length(4),
  downloadIntegrityVerified: z.literal(true), databaseRestoreVerified: z.literal(false),
}).strict();
export type RecoveryReceipt = z.infer<typeof receiptSchema>;
export function recoveryReceiptDigest(raw: unknown) {
  const r = receiptSchema.safeParse(raw);
  if (!r.success || new Set(r.data.files.map(f => f.name)).size !== 4 || r.data.files.some(f => f.name === 'receipt.signed.json')) throw new Error('Invalid recovery receipt');
  return createHash('sha256').update(JSON.stringify({ ...r.data, files: [...r.data.files].sort((a, b) => a.name.localeCompare(b.name)) })).digest('hex');
}

type LocalArtifact = { name: typeof names[number]; id: string; bytes: number; sha256: string };
type DriveOptions = {
  driveId: string; folderId: string; getAccessToken: () => Promise<string>;
  signal: AbortSignal; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>;
};
export class RecoveryDrive {
  private options: DriveOptions;
  constructor(options: DriveOptions) {
    if (!id.safeParse(options.driveId).success || !id.safeParse(options.folderId).success) throw new Error('Invalid recovery destination');
    this.options = options;
  }
  private async pause(attempt: number) {
    this.options.signal.throwIfAborted();
    const ms = Math.min(1000 * 2 ** attempt, 16000) + Math.floor(Math.random() * 250);
    if (this.options.sleep) await this.options.sleep(ms);
    else await new Promise<void>((resolve, reject) => {
      const finish = () => { clearTimeout(timer); this.options.signal.removeEventListener('abort', abort); };
      const abort = () => { finish(); reject(new Error('Recovery transport cancelled')); };
      const timer = setTimeout(() => { finish(); resolve(); }, ms);
      this.options.signal.addEventListener('abort', abort, { once: true });
    });
    this.options.signal.throwIfAborted();
  }
  private async request(url: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
    const parsed = new URL(url);
    if (parsed.origin !== ORIGIN || parsed.username || parsed.password || parsed.hash ||
        ![API, UPLOAD].some(base => url === base || url.startsWith(base + '?') || url.startsWith(base + '/'))) throw new Error('Invalid recovery API destination');
    try {
      this.options.signal.throwIfAborted();
      const signal = AbortSignal.any([this.options.signal, AbortSignal.timeout(timeoutMs)]);
      const token = await withRecoveryAbort(this.options.getAccessToken(), signal);
      if (!token || /[\r\n]/.test(token)) throw new Error();
      return await (this.options.fetch ?? fetch)(url, { ...init, redirect: 'manual',
        signal,
        headers: { ...init.headers, Authorization: `Bearer ${token}` },
      });
    } catch { throw new Error('Recovery transport request failed'); }
  }
  private async json(response: Response): Promise<unknown> {
    if (!response.body) throw new Error('Invalid recovery API response');
    const chunks: Uint8Array[] = []; let size = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > 128 * 1024) throw new Error('Recovery API response exceeds limit');
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
    catch { throw new Error('Invalid recovery API response'); }
  }
  private async discard(r: Response) { await r.body?.cancel().catch(() => {}); }
  private async get(url: string, missingAllowed = false): Promise<unknown | null> {
    for (let attempt = 0; attempt < 4; attempt++) {
      let r: Response;
      try { r = await this.request(url); }
      catch { if (attempt === 3) throw new Error('Recovery API unavailable'); await this.pause(attempt); continue; }
      if (r.ok) return this.json(r);
      const status = r.status; await this.discard(r);
      if (missingAllowed && status === 404) return null;
      if (![403, 429].includes(status) && status < 500) break;
      if (attempt < 3) await this.pause(attempt);
    }
    throw new Error('Recovery API unavailable or access denied');
  }
  async checkDestination() {
    const raw = await this.get(`${API}/${this.options.folderId}?supportsAllDrives=true&fields=id,mimeType,driveId,trashed,capabilities(canAddChildren)`);
    const parsed = z.object({ id, driveId: id, mimeType: z.literal('application/vnd.google-apps.folder'), trashed: z.literal(false),
      capabilities: z.object({ canAddChildren: z.literal(true) }) }).safeParse(raw);
    if (!parsed.success || parsed.data.id !== this.options.folderId || parsed.data.driveId !== this.options.driveId) throw new Error('Recovery destination mismatch');
    // This is NOT an effective-membership audit. That must precede worker activation.
  }
  async generateIds() {
    const raw = await this.get(`${API}/generateIds?count=${names.length}&space=drive&type=files`);
    const parsed = z.object({ ids: z.array(id).length(names.length) }).safeParse(raw);
    if (!parsed.success || new Set(parsed.data.ids).size !== names.length) throw new Error('Invalid recovery file identities');
    return parsed.data.ids;
  }
  private async metadata(fileId: string) {
    return this.get(`${API}/${fileId}?supportsAllDrives=true&fields=id,name,driveId,parents,trashed,size,appProperties`, true);
  }
  private offset(r: Response, previous: number, sentUntil: number, total: number) {
    const range = r.headers.get('range');
    const match = range?.match(/^bytes=0-(\d+)$/);
    if (range && !match) throw new Error('Invalid recovery upload acknowledgement');
    const next = match ? Number(match[1]) + 1 : 0;
    if (!Number.isSafeInteger(next) || next < previous || next > sentUntil || next >= total) throw new Error('Invalid recovery upload acknowledgement');
    return next;
  }
  async verifyUploaded(file: LocalArtifact, manifestSha256: string) {
    const m = metadataSchema.safeParse(await this.metadata(file.id));
    if (!m.success || m.data.id !== file.id || m.data.name !== file.name || m.data.driveId !== this.options.driveId ||
        m.data.parents.length !== 1 || m.data.parents[0] !== this.options.folderId || m.data.trashed ||
        Number(m.data.size) !== file.bytes || m.data.appProperties.helmRecoveryManifest !== manifestSha256 ||
        m.data.appProperties.helmRecoverySha256 !== file.sha256) throw new Error('Recovery uploaded file identity mismatch');
    const response = await this.request(`${API}/${file.id}?alt=media&supportsAllDrives=true`, {}, 600_000);
    if (!response.ok || !response.body) { await this.discard(response); throw new Error('Recovery readback failed'); }
    const hash = createHash('sha256'); let bytes = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      bytes += chunk.length;
      if (bytes > file.bytes) throw new Error('Recovery readback failed');
      hash.update(chunk);
    }
    if (bytes !== file.bytes || hash.digest('hex') !== file.sha256) throw new Error('Recovery readback failed');
  }
  async upload(directory: string, file: LocalArtifact, manifestSha256: string) {
    if (!id.safeParse(file.id).success || !names.includes(file.name) || !sha.safeParse(manifestSha256).success ||
        !sha.safeParse(file.sha256).success || !Number.isSafeInteger(file.bytes) || file.bytes < 1) throw new Error('Invalid recovery upload');
    if (await this.metadata(file.id)) { await this.verifyUploaded(file, manifestSha256); return; }
    const handle = await open(join(directory, file.name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size !== file.bytes) throw new Error('Recovery local artifact changed');
      for (let sessionAttempt = 0; sessionAttempt < 4; sessionAttempt++) {
        let start: Response | undefined;
        try { start = await this.request(`${UPLOAD}?uploadType=resumable&supportsAllDrives=true`, { method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(file.bytes) },
          body: JSON.stringify({ id: file.id, name: file.name, parents: [this.options.folderId], mimeType: 'application/octet-stream',
            appProperties: { helmRecoveryManifest: manifestSha256, helmRecoverySha256: file.sha256 } }),
        }); } catch { /* Reconcile the persisted ID before another create attempt. */ }
        if (!start?.ok) {
          const status = start?.status;
          if (start) await this.discard(start);
          if (await this.metadata(file.id)) { await this.verifyUploaded(file, manifestSha256); return; }
          if (status && ![403, 409, 429].includes(status) && status < 500) throw new Error('Recovery upload rejected');
          await this.pause(sessionAttempt); continue;
        }
        const location = start.headers.get('location'); await this.discard(start);
        // Never forward the bearer token or encrypted data to a response-supplied foreign URL.
        if (!location || !location.startsWith(UPLOAD + '?') || new URL(location).origin !== ORIGIN) throw new Error('Invalid recovery upload session');
        let offset = 0, stalled = 0, finished = false;
        while (offset < file.bytes && stalled < 4) {
          const buffer = Buffer.alloc(Math.min(CHUNK, file.bytes - offset));
          let read = 0;
          while (read < buffer.length) {
            const result = await handle.read(buffer, read, buffer.length - read, offset + read);
            if (!result.bytesRead) throw new Error('Recovery local artifact changed');
            read += result.bytesRead;
          }
          let r: Response | undefined;
          try { r = await this.request(location, { method: 'PUT', headers: {
            'Content-Length': String(buffer.length), 'Content-Range': `bytes ${offset}-${offset + buffer.length - 1}/${file.bytes}`,
          }, body: buffer }); } catch { /* Ask the server what it received, do not guess. */ }
          if (!r || [403, 429].includes(r.status) || r.status >= 500) {
            if (r) await this.discard(r);
            await this.pause(stalled);
            try { r = await this.request(location, { method: 'PUT', headers: { 'Content-Length': '0', 'Content-Range': `bytes */${file.bytes}` } }); }
            catch { stalled++; continue; }
          }
          if (r.status === 200 || r.status === 201) { await this.discard(r); finished = true; break; }
          if (r.status === 404) { await this.discard(r); break; } // Expired session; same persisted file ID.
          if (r.status === 308) {
            const next = this.offset(r, offset, offset + buffer.length, file.bytes); await this.discard(r);
            stalled = next === offset ? stalled + 1 : 0; offset = next;
            if (stalled) await this.pause(stalled);
          } else { await this.discard(r); throw new Error('Recovery upload status unavailable'); }
        }
        if (finished || await this.metadata(file.id)) { await this.verifyUploaded(file, manifestSha256); return; }
        await this.pause(sessionAttempt);
      }
      throw new Error('Recovery upload retry limit exceeded');
    } finally { await handle.close(); }
  }
}

async function describeFile(directory: string, name: LocalArtifact['name'], fileId: string): Promise<LocalArtifact> {
  const handle = await open(join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat(); if (!stat.isFile()) throw new Error('Invalid recovery artifact');
    const hash = createHash('sha256'); let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) { hash.update(chunk); bytes += chunk.length; }
    const after = await handle.stat();
    if (bytes !== stat.size || stat.ctimeMs !== after.ctimeMs || stat.mtimeMs !== after.mtimeMs) throw new Error('Recovery artifact changed');
    return { name, id: fileId, bytes, sha256: hash.digest('hex') };
  } finally { await handle.close(); }
}

/** Explicit invocation only: no scheduler/deployment is enabled by importing this module. */
export async function uploadRecoveryBundle(options: DriveOptions & {
  directory: string; expectedScope: RecoveryScope; trustedSigningPublicKey: string; signingPrivateKey: string;
}) {
  const directory = await realpath(options.directory);
  const lock = await open(join(directory, '.upload.lock'), 'wx', 0o600);
  try {
    const envelope = z.object({ manifest: z.unknown(), signature: z.unknown() }).strict().parse(await readRecoveryJson(join(directory, 'manifest.signed.json')));
    const manifest = parseRecoveryManifest(envelope.manifest), digest = recoveryManifestDigest(manifest);
    verifyRecoverySignature('manifest', digest, envelope.signature, options.trustedSigningPublicKey);
    await verifyRecoveryBundle(manifest, directory, options.expectedScope, new Date());
    const drive = new RecoveryDrive(options); await drive.checkDestination();
    let rawJournal: unknown;
    try { rawJournal = await readRecoveryJson(join(directory, 'upload.journal.json')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const ids = await drive.generateIds();
      rawJournal = { version: 1, manifestSha256: digest, driveId: options.driveId, folderId: options.folderId,
        files: names.map((name, i) => ({ name, id: ids[i] })) };
      // Persist and fsync identities BEFORE any upload, including ambiguous retries.
      await writeRecoveryJson(directory, 'upload.journal.json', rawJournal);
    }
    const journal = journalSchema.parse(rawJournal);
    if (journal.manifestSha256 !== digest || journal.driveId !== options.driveId || journal.folderId !== options.folderId ||
        new Set(journal.files.map(f => f.name)).size !== names.length || new Set(journal.files.map(f => f.id)).size !== names.length) throw new Error('Recovery upload journal mismatch');
    const verified: LocalArtifact[] = [];
    for (const name of names.slice(0, 4)) {
      const file = await describeFile(directory, name, journal.files.find(f => f.name === name)!.id);
      const declared = manifest.artifacts.find(a => a.filename === name);
      if (declared && (declared.bytes !== file.bytes || declared.sha256 !== file.sha256)) throw new Error('Recovery artifact changed');
      if (name === 'manifest.signed.json' && file.sha256 !== createHash('sha256').update(JSON.stringify(envelope) + '\n').digest('hex')) throw new Error('Recovery signed manifest changed');
      await drive.upload(directory, file, digest); verified.push(file);
    }
    options.signal.throwIfAborted();
    // The upload may take hours. Recheck expiry and the local ciphertext before
    // issuing a completion receipt, not only at the start of the run.
    await verifyRecoveryBundle(manifest, directory, options.expectedScope, new Date());
    let receiptEnvelope: { receipt: unknown; signature: unknown };
    try {
      receiptEnvelope = z.object({ receipt: z.unknown(), signature: z.unknown() }).strict().parse(await readRecoveryJson(join(directory, 'receipt.signed.json')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const receipt: RecoveryReceipt = { version: 1, manifestSha256: digest, driveId: options.driveId, folderId: options.folderId,
        verifiedAt: new Date().toISOString(), files: verified, downloadIntegrityVerified: true, databaseRestoreVerified: false };
      receiptEnvelope = { receipt, signature: signRecoveryDigest('receipt', recoveryReceiptDigest(receipt), options.signingPrivateKey, options.trustedSigningPublicKey) };
      await writeRecoveryJson(directory, 'receipt.signed.json', receiptEnvelope);
    }
    verifyRecoverySignature('receipt', recoveryReceiptDigest(receiptEnvelope.receipt), receiptEnvelope.signature, options.trustedSigningPublicKey);
    const receipt = receiptSchema.parse(receiptEnvelope.receipt);
    if (receipt.manifestSha256 !== digest || receipt.folderId !== options.folderId || receipt.driveId !== options.driveId ||
        Date.parse(receipt.verifiedAt) < Date.parse(manifest.completedAt) || Date.parse(receipt.verifiedAt) > Date.now() ||
        verified.some(f => !receipt.files.some(r => r.id === f.id && r.name === f.name && r.sha256 === f.sha256 && r.bytes === f.bytes))) throw new Error('Recovery receipt mismatch');
    const receiptFile = await describeFile(directory, 'receipt.signed.json', journal.files.find(f => f.name === 'receipt.signed.json')!.id);
    if (receiptFile.sha256 !== createHash('sha256').update(JSON.stringify(receiptEnvelope) + '\n').digest('hex')) throw new Error('Recovery signed receipt changed');
    await drive.upload(directory, receiptFile, digest);
    return { manifestSha256: digest, downloadIntegrityVerified: true, databaseRestoreVerified: false, productionCutoverAuthorized: false };
  } catch { throw new Error('Recovery upload failed; no verified completion may be assumed'); }
  finally { await lock.close(); await unlink(join(directory, '.upload.lock')); }
}
