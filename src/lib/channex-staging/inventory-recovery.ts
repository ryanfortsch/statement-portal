/** Explicit recovery of a prepared staging window. No configuration edits,
 * source renewal, background loop or price/restriction writes. */
import { z } from 'zod';
import { verifyInventoryArchive, type InventoryArchiveStore } from './inventory-archive.ts';
import { bookingInventorySnapshot, consumeBookingInventory, parseBookingInventoryState, type BookingInventoryConsumerStore, type BookingInventoryState } from './booking-inventory-consumer.ts';
import { replayInventoryJournal } from './inventory-journal.ts';
import { runBookingInventoryCycle } from './booking-inventory-cycle.ts';
import type { ChannexAvailabilityClient } from './availability-client.ts';
import { CALDERWOOD_STAGING } from '../calderwood-readonly/channex.ts';

export const recoveryBinding = z.object({ id: z.string().regex(/^projection-[a-f0-9]{64}$/), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export function inventoryRecoveryAllowed(email: string | null | undefined, env: Record<string, string | undefined>) {
  return email === 'ryan@risingtidestr.com' && env.VERCEL_ENV === 'preview'
    && env.VERCEL_GIT_COMMIT_REF === 'codex/channex-staging-pilot'
    && env.CHANNEX_STAGING_ENABLED === 'true' && env.CHANNEX_INVENTORY_RECOVERY_ENABLED === 'true'
    && env.CHANNEX_STAGING_DB_PROJECT_REF === 'jgkblfozftcvymvwhhii'
    && env.CHANNEX_STAGING_DB_URL === 'https://jgkblfozftcvymvwhhii.supabase.co';
}
export function assertRecoveryWindow(state: BookingInventoryState) {
  const c = state.configuration;
  if (state.property !== 'HELMTEST-calderwood' || c.connection !== 'calderwood-hosted-inventory'
    || c.generation !== 1 || c.listing !== CALDERWOOD_STAGING.roomTypeId
    || c.requiredSources.length !== 1 || c.requiredSources[0] !== 'channex-staging-bookings'
    || state.inputs.authority !== 'helm' || state.inputs.plan?.booking_window_days !== 365
    || Date.parse(c.end) - Date.parse(c.start) !== 500 * 86400000) {
    throw Error('A reviewed 500-day staging recovery window is required');
  }
}
export function inventoryRecoveryView(state: BookingInventoryState) {
  const jobs = replayInventoryJournal(state.journal).queue.list();
  const job = jobs.filter(j => j.days.length === 500).at(-1);
  return { start: state.configuration.start, end: state.configuration.end,
    days: (Date.parse(state.configuration.end) - Date.parse(state.configuration.start)) / 86400000,
    publishEnabled: state.configuration.publishEnabled,
    unresolvedDeliveries: jobs.filter(j => !['pending', 'verified', 'superseded'].includes(j.status))
      .map(j => ({ id: j.id, status: j.status, task: j.task ?? null,
        firstDate: j.days[0].date, lastDate: j.days.at(-1)!.date })),
    job: job ? { id: job.id, digest: job.digest, status: job.status, task: job.task ?? null,
      firstDate: job.days[0].date, lastDate: job.days.at(-1)!.date,
      availableDays: job.days.filter(d => d.available === 1).length } : null };
}
type RecoveryStore = BookingInventoryConsumerStore & Partial<Pick<InventoryArchiveStore, 'readArchive'>>;
async function assertRecoveryCooldown(store: RecoveryStore, state: BookingInventoryState, now: number, except?: string) {
  const replay = replayInventoryJournal(state.journal);
  let jobs = replay.queue.list();
  let previous = replay.journal.format === 2 ? replay.journal.archiveId : null;
  const seen = new Set<string>();
  for (;;) {
    if (jobs.some(job => job.id !== except && job.request && JSON.parse(job.request.body).values.length === 500
        && now - job.request.preparedAt < 86400000)) throw Error('A full sync was already attempted within 24 hours');
    if (!previous) return;
    if (!store.readArchive || seen.has(previous) || seen.size >= 32) throw Error('Recovery history needs review');
    seen.add(previous);
    const archive = await store.readArchive(previous);
    if (!archive || archive.id !== previous) throw Error('Recovery history unavailable');
    const verified = verifyInventoryArchive(archive);
    jobs = verified.jobs; previous = verified.previous;
  }
}
export async function prepareInventoryRecovery(store: RecoveryStore, clock = Date.now) {
  const state = parseBookingInventoryState(await store.read(), store.property);
  assertRecoveryWindow(state);
  if (!state.configuration.publishEnabled || !bookingInventorySnapshot(state, clock())) throw Error('Complete fresh source coverage and publishing authority required');
  const jobs = replayInventoryJournal(state.journal).queue.list();
  // Preserve any in-flight intent. Preparing never expires a lease or replays IO.
  if (jobs.some(j => !['pending', 'verified', 'superseded'].includes(j.status))) {
    throw Error('An existing delivery needs reconciliation');
  }
  // Archived attempts retain the same one-day cooldown after maintenance.
  await assertRecoveryCooldown(store, state, clock());
  const result = await consumeBookingInventory(store, clock, { forceEnqueue: jobs.at(-1)?.status === 'verified' });
  if (!['queued', 'unchanged', 'refreshed'].includes(result.status)) throw Error('Recovery plan changed; review again');
  const current = parseBookingInventoryState(await store.read(), store.property);
  assertRecoveryWindow(current);
  const job = replayInventoryJournal(current.journal).queue.list().at(-1);
  if (!job || job.days.length !== 500 || job.status !== 'pending' || job.version !== current.planVersion) {
    throw Error('No pending recovery intent; existing receipts are retained');
  }
  return inventoryRecoveryView(current);
}
export async function executeInventoryRecovery(store: RecoveryStore, client: ChannexAvailabilityClient,
  raw: unknown, verifyIsolation: (state: BookingInventoryState) => Promise<void>, clock = Date.now) {
  const binding = recoveryBinding.parse(raw);
  const state = parseBookingInventoryState(await store.read(), store.property);
  const job = replayInventoryJournal(state.journal).queue.list().find(j => j.id === binding.id && j.digest === binding.digest && j.days.length === 500);
  if (!job) throw Error('Reviewed recovery intent unavailable');
  // Completed work is terminal; task checks never create replacement jobs.
  if (job.status === 'verified') {
    if (!job.request || JSON.parse(job.request.body).values.length !== 500) throw Error('Existing task is not a full sync');
    return { phase: 'reconcile', status: 'verified' };
  }
  if (!['pending', 'submitted', 'uncertain'].includes(job.status)) throw Error('Existing recovery attempt needs review');
  assertRecoveryWindow(state);
  if (job.status === 'pending') {
    if (!state.configuration.publishEnabled || !bookingInventorySnapshot(state, clock()) || job.version !== state.planVersion || !state.inputsMatchPlan
        || state.plannedCaptureVersion !== state.captureVersion || state.plannedConfigurationVersion !== state.configurationVersion) {
      throw Error('Recovery inputs changed; review again');
    }
    await assertRecoveryCooldown(store, state, clock(), job.id);
    await verifyIsolation(state);
  }
  return runBookingInventoryCycle(store, client, clock, binding);
}
