import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import tar from 'tar-stream';
import { S3Client } from '@aws-sdk/client-s3';
import { createStorageRecoverySource, type RecoveryObjectStore, type RecoveryObject } from '../recovery-storage.ts';
import { createPostgresRecoverySource } from '../recovery-postgres.ts';
import { createRecoveryS3Client, createSupabaseStorageStore, createVercelBlobStore } from '../recovery-storage-providers.ts';
import type { RecoverySource } from '../recovery-export.ts';

const at = '2026-01-01T00:00:00.000Z';
const object = (key = 'folder/document.pdf', bytes = 5): RecoveryObject => ({ bucket: 'private-documents', key, bytes, version: 'etag-1', modifiedAt: at, access: 'private' });
const defaults = { maxObjects: 2000, maxObjectBytes: 10000, maxTotalBytes: 100000, maxInventoryBytes: 2_000_000, timeoutMs: 3000 };
const store = (objects = [object()]): RecoveryObjectStore => ({ id: 'synthetic',
  list: async () => ({ objects, scope: 'all-reviewed-buckets' }),
  read: async obj => ({ body: Readable.from([Buffer.alloc(obj.bytes, 65)]), version: obj.version, bytes: obj.bytes, modifiedAt: obj.modifiedAt, contentType: 'application/pdf' }),
});
const signal = () => AbortSignal.timeout(5000);
async function collect(source: RecoverySource, abort = signal()) {
  const chunks: Buffer[] = [];
  for await (const chunk of source.open(abort)) chunks.push(Buffer.from(chunk));
  await source.assertComplete(abort);
  return Buffer.concat(chunks);
}
async function unpack(bytes: Buffer) {
  const result = new Map<string, Buffer>(), extractor = tar.extract();
  extractor.end(bytes);
  for await (const entry of extractor) {
    assert.equal(entry.header.type, 'file'); assert.equal(entry.header.mode, 0o600);
    const chunks: Buffer[] = [];
    for await (const chunk of entry) chunks.push(chunk);
    assert.ok(!result.has(entry.header.name)); result.set(entry.header.name, Buffer.concat(chunks));
  }
  return result;
}
test('storage exports every page beyond 1000 objects, rechecks inventory, and standard tar restores exact bytes', async () => {
  const items = Array.from({ length: 1001 }, (_, i) => object(`folder/${i}`, i % 3));
  const provider = store(items); const cursors: (string | undefined)[] = [];
  provider.list = async cursor => { cursors.push(cursor); return { scope: 'all-buckets', objects: cursor ? items.slice(1000) : items.slice(0, 1000), nextCursor: cursor ? undefined : 'page-two' }; };
  const entries = await unpack(await collect(createStorageRecoverySource({ ...defaults, stores: [provider] })));
  assert.deepEqual(cursors, [undefined, 'page-two', undefined, 'page-two']);
  const inventory = JSON.parse(entries.get('inventory.json')!.toString());
  assert.equal(entries.size, 1002); assert.equal(inventory.objects.length, 1001); assert.equal(inventory.databaseAtomic, false);
  for (const row of inventory.objects) {
    const bytes = entries.get(row.archivePath)!;
    assert.deepEqual(bytes, Buffer.alloc(row.bytes, 65));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256);
  }
});
test('storage preserves arbitrary object keys only in encrypted inventory, never as extraction paths; supports empty stores', async () => {
  const source = createStorageRecoverySource({ ...defaults, stores: [store([object('../../escape'), object('/absolute'), object('unicode/é')]), { ...store([]), id: 'empty' }] });
  const files = await unpack(await collect(source));
  assert.ok([...files.keys()].every(k => k === 'inventory.json' || /^objects\/[a-f0-9]{64}$/.test(k)));
  const inventory = JSON.parse(files.get('inventory.json')!.toString());
  assert.equal(inventory.scopes.empty, 'all-reviewed-buckets');
  assert.ok(inventory.objects.some((o: { key: string }) => o.key === '../../escape'));
  await assert.rejects(collect(source), /unavailable/);
});
for (const mode of ['duplicate', 'cursor-loop', 'scope-change', 'version-change', 'deleted', 'added', 'short', 'long', 'read-version', 'read-time', 'source-error', 'quota', 'metadata-limit']) {
  test(`storage refuses completion: ${mode}`, async () => {
    const provider = store(); let calls = 0;
    const list = provider.list, read = provider.read;
    provider.list = async (cursor, abort) => {
      calls++; const result = await list(cursor, abort);
      if (mode === 'duplicate') result.objects.push(object());
      if (mode === 'cursor-loop') return { ...result, objects: [], nextCursor: 'same' };
      if (mode === 'scope-change' && calls > 1) result.scope = 'different';
      if (mode === 'version-change' && calls > 1) result.objects[0].version = 'new';
      if (mode === 'deleted' && calls > 1) result.objects = [];
      if (mode === 'added' && calls > 1) result.objects.push(object('new'));
      return result;
    };
    provider.read = async (obj, abort) => {
      if (mode === 'source-error') throw new Error('PRIVATE: must not appear in errors');
      const result = await read(obj, abort);
      if (mode === 'short' || mode === 'long') result.body = Readable.from([Buffer.alloc(mode === 'short' ? 4 : 6)]);
      if (mode === 'read-version') result.version = 'changed';
      if (mode === 'read-time') result.modifiedAt = '2026-01-02T00:00:00.000Z';
      return result;
    };
    const source = createStorageRecoverySource({ ...defaults, stores: [provider],
      ...(mode === 'quota' ? { maxTotalBytes: 4 } : {}), ...(mode === 'metadata-limit' ? { maxInventoryBytes: 10 } : {}) });
    await assert.rejects(collect(source), { message: 'Recovery storage export failed' });
    await assert.rejects(source.assertComplete(signal()));
  });
}
test('storage deadline aborts stalled listing and streaming body', async () => {
  for (const mode of ['listing', 'body']) {
    const provider = store(); let readBody: Readable | undefined;
    if (mode === 'listing') provider.list = () => new Promise(() => {});
    else provider.read = async obj => ({ body: readBody = new Readable({ read() {} }), version: obj.version, bytes: obj.bytes, modifiedAt: at, contentType: 'text/plain' });
    await assert.rejects(collect(createStorageRecoverySource({ ...defaults, timeoutMs: 50, stores: [provider] })));
    if (readBody) assert.ok(readBody.destroyed);
  }
});
test('empty pagination cannot exhaust memory using ever-growing cursor history', async () => {
  let pages = 0;
  const provider = { ...store([]), list: async () => ({ scope: 'empty', objects: [], nextCursor: `${++pages}-${'x'.repeat(100)}` }) };
  await assert.rejects(collect(createStorageRecoverySource({ ...defaults, stores: [provider], maxInventoryBytes: 200 })), /storage export failed/);
  assert.equal(pages, 2);
});

test('Supabase adapter enumerates empty buckets and all pages, uses conditional reads, rejects unexpected buckets', async () => {
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  let unexpected = false;
  const client = { send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    calls.push({ name: command.constructor.name, input: command.input });
    if (command.constructor.name === 'ListBucketsCommand') return { Buckets: [{ Name: 'empty' }, { Name: 'private-documents' }, ...(unexpected ? [{ Name: 'new-bucket' }] : [])] };
    if (command.constructor.name === 'ListObjectsV2Command') {
      if (command.input.Bucket === 'empty') return { IsTruncated: false, Contents: [] };
      return { IsTruncated: !command.input.ContinuationToken, NextContinuationToken: command.input.ContinuationToken ? undefined : 'page-2',
        Contents: [{ Key: command.input.ContinuationToken ? 'second' : 'first', Size: 5, ETag: 'etag-1', LastModified: new Date('2026-01-01T00:00:00.123Z') }] };
    }
    return { Body: Readable.from(['AAAAA']), ContentLength: 5, ETag: 'etag-1', LastModified: new Date(at) };
  } } as unknown as Pick<S3Client, 'send'>;
  const adapter = createSupabaseStorageStore(client, { empty: 'private', 'private-documents': 'private' });
  const files = await unpack(await collect(createStorageRecoverySource({ ...defaults, stores: [adapter] })));
  assert.equal(files.size, 3);
  assert.ok(calls.filter(c => c.name === 'GetObjectCommand').every(c => c.input.IfMatch === 'etag-1'));
  assert.ok(calls.some(c => c.input.ContinuationToken === 'page-2'));
  unexpected = true;
  await assert.rejects(adapter.list(undefined, signal()), /provider failed/);
});
test('Supabase endpoint and credentials are explicit; bad project is refused before network', async () => {
  assert.throws(() => createRecoveryS3Client({ projectRef: 'wrong', region: 'us-east-2', accessKeyId: 'x', secretAccessKey: 'y' }));
  const client = createRecoveryS3Client({ projectRef: 'a'.repeat(20), region: 'us-east-2', accessKeyId: 'synthetic-key', secretAccessKey: 'synthetic-secret' });
  assert.equal((await client.config.endpoint!()).hostname, `${'a'.repeat(20)}.storage.supabase.co`);
  assert.equal((await client.config.credentials()).accessKeyId, 'synthetic-key'); client.destroy();
});
test('Vercel source pins store and token, follows cursor, bypasses cache, checks returned versions', async () => {
  let changed = false; const args: unknown[] = [];
  const sdk = {
    list: async (options: { cursor?: string }) => { args.push(options); return { hasMore: !options.cursor, cursor: options.cursor ? undefined : 'second',
      blobs: [{ url: `https://teststore.private.blob.vercel-storage.com/${options.cursor ? 'two' : 'one'}`, pathname: options.cursor ? 'two' : 'one', size: 5, etag: 'etag-1', uploadedAt: new Date(at) }] }; },
    get: async (key: string, options: unknown) => { args.push(options); return { statusCode: 200, stream: new Response('AAAAA').body!,
      blob: { url: `https://teststore.private.blob.vercel-storage.com/${key}`, size: 5, etag: changed ? 'etag-2' : 'etag-1', uploadedAt: new Date(at), contentType: 'application/pdf' } }; },
  } as unknown as Parameters<typeof createVercelBlobStore>[1];
  const options = { token: 'vercel_blob_rw_teststore_synthetic', expectedStoreId: 'teststore', access: 'private' as const };
  assert.throws(() => createVercelBlobStore({ ...options, expectedStoreId: 'other' }, sdk));
  const adapter = createVercelBlobStore(options, sdk);
  assert.equal((await unpack(await collect(createStorageRecoverySource({ ...defaults, stores: [adapter] })))).size, 3);
  assert.ok(args.some(a => (a as { useCache?: boolean }).useCache === false));
  changed = true;
  await assert.rejects(adapter.read({ ...object('one'), bucket: 'teststore' }, signal()), /provider failed/);
});

const connection = { host: '/private/tmp/synthetic-only', expectedHost: '/private/tmp/synthetic-only', port: 5432,
  database: 'synthetic', user: 'synthetic', password: 'synthetic-secret', tls: { mode: 'local-socket' as const } };
test('database config refuses host mismatch, connection-string injection and nonlocal TLS bypass', () => {
  const options = { pgDumpExecutable: '/usr/bin/pg_dump', connection, timeoutMs: 1000 };
  assert.throws(() => createPostgresRecoverySource({ ...options, connection: { ...connection, host: 'other' } }));
  assert.throws(() => createPostgresRecoverySource({ ...options, connection: { ...connection, database: 'postgres?host=elsewhere' } }));
  assert.throws(() => createPostgresRecoverySource({ ...options, connection: { ...connection, host: 'db.example.com', expectedHost: 'db.example.com' } }));
  assert.throws(() => createPostgresRecoverySource({ ...options, connection: { ...connection, password: '' } }));
});
test('missing database executable cannot publish a complete source', async () => {
  const source = createPostgresRecoverySource({ pgDumpExecutable: '/does-not-exist/pg_dump', connection, timeoutMs: 1000 });
  await assert.rejects(collect(source)); await assert.rejects(source.assertComplete(signal()));
});
for (const mode of ['success', 'late-failure', 'warning', 'bad-header', 'timeout', 'environment']) {
  test(`database process source: ${mode}`, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'helm-recovery-process-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const executable = join(directory, 'synthetic-pg-dump');
    await writeFile(executable, `#!${process.execPath}\n` + `
      if (${JSON.stringify(mode)} === 'environment' && (process.env.HOME || process.env.PGSERVICE || process.env.PGOPTIONS !== '-c default_transaction_read_only=on -c statement_timeout=0' || process.argv.some(a => a.includes('synthetic-secret')))) process.exit(2);
      process.stdout.end(Buffer.concat([Buffer.from(${JSON.stringify(mode === 'bad-header' ? 'WRONG' : 'PGDMP')}), Buffer.alloc(64)]));
      if (${JSON.stringify(mode)} === 'warning') process.stderr.write('PRIVATE diagnostic');
      if (${JSON.stringify(mode)} === 'late-failure') setTimeout(() => process.exit(1), 30);
      if (${JSON.stringify(mode)} === 'timeout') setInterval(() => {}, 1000);
    `, { mode: 0o700 });
    const source = createPostgresRecoverySource({ pgDumpExecutable: executable, connection, timeoutMs: mode === 'timeout' ? 80 : 3000 });
    assert.equal(source.snapshotNotBefore(), null);
    if (mode === 'success' || mode === 'environment') { assert.equal((await collect(source)).length, 69); assert.ok(source.snapshotNotBefore()); }
    else { await assert.rejects(collect(source)); await assert.rejects(source.assertComplete(signal())); }
  });
}
