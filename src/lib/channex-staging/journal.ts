import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { emptyLedger, parseLedger, type Ledger } from './core.ts';

export async function loadLedger(path: string): Promise<Ledger> {
  try { return parseLedger(JSON.parse(await readFile(path, 'utf8'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyLedger(); throw error; }
}
export async function saveLedger(path: string, ledger: Ledger): Promise<void> {
  const verified = parseLedger(ledger);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(verified, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temporary, path);
  const directory = await open(dirname(path), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}
/** Crash leaves the lock in place for operator review; never steal a writer's lock. */
export async function withJournalLock<T>(path: string, work: () => Promise<T>): Promise<T> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const lock = `${path}.lock`;
  const handle = await open(lock, 'wx', 0o600);
  try { await handle.writeFile(String(process.pid)); await handle.sync(); return await work(); }
  finally { await handle.close(); await unlink(lock); }
}
