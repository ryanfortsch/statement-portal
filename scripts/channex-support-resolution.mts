/** Explicit incident-only action. Never enables publishing or sends availability. */
import { createClient } from '@supabase/supabase-js';
import { createReviewedRetryStore } from '../src/lib/channex-staging/inventory-reviewed-retry-store.ts';
import { prepareSupportResolution } from '../src/lib/channex-staging/inventory-support-resolution.ts';
import { replayInventoryJournal } from '../src/lib/channex-staging/inventory-journal.ts';
const url = process.env.CHANNEX_STAGING_DB_URL ?? '';
const key = process.env.CHANNEX_STAGING_DB_SERVICE_KEY ?? '';
const property = 'HELMTEST-calderwood';
const originalId = 'projection-26b938594823807dc4e00b3e2e63b4d2b29394831feaed4bd696a98554efdfce';
if (process.argv.length !== 3 || process.argv[2] !== '--apply-reviewed-2026-11-01' ||
    url !== 'https://jgkblfozftcvymvwhhii.supabase.co' || !key) {
  throw Error('Explicit isolated incident resolution flag and staging credentials required');
}
const store = createReviewedRetryStore(url, key, property, originalId);
const before = await store.read();
const prepared = prepareSupportResolution(before, {
  originalId, requestDigest: '10f35c6758c088c97c99bb475a7dc085288f267ae4207d74e0fc6da6f40da5d7',
  supportMessage: '1a194f5fa29b4351', reviewedBy: 'ryan@risingtidestr.com',
});
if (prepared.command.kind !== 'retire-not-received' || prepared.command.retryTask !== '4e5073dc-5d33-4087-91a7-d0a5fd0f8d16') {
  throw Error('Incident recovery task changed');
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await db.rpc('helm_inventory_support_resolution', {
  p_property: property, expected_version: prepared.expectedVersion,
  expected_retry_revision: before.revision, next_journal: prepared.journal,
});
if (error || data !== true) throw Error('Resolution not confirmed; inspect durable history before any further action');
const after = await store.read();
const job = replayInventoryJournal(after.journal).queue.list().find(j => j.id === originalId);
if (!after.current.workerPaused || job?.status !== 'superseded' || job.task || job.receipt) {
  throw Error('Resolution readback differs; keep publishing paused');
}
console.log(JSON.stringify({ event: 'support-resolution', originalId, disposition: 'provider-asserted-non-receipt',
  originalMarkedVerified: false, publisherPaused: after.current.workerPaused,
  supportMessage: prepared.command.supportMessage, verifiedRetryTask: prepared.command.retryTask }));
