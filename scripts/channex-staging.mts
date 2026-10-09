/** Explicit operator CLI. No env-file auto loading, cron, production DB or OTA connection. */
import { resolve } from 'node:path';
import { availability, emptyLedger, syntheticScenario, type Revision, applyRevision } from '../src/lib/channex-staging/core.ts';
import { ChannexStagingClient, importStagingRevisions } from '../src/lib/channex-staging/client.ts';
import { loadLedger, saveLedger, withJournalLock } from '../src/lib/channex-staging/journal.ts';

const command = process.argv[2] ?? 'simulate';
const ledgerPath = resolve('.channex-staging', 'revisions.json');
async function main() {
  if (command === 'simulate') { console.table(syntheticScenario()); return; }
  if (!['status', 'pull', 'publish-test'].includes(command)) throw new Error('Use simulate, status, pull, or publish-test');
  const client = new ChannexStagingClient(process.env.CHANNEX_STAGING_API_KEY ?? '');
  const mappings = await client.inspect();
  if (command === 'status') { console.log(JSON.stringify({ environment: 'staging', channelsAttached: 0, mappings }, null, 2)); return; }
  if (command === 'pull') {
    await withJournalLock(ledgerPath, async () => {
      const result = await importStagingRevisions(client, await loadLedger(ledgerPath), (ledger) => saveLedger(ledgerPath, ledger));
      const { applied, duplicate, stale, acknowledged } = result;
      const summary = { applied, duplicate, stale, acknowledged };
      console.log(JSON.stringify({ environment: 'staging', ...summary }, null, 2));
    });
    return;
  }
  if (process.env.CHANNEX_STAGING_ALLOW_TEST_WRITES !== 'yes') throw new Error('Set CHANNEX_STAGING_ALLOW_TEST_WRITES=yes for the explicit stopped-inventory test');
  // Synthetic test only, not availability derived from the live whole-house listing.
  const fixture: Revision = { id: 'back-synthetic', bookingId: 'back-synthetic', member: 'back', status: 'new', checkIn: '2027-02-01', checkOut: '2027-03-01', receivedAt: '2026-09-30T12:00:00Z' };
  const ledger = applyRevision(emptyLedger(), fixture).ledger;
  const days = availability(ledger, [], '2027-02-01', '2027-02-04', { whole: true, front: true, back: true });
  const result = await client.publishStoppedInventory(days);
  console.log(JSON.stringify({ environment: 'staging', synthetic: true, stopSell: true, testNights: '2027-02-01 through 2027-02-03', ...result }, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : 'Staging check failed'); process.exitCode = 1; });
