import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import tar from 'tar-stream';
import { createDatabaseArchiveSource } from '../recovery-database-archive.ts';
import type { RecoverySource } from '../recovery-export.ts';

const source = (bytes: Buffer | string): RecoverySource => ({ open: () => Readable.from([bytes]), assertComplete: async () => {} });
const roles = (key = 'ABC123', body = 'CREATE ROLE synthetic;') => source(`--\n-- PostgreSQL database cluster dump\n\\restrict ${key}\n${body}\n\\unrestrict ${key}\n`);
async function consume(s: RecoverySource) {
  const signal = AbortSignal.timeout(2000), files = new Map<string, Buffer>(), extract = tar.extract();
  const producer = (async () => { for await (const chunk of s.open(signal)) { if (!extract.write(chunk)) await new Promise<void>(r => extract.once('drain', r)); } extract.end(); })();
  // Propagate producer rejection to the consumer and retain a handler immediately.
  void producer.catch(error => extract.destroy(error));
  for await (const entry of extract) { const chunks: Buffer[] = []; for await (const chunk of entry) chunks.push(chunk); files.set(entry.header.name, Buffer.concat(chunks)); }
  await producer; await s.assertComplete(signal); return files;
}
test('database archive splits bounded parts, preserves roles and measures every byte', async () => {
  const bytes = Buffer.alloc(2 * 1024 * 1024 + 27, 23); let calls = 0;
  const files = await consume(createDatabaseArchiveSource({ database: source(bytes), roles: () => roles(`KEY${++calls}`), maxDatabaseBytes: bytes.length, timeoutMs: 2000 }));
  const manifest = JSON.parse(files.get('database.json')!.toString());
  assert.equal(manifest.parts.length, 3); assert.equal(manifest.bytes, bytes.length);
  assert.equal(manifest.sha256, createHash('sha256').update(bytes).digest('hex'));
  const restored = Buffer.concat(manifest.parts.map((p: {path: string; sha256: string; bytes: number}) => {
    const part = files.get(p.path)!; assert.equal(part.length, p.bytes); assert.equal(createHash('sha256').update(part).digest('hex'), p.sha256); return part;
  }));
  assert.deepEqual(restored, bytes); assert.match(files.get('roles.sql')!.toString(), /\\restrict KEY1/);
  assert.equal(manifest.roles.passwordsIncluded, false); assert.equal(manifest.rolesAtomicWithDatabase, false);
  assert.equal(manifest.hostedSupabaseRestoreVerified, false);
});
for (const kind of ['changed roles', 'invalid guards', 'quota', 'late source failure', 'empty'] as const) {
  test(`database archive rejects ${kind} without a completion manifest`, async () => {
    let calls = 0;
    const db = source(kind === 'empty' ? '' : 'PGDMP synthetic');
    if (kind === 'late source failure') db.assertComplete = async () => { throw new Error('private diagnostics'); };
    const archive = createDatabaseArchiveSource({ database: db, roles: () => kind === 'invalid guards' ? source('invalid') : roles('KEY', kind === 'changed roles' ? `CREATE ROLE role${++calls};` : undefined), maxDatabaseBytes: kind === 'quota' ? 1 : 1000, timeoutMs: 1000 });
    await assert.rejects(consume(archive), /Recovery database archive failed/);
  });
}
test('database archive abort stops a stalled source and fails completion', async () => {
  const abort = new AbortController(); let stopped = false;
  const archive = createDatabaseArchiveSource({ database: { open(signal) { const stream = new Readable({ read() {} }); signal.addEventListener('abort', () => { stopped = true; stream.destroy(new Error('stopped')); }, { once: true }); return stream; }, assertComplete: async () => {} }, roles: () => roles(), maxDatabaseBytes: 1000, timeoutMs: 1000 });
  const read = (async () => { for await (const chunk of archive.open(abort.signal)) void chunk; })();
  setTimeout(() => abort.abort(), 20);
  await assert.rejects(read); assert.equal(stopped, true);
  await assert.rejects(archive.assertComplete(AbortSignal.timeout(1000)));
});
