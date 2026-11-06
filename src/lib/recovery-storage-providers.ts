/** Read-only provider operations. Credentials must be supplied explicitly by a dedicated worker. */
import { Readable } from 'node:stream';
import { S3Client, ListBucketsCommand, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { list, get } from '@vercel/blob';
import type { RecoveryObjectStore } from './recovery-storage.ts';

type Access = 'public' | 'private';
const failure = () => new Error('Recovery storage provider failed');
// HTTP Last-Modified loses milliseconds; ETag + length still pin the content version.
const iso = (date: Date | undefined) => { if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw failure(); return new Date(Math.floor(date.getTime() / 1000) * 1000).toISOString(); };

/** Separate constructor pins the project endpoint and disables ambient AWS credentials. */
export function createRecoveryS3Client(options: { projectRef: string; region: string; accessKeyId: string; secretAccessKey: string }) {
  if (!/^[a-z]{20}$/.test(options.projectRef) || !/^[a-z0-9-]{3,64}$/.test(options.region) || !options.accessKeyId || !options.secretAccessKey) throw failure();
  return new S3Client({ region: options.region, forcePathStyle: true, maxAttempts: 3,
    endpoint: `https://${options.projectRef}.storage.supabase.co/storage/v1/s3`,
    credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
  });
}

/**
 * S3 does not expose Supabase bucket access policy. The reviewed bucket/access map
 * must come from the same configuration inventory used for restoration.
 * Any unexpected/missing bucket fails, including an empty one.
 */
export function createSupabaseStorageStore(client: Pick<S3Client, 'send'>, buckets: Record<string, Access>): RecoveryObjectStore {
  const names = Object.keys(buckets).sort();
  if (names.length > 1000 || names.some(n => !/^[A-Za-z0-9._-]{1,100}$/.test(n) || !['public', 'private'].includes(buckets[n]))) throw failure();
  const scope = JSON.stringify(names.map(name => ({ bucket: name, access: buckets[name] })));
  return {
    id: 'supabase',
    async list(cursor, signal) {
      try {
        signal.throwIfAborted();
        const all = await client.send(new ListBucketsCommand({}), { abortSignal: signal });
        if (all.ContinuationToken || !Array.isArray(all.Buckets) ||
            JSON.stringify(all.Buckets.map(b => b.Name).sort()) !== JSON.stringify(names)) throw failure();
        if (!names.length) return { scope, objects: [] };
        const state = cursor === undefined ? { bucket: 0, token: undefined } : JSON.parse(cursor) as { bucket: number; token?: string };
        if (!Number.isInteger(state.bucket) || !names[state.bucket] ||
            (state.token !== undefined && (typeof state.token !== 'string' || !state.token))) throw failure();
        const bucket = names[state.bucket];
        const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1000, ContinuationToken: state.token }), { abortSignal: signal });
        if (typeof page.IsTruncated !== 'boolean' || (page.IsTruncated && !page.NextContinuationToken)) throw failure();
        const objects = (page.Contents ?? []).map(obj => {
          if (!obj.Key || !obj.ETag || obj.Size === undefined) throw failure();
          return { bucket, key: obj.Key, bytes: obj.Size, version: obj.ETag, modifiedAt: iso(obj.LastModified), access: buckets[bucket] };
        });
        const nextCursor = page.IsTruncated ? JSON.stringify({ bucket: state.bucket, token: page.NextContinuationToken }) :
          state.bucket + 1 < names.length ? JSON.stringify({ bucket: state.bucket + 1 }) : undefined;
        return { scope, objects, nextCursor };
      } catch { throw failure(); }
    },
    async read(obj, signal) {
      let body: Readable | undefined;
      try {
        if (buckets[obj.bucket] !== obj.access) throw failure();
        const result = await client.send(new GetObjectCommand({ Bucket: obj.bucket, Key: obj.key, IfMatch: obj.version }), { abortSignal: signal });
        if (result.Body instanceof Readable) body = result.Body;
        if (!body || result.ETag !== obj.version || result.ContentLength !== obj.bytes || iso(result.LastModified) !== obj.modifiedAt) throw failure();
        return { body, version: result.ETag, bytes: result.ContentLength, modifiedAt: iso(result.LastModified), contentType: result.ContentType ?? 'application/octet-stream' };
      } catch { body?.destroy(); throw failure(); }
    },
  };
}

export function createVercelBlobStore(options: {
  token: string; expectedStoreId: string; access: Access;
}, sdk: { list: typeof list; get: typeof get } = { list, get }): RecoveryObjectStore {
  const { token, expectedStoreId, access } = options;
  if (!/^[a-z0-9]+$/i.test(expectedStoreId) || !/^vercel_blob_rw_[A-Za-z0-9]+_.+$/.test(token) ||
      token.split('_')[3].toLowerCase() !== expectedStoreId.toLowerCase() || !['public', 'private'].includes(access)) throw failure();
  const origin = `https://${expectedStoreId.toLowerCase()}.${access}.blob.vercel-storage.com`;
  const scope = JSON.stringify({ storeId: expectedStoreId, access });
  const checkUrl = (raw: string) => {
    const u = new URL(raw);
    if (u.origin !== origin || u.username || u.password || u.search || u.hash) throw failure();
  };
  return {
    id: `vercel-${expectedStoreId.toLowerCase()}`,
    async list(cursor, signal) {
      try {
        const result = await sdk.list({ token, cursor, mode: 'expanded', limit: 1000, abortSignal: signal });
        if (typeof result.hasMore !== 'boolean' || (result.hasMore && !result.cursor)) throw failure();
        return { scope, nextCursor: result.hasMore ? result.cursor : undefined, objects: result.blobs.map(blob => {
          checkUrl(blob.url);
          return { bucket: expectedStoreId, key: blob.pathname, bytes: blob.size, version: blob.etag, modifiedAt: iso(blob.uploadedAt), access };
        }) };
      } catch { throw failure(); }
    },
    async read(obj, signal) {
      let body: Readable | undefined;
      try {
        if (obj.bucket !== expectedStoreId || obj.access !== access || /^https?:/i.test(obj.key)) throw failure();
        // A pathname makes the SDK derive the origin from the explicit pinned token.
        const result = await sdk.get(obj.key, { token, access, useCache: false, abortSignal: signal, headers: { 'If-Match': obj.version } });
        if (!result || result.statusCode !== 200) throw failure();
        body = Readable.fromWeb(result.stream as import('node:stream/web').ReadableStream<Uint8Array>);
        checkUrl(result.blob.url);
        if (result.blob.etag !== obj.version || result.blob.size !== obj.bytes || iso(result.blob.uploadedAt) !== obj.modifiedAt) throw failure();
        return { body, version: result.blob.etag, bytes: result.blob.size, modifiedAt: iso(result.blob.uploadedAt), contentType: result.blob.contentType };
      } catch { body?.destroy(); throw failure(); }
    },
  };
}
