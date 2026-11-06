/** Standalone worker adapter. No ambient credentials and no automatic execution. */
import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { Readable } from 'node:stream';
import { withRecoveryAbort, type RecoverySource } from './recovery-export.ts';

type Connection = {
  host: string; port: number; database: string; user: string; password: string;
  /** Pinned independently of credentials; never accept a libpq connection string. */
  expectedHost: string;
  tls: { mode: 'verify-full'; rootCertificate: string } | { mode: 'local-socket' };
};

/**
 * Complete single-database custom-format dump, including schema/data/ACLs/RLS.
 * Cluster roles/passwords and hosted Supabase restoration are separate concerns.
 * snapshotNotBefore is a conservative bound, NOT the exact MVCC snapshot time.
 */
export function createPostgresRecoverySource(options: {
  pgDumpExecutable: string; connection: Connection; timeoutMs: number;
}): RecoverySource & { snapshotNotBefore: () => string | null } {
  const { pgDumpExecutable, connection: c, timeoutMs } = options;
  const atom = (s: string) => typeof s === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(s);
  if (!isAbsolute(pgDumpExecutable) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 86_400_000 ||
      !Number.isInteger(c.port) || c.port < 1 || c.port > 65535 || !atom(c.database) || !atom(c.user) ||
      c.host !== c.expectedHost || typeof c.password !== 'string' || !c.password || c.password.includes('\0') ||
      (c.tls.mode === 'local-socket' ? !isAbsolute(c.host) || /[\0\n\r,]/.test(c.host) :
        !/^[a-z0-9][a-z0-9.-]+$/.test(c.host) || !isAbsolute(c.tls.rootCertificate))) {
    throw new Error('Invalid recovery database configuration');
  }
  let opened = false, complete = false, began: string | null = null;
  let task: Promise<void> | undefined;
  return {
    snapshotNotBefore: () => began,
    open(signal) {
      if (opened || signal.aborted) throw new Error('Recovery database source unavailable');
      opened = true; began = new Date().toISOString();
      const controller = new AbortController();
      const active = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(timeoutMs)]);
      const child = spawn(pgDumpExecutable, ['--format=custom', '--no-password', '--lock-wait-timeout=30000'], {
        shell: false, stdio: ['ignore', 'pipe', 'pipe'],
        env: { LANG: 'C', PATH: '/usr/bin:/bin', NODE_ENV: 'production', PGHOST: c.host, PGPORT: String(c.port), PGDATABASE: c.database,
          PGUSER: c.user, PGPASSWORD: c.password, PGCONNECT_TIMEOUT: '30', PGAPPNAME: 'helm-recovery-export',
          PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=0',
          PGSSLMODE: c.tls.mode === 'local-socket' ? 'disable' : 'verify-full',
          ...(c.tls.mode === 'verify-full' ? { PGSSLROOTCERT: c.tls.rootCertificate } : {}),
          // Do not load ~/.pgpass, ~/.pg_service.conf, or inherited libpq options.
          PGPASSFILE: '/dev/null', PGSERVICEFILE: '/dev/null',
        },
      });
      let diagnostics = false;
      child.stderr.on('data', () => { diagnostics = true; }); // Never retain/echo DB diagnostics.
      const stop = () => { child.kill('SIGKILL'); };
      active.addEventListener('abort', stop, { once: true });
      task = new Promise<void>((resolve, reject) => {
        child.once('error', () => reject(new Error('Recovery database export failed')));
        child.once('close', code => {
          active.removeEventListener('abort', stop);
          if (code !== 0 || diagnostics || active.aborted) reject(new Error('Recovery database export failed'));
          else resolve();
        });
      });
      void task.catch(() => {});
      const producer = task;
      const output = Readable.from((async function* () {
        let prefix = Buffer.alloc(0), bytes = 0;
        try {
          for await (const value of child.stdout) {
            active.throwIfAborted();
            const chunk = Buffer.from(value); bytes += chunk.length;
            if (prefix.length < 5) prefix = Buffer.concat([prefix, chunk.subarray(0, 5 - prefix.length)]);
            yield chunk;
          }
          // stdout EOF alone is not success: pg_dump may still fail afterwards.
          await withRecoveryAbort(producer, active);
          if (bytes < 32 || prefix.toString('ascii') !== 'PGDMP') throw new Error();
          complete = true;
        } catch { throw new Error('Recovery database export failed'); }
        finally { if (!complete) { controller.abort(); await producer.catch(() => {}); } }
      })(), { signal: active });
      output.once('close', () => { if (!complete) controller.abort(); });
      return output;
    },
    async assertComplete(signal) {
      if (!opened || !task) throw new Error('Recovery database export incomplete');
      await withRecoveryAbort(task, signal);
      if (!complete || signal.aborted) throw new Error('Recovery database export incomplete');
    },
  };
}
