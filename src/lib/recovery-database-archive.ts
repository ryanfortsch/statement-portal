/** A standard tar of native PostgreSQL dump parts + password-free cluster roles. */
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import tar from 'tar-stream';
import { withRecoveryAbort, type RecoverySource } from './recovery-export.ts';

const PART_BYTES = 1024 * 1024;
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const failed = () => new Error('Recovery database archive failed');
/** Remove only pg_dumpall's two random psql guard lines for the before/after comparison. */
function comparableRoles(bytes: Buffer) {
  const text = bytes.toString('utf8');
  const guards = [...text.matchAll(/^\\(unrestrict|restrict) ([A-Za-z0-9]+)$/gm)];
  if (guards.length !== 2 || guards[0][1] !== 'restrict' || guards[1][1] !== 'unrestrict' || guards[0][2] !== guards[1][2]) throw failed();
  return text.replace(/^\\(?:unrestrict|restrict) [A-Za-z0-9]+$/gm, '-- recovery comparison guard');
}
async function collectRoles(source: RecoverySource, signal: AbortSignal) {
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of source.open(signal)) {
    signal.throwIfAborted(); bytes += chunk.length;
    if (bytes > 2 * 1024 * 1024) throw failed();
    chunks.push(Buffer.from(chunk));
  }
  await withRecoveryAbort(source.assertComplete(signal), signal);
  const result = Buffer.concat(chunks); comparableRoles(result); return result;
}

export function createDatabaseArchiveSource(options: {
  database: RecoverySource; roles: () => RecoverySource; maxDatabaseBytes: number; timeoutMs: number;
}): RecoverySource {
  if (!Number.isSafeInteger(options.maxDatabaseBytes) || options.maxDatabaseBytes < 1 ||
      options.maxDatabaseBytes > 100 * 1024 ** 3 || !Number.isSafeInteger(options.timeoutMs) ||
      options.timeoutMs < 1 || options.timeoutMs > 86_400_000) throw failed();
  let opened = false, consumed = false, completed = false, task: Promise<void> | undefined;
  return {
    open(signal) {
      if (opened || signal.aborted) throw failed(); opened = true;
      const controller = new AbortController();
      const active = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(options.timeoutMs)]);
      const pack = tar.pack();
      const abort = () => pack.destroy(failed());
      active.addEventListener('abort', abort, { once: true });
      const entry = async (name: string, bytes: Buffer) => withRecoveryAbort(new Promise<void>((resolve, reject) => {
        pack.entry({ name, size: bytes.length, mode: 0o600, mtime: new Date(0), type: 'file' }, bytes,
          error => error ? reject(failed()) : resolve());
      }), active);
      task = (async () => {
        const before = await collectRoles(options.roles(), active);
        const parts: { path: string; bytes: number; sha256: string }[] = [];
        const whole = createHash('sha256'); let total = 0, used = 0, buffer = Buffer.alloc(PART_BYTES);
        const flush = async () => {
          if (!used) return;
          const bytes = buffer.subarray(0, used), path = `database/${String(parts.length).padStart(6, '0')}.part`;
          await entry(path, bytes); parts.push({ path, bytes: used, sha256: hash(bytes) });
          buffer = Buffer.alloc(PART_BYTES); used = 0;
        };
        for await (const value of options.database.open(active)) {
          active.throwIfAborted(); const chunk = Buffer.from(value); total += chunk.length;
          if (total > options.maxDatabaseBytes) throw failed(); whole.update(chunk);
          for (let at = 0; at < chunk.length;) {
            const take = Math.min(PART_BYTES - used, chunk.length - at);
            chunk.copy(buffer, used, at, at + take); used += take; at += take;
            if (used === PART_BYTES) await flush();
          }
        }
        await withRecoveryAbort(options.database.assertComplete(active), active);
        if (!total) throw failed(); await flush();
        const after = await collectRoles(options.roles(), active);
        if (comparableRoles(before) !== comparableRoles(after)) throw failed();
        await entry('roles.sql', before);
        await entry('database.json', Buffer.from(JSON.stringify({ version: 1, format: 'helm-postgres-tar-v1',
          dumpFormat: 'postgres-custom', bytes: total, sha256: whole.digest('hex'), parts,
          roles: { path: 'roles.sql', bytes: before.length, sha256: hash(before), passwordsIncluded: false },
          rolesAtomicWithDatabase: false, hostedSupabaseRestoreVerified: false }) + '\n'));
        active.throwIfAborted(); completed = true; pack.finalize();
      })().catch(() => { controller.abort(); pack.destroy(failed()); throw failed(); });
      void task.catch(() => {});
      const output = Readable.from((async function* () {
        try { for await (const chunk of pack) yield chunk; consumed = true; }
        catch { throw failed(); }
        finally { active.removeEventListener('abort', abort); if (!consumed) controller.abort(); }
      })());
      output.once('close', () => { if (!consumed) controller.abort(); });
      return output;
    },
    async assertComplete(signal) {
      if (!task) throw failed(); await withRecoveryAbort(task, signal);
      if (!completed || !consumed || signal.aborted) throw failed();
    },
  };
}
