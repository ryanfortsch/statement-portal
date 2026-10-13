/** CLI-only stopped-inventory verification. No Guesty client or calendar writer. */
import type { ChannexStagingClient, StagingSnapshot } from './client.ts';
import { bookingRehearsal, REHEARSAL_DATES } from './rehearsal.ts';
import { nights, TEST_START, TEST_END, type AvailabilityDay } from './core.ts';

export type RehearsalReceipt = {
  version: 1; environment: 'channex-staging'; synthetic: true; state: 'running' | 'passed' | 'failed';
  startedAt: string; finishedAt: string | null;
  steps: { id: string; verifiedUnitNights: number }[];
  cleanup: 'pending' | 'verified' | 'failed'; finalStoppedNights: number | null;
};
type Client = Pick<ChannexStagingClient, 'readSnapshot' | 'publishStoppedInventory'>;
function verifyClosed(snapshot: StagingSnapshot) {
  if (snapshot.bookings.some((b) => b.status !== 'cancelled')) throw new Error('Active test bookings exist; resolve them before the inventory rehearsal');
  const expected = new Set(['front', 'back'].flatMap((unit) => nights(TEST_START, TEST_END).map((date) => `${unit}:${date}`)));
  for (const night of snapshot.inventory) {
    if (!expected.delete(`${night.unit}:${night.date}`) || night.stopSell !== true || night.minStay !== 20) throw new Error('Pilot inventory is incomplete, duplicated or not stopped at the 20-night minimum');
  }
  if (expected.size) throw new Error('Pilot inventory is incomplete, duplicated or not stopped at the 20-night minimum');
}
export async function runStoppedRehearsal(client: Client, persist: (receipt: RehearsalReceipt) => Promise<void>): Promise<RehearsalReceipt> {
  const steps = bookingRehearsal();
  if (steps.some((step) => !step.passed)) throw new Error('Local booking rehearsal failed; no network writes permitted');
  verifyClosed(await client.readSnapshot()); // Also checks identities, stop-sell defaults and zero channel mappings.
  const receipt: RehearsalReceipt = { version: 1, environment: 'channex-staging', synthetic: true, state: 'running', startedAt: new Date().toISOString(), finishedAt: null, steps: [], cleanup: 'pending', finalStoppedNights: null };
  await persist(receipt); // No writes if we cannot record the run first.
  const zero: AvailabilityDay[] = ['front', 'back'].flatMap((member) => REHEARSAL_DATES.map((date) => ({ member: member as 'front' | 'back', date, availability: 0, blockers: ['rehearsal-cleanup'] })));
  try {
    for (const step of steps) {
      const result = await client.publishStoppedInventory(step.inventory);
      if (result.verifiedNights !== 6) throw new Error('Rehearsal did not verify all six test unit-nights');
      receipt.steps.push({ id: step.id, verifiedUnitNights: result.verifiedNights });
      await persist(receipt);
    }
  } catch (error) {
    receipt.state = 'failed';
    throw error;
  } finally {
    try {
      // Deterministic cleanup is safe to repeat after interruption. No stop-sell clearing exists.
      const cleanup = await client.publishStoppedInventory(zero);
      if (cleanup.verifiedNights !== 6) throw new Error('Rehearsal cleanup read-back is incomplete');
      const snapshot = await client.readSnapshot();
      verifyClosed(snapshot);
      if (snapshot.inventory.some((night) => REHEARSAL_DATES.includes(night.date) && night.inventory !== 0)) throw new Error('Rehearsal cleanup inventory was not zero');
      receipt.cleanup = 'verified'; receipt.finalStoppedNights = 240;
    } catch {
      receipt.cleanup = 'failed'; receipt.state = 'failed';
    }
    receipt.finishedAt = new Date().toISOString();
    receipt.state = receipt.state === 'running' && receipt.cleanup === 'verified' ? 'passed' : 'failed';
    await persist(receipt);
    if (receipt.cleanup === 'failed') throw new Error('Staging cleanup could not be verified; keep the pilot closed and inspect before continuing');
  }
  return receipt;
}
