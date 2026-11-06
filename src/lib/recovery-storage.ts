/** Standard streaming tar; only the enclosing age stream may be written to disk. */
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import tar from 'tar-stream';
import { z } from 'zod';
import { withRecoveryAbort, type RecoverySource } from './recovery-export.ts';

const objectSchema = z.object({
  bucket: z.string().min(1).max(1024), key: z.string().min(1).max(4096),
  bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  version: z.string().min(1).max(1024), modifiedAt: z.iso.datetime(),
  access: z.enum(['private', 'public']),
}).strict();
export type RecoveryObject = z.infer<typeof objectSchema>;
export type RecoveryObjectStore = {
  id: string;
  /** Must enumerate ALL configured buckets, including empty buckets, without a prefix filter. */
  list: (cursor: string | undefined, signal: AbortSignal) => Promise<{
    objects: RecoveryObject[]; nextCursor?: string;
    /** Stable access/bucket configuration, repeated on each page. Must include empty buckets. */
    scope: string;
  }>;
  /** Conditional/version-checked read; caller also measures actual bytes. */
  read: (object: RecoveryObject, signal: AbortSignal) => Promise<{
    body: Readable; version: string; bytes: number; modifiedAt: string; contentType: string;
  }>;
};
type Listed = RecoveryObject & { store: string; archivePath: string };
type Inventory = { scopes: Record<string, string>; objects: Listed[] };
const digest = (s: string) => createHash('sha256').update(s).digest('hex');

export function createStorageRecoverySource(options: {
  stores: RecoveryObjectStore[]; maxObjects: number; maxObjectBytes: number;
  maxTotalBytes: number; maxInventoryBytes: number; timeoutMs: number;
}): RecoverySource {
  const o = options;
  if (!o.stores.length || o.stores.length > 20 || o.stores.some(s => !/^[a-z][a-z0-9-]{0,63}$/.test(s.id)) ||
      new Set(o.stores.map(s => s.id)).size !== o.stores.length ||
      [o.maxObjects, o.maxObjectBytes, o.maxTotalBytes, o.maxInventoryBytes, o.timeoutMs].some(v => !Number.isSafeInteger(v) || v < 1) ||
      o.maxObjects > 1_000_000 || o.maxInventoryBytes > 64 * 1024 * 1024 || o.timeoutMs > 86_400_000) {
    throw new Error('Invalid recovery storage configuration');
  }
  async function inventory(signal: AbortSignal): Promise<Inventory> {
    const scopes: Record<string, string> = {}, objects: Listed[] = [], identities = new Set<string>();
    let totalBytes = 0, metadataBytes = 0;
    for (const store of o.stores) {
      const cursors = new Set<string>(); let cursor: string | undefined, pages = 0;
      do {
        signal.throwIfAborted();
        if (++pages > o.maxObjects + 100) throw new Error();
        const page = await withRecoveryAbort(store.list(cursor, signal), signal);
        if (typeof page.scope !== 'string' || !page.scope.length || page.scope.length > 64 * 1024 || !Array.isArray(page.objects)) throw new Error();
        if (scopes[store.id] !== undefined && scopes[store.id] !== page.scope) throw new Error();
        if (scopes[store.id] === undefined) { scopes[store.id] = page.scope; metadataBytes += Buffer.byteLength(page.scope); }
        if (objects.length + page.objects.length > o.maxObjects) throw new Error();
        for (const raw of page.objects) {
          const obj = objectSchema.parse(raw), identity = JSON.stringify([store.id, obj.bucket, obj.key]);
          if (identities.has(identity) || obj.bytes > o.maxObjectBytes) throw new Error();
          identities.add(identity); totalBytes += obj.bytes;
          const item = { ...obj, store: store.id, archivePath: `objects/${digest(identity)}` };
          metadataBytes += Buffer.byteLength(JSON.stringify(item)) + 160; // hashes/content type budget
          if (!Number.isSafeInteger(totalBytes) || totalBytes > o.maxTotalBytes || metadataBytes > o.maxInventoryBytes) throw new Error();
          objects.push(item);
        }
        cursor = page.nextCursor;
        if (cursor !== undefined) {
          if (typeof cursor !== 'string' || !cursor.length || cursor.length > 16_384 || cursors.has(cursor)) throw new Error();
          cursors.add(cursor); metadataBytes += Buffer.byteLength(cursor);
        }
        // Empty pages still consume scope/cursor memory and must obey the budget.
        if (metadataBytes > o.maxInventoryBytes) throw new Error();
      } while (cursor !== undefined);
    }
    objects.sort((a, b) => a.archivePath < b.archivePath ? -1 : a.archivePath > b.archivePath ? 1 : 0);
    return { scopes, objects };
  }
  let opened = false, completed = false, consumed = false, task: Promise<void> | undefined, active: AbortSignal;
  return {
    open(signal) {
      if (opened || signal.aborted) throw new Error('Recovery storage source unavailable');
      opened = true;
      const controller = new AbortController();
      active = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(o.timeoutMs)]);
      const pack = tar.pack(), failed = () => new Error('Recovery storage export failed');
      const cancel = () => pack.destroy(failed());
      active.addEventListener('abort', cancel, { once: true });
      pack.once('close', () => { active.removeEventListener('abort', cancel); if (!completed) controller.abort(); });
      task = (async () => {
        const before = await inventory(active);
        const entries: (Listed & { sha256: string; contentType: string })[] = [];
        for (const obj of before.objects) {
          active.throwIfAborted();
          const store = o.stores.find(s => s.id === obj.store)!;
          const got = await withRecoveryAbort(store.read(obj, active), active);
          try {
            if (got.version !== obj.version || got.bytes !== obj.bytes || got.modifiedAt !== obj.modifiedAt ||
                typeof got.contentType !== 'string' || got.contentType.length > 256 || /[\r\n\0]/.test(got.contentType)) throw new Error();
            const hash = createHash('sha256'); let bytes = 0;
            const meter = new Transform({ transform(chunk: Buffer, _enc, cb) {
              bytes += chunk.length;
              if (bytes > obj.bytes) { cb(failed()); return; }
              hash.update(chunk); cb(null, chunk);
            } });
            const entry = pack.entry({ name: obj.archivePath, size: obj.bytes, type: 'file', mode: 0o600, mtime: new Date(0) });
            await pipeline(got.body, meter, entry, { signal: active });
            if (bytes !== obj.bytes) throw new Error();
            entries.push({ ...obj, sha256: hash.digest('hex'), contentType: got.contentType });
          } finally { got.body.destroy(); }
        }
        // Storage is mutable. Fail if pages/buckets/access/versions changed during copying.
        const after = await inventory(active);
        if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error();
        const manifest = Buffer.from(JSON.stringify({ version: 1, format: 'helm-storage-tar-v1',
          scopes: before.scopes, objects: entries, databaseAtomic: false }) + '\n');
        if (manifest.length > o.maxInventoryBytes) throw new Error();
        await withRecoveryAbort(new Promise<void>((resolve, reject) => {
          pack.entry({ name: 'inventory.json', size: manifest.length, mode: 0o600, mtime: new Date(0) }, manifest,
            error => error ? reject(failed()) : resolve());
        }), active);
        active.throwIfAborted(); completed = true; pack.finalize();
      })().catch(() => { controller.abort(); pack.destroy(failed()); throw failed(); });
      void task.catch(() => {});
      const output = Readable.from((async function* () {
        try { for await (const chunk of pack) yield chunk; consumed = true; }
        catch { throw failed(); }
        finally { if (!consumed) controller.abort(); }
      })());
      output.once('close', () => { if (!consumed) controller.abort(); });
      return output;
    },
    async assertComplete(signal) {
      if (!task) throw new Error('Recovery storage export incomplete');
      await withRecoveryAbort(task, signal);
      if (!completed || !consumed || signal.aborted || active.aborted) throw new Error('Recovery storage export incomplete');
    },
  };
}
