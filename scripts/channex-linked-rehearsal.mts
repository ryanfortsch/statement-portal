/** No-network default. --verify-staging changes only stopped February 1-3 inventory. */
import { mkdir, open, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { bookingRehearsal } from '../src/lib/channex-staging/rehearsal.ts';
import { ChannexStagingClient } from '../src/lib/channex-staging/client.ts';
import { runStoppedRehearsal, type RehearsalReceipt } from '../src/lib/channex-staging/rehearsal-runner.ts';
import { withJournalLock } from '../src/lib/channex-staging/journal.ts';

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args[0] && args[0] !== '--verify-staging')) throw new Error('Use no arguments for simulation or --verify-staging for the stopped-inventory API check');
  const steps = bookingRehearsal();
  for (const step of steps) console.log(`${step.passed ? 'PASS' : 'FAIL'} ${step.id}: ${step.title}${step.mismatches.length ? ` (${step.mismatches.join(', ')})` : ''}`);
  if (steps.some((step) => !step.passed)) throw new Error('Synthetic rehearsal failed');
  if (!args.length) { console.log('Synthetic calculation only. No network calls or bookings changed.'); return; }
  if (process.env.CHANNEX_STAGING_ALLOW_TEST_WRITES !== 'yes') throw new Error('CHANNEX_STAGING_ALLOW_TEST_WRITES=yes is required for stopped-inventory verification');
  if (process.env.VERCEL_ENV || process.env.NODE_ENV === 'production') throw new Error('Run this manual rehearsal locally, not in a deployed application');
  const client = new ChannexStagingClient(process.env.CHANNEX_STAGING_API_KEY ?? '');
  const directory = resolve('.channex-staging');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const receiptPath = resolve(directory, `linked-rehearsal-${randomUUID()}.json`);
  let lastCount = 0;
  async function persist(receipt: RehearsalReceipt) {
    const temporary = `${receiptPath}.${randomUUID()}.tmp`;
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(receipt, null, 2) + '\n'); await file.sync(); } finally { await file.close(); }
    await rename(temporary, receiptPath);
    const dir = await open(directory, 'r'); try { await dir.sync(); } finally { await dir.close(); }
    if (receipt.steps.length > lastCount) { lastCount = receipt.steps.length; console.log(`API read-back verified ${lastCount}/${steps.length}: ${receipt.steps.at(-1)!.id}`); }
  }
  await withJournalLock(resolve(directory, 'revisions.json'), async () => {
    console.log('Synthetic whole-house and unit events. Writing only stopped inventory on February 1-3, 2027.');
    const receipt = await runStoppedRehearsal(client, persist);
    console.log(JSON.stringify({ ...receipt, receiptPath }, null, 2));
  });
}
main().catch((error) => { console.error(error instanceof Error ? error.message : 'Linked rehearsal failed'); process.exitCode = 1; });
