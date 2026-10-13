/** Operator-run synthetic exercise against the isolated staging journal.
 * Never imports ChannexStagingClient and never calls an OTA API.
 * Receipt file is synthetic provider evidence, not a substitute for provider reconciliation.
 */
import { readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInventoryJournalStore } from '../src/lib/channex-staging/inventory-journal-store.ts';
import { runInventoryRehearsal } from '../src/lib/channex-staging/inventory-rehearsal.ts';
import { z } from 'zod';
const [phase, runId, receiptArg, fault] = process.argv.slice(2);
if (process.env.CHANNEX_INVENTORY_REHEARSAL !== 'synthetic-only'
  || (phase !== 'dispatch' && phase !== 'recover') || !/^rehearsal-[a-z0-9-]{1,60}$/.test(runId ?? '')
  || !receiptArg || (fault !== undefined && fault !== 'exit-after-submit')) {
  throw new Error('Explicit synthetic-only rehearsal, phase, run ID and receipt path required');
}
const receiptPath = resolve(receiptArg);
const schema = z.object({ runId: z.string(), calls: z.number().int().nonnegative(),
  digest: z.string().optional(), generation: z.number().int().positive().optional() }).strict();
const readReceipt = () => {
  const value = schema.parse(JSON.parse(readFileSync(receiptPath, 'utf8')));
  if (value.runId !== runId) throw new Error('Synthetic receipt identity mismatch');
  return value;
};
if (phase === 'dispatch') {
  try { const fd = openSync(receiptPath, 'wx', 0o600); try {
    writeFileSync(fd, JSON.stringify({ runId, calls: 0 })); fsyncSync(fd);
  } finally { closeSync(fd); } } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}
readReceipt(); // Missing/corrupt recovery evidence fails closed, never fabricated.
const store = createInventoryJournalStore(process.env.CHANNEX_STAGING_DB_URL ?? '', process.env.CHANNEX_STAGING_DB_SERVICE_KEY ?? '');
try {
  const result = await runInventoryRehearsal(store, {
    kind: 'synthetic',
    async submit(job) {
      const receipt = readReceipt();
      const fd = openSync(receiptPath + '.next', 'wx', 0o600);
      try { writeFileSync(fd, JSON.stringify({ runId, calls: receipt.calls + 1, digest: job.digest, generation: job.generation })); fsyncSync(fd); }
      finally { closeSync(fd); }
      renameSync(receiptPath + '.next', receiptPath);
      return `synthetic-${runId}`;
    },
    async inspect() {
      const receipt = readReceipt();
      return { settled: receipt.calls === 1, complete: receipt.calls === 1,
        digest: receipt.digest ?? 'unknown', generation: receipt.generation ?? 1 };
    },
  }, runId, phase, Date.now, fault === 'exit-after-submit' ? () => process.exit(72) : undefined);
  console.log(JSON.stringify({ mode: 'synthetic-only', ...result, recordedSubmissions: readReceipt().calls }));
} catch {
  console.error('Synthetic rehearsal stopped. Retain journal and receipt; inspect before retry.');
  process.exitCode = 1;
}
