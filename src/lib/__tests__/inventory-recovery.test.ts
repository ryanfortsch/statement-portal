import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inventoryRecoveryAllowed, prepareInventoryRecovery, executeInventoryRecovery, inventoryRecoveryView } from '../channex-staging/inventory-recovery.ts';
import type { BookingInventoryState, BookingInventoryConsumerStore } from '../channex-staging/booking-inventory-consumer.ts';
import { emptyInventoryJournal } from '../channex-staging/inventory-journal.ts';
import { ChannexAvailabilityClient } from '../channex-staging/availability-client.ts';
import { CALDERWOOD_STAGING as mapping } from '../calderwood-readonly/channex.ts';
import { shiftIsoDay } from '../sca-quotes-types.ts';
const now = Date.parse('2026-10-27T15:00:00Z');
const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'codex/channex-staging-pilot', CHANNEX_STAGING_ENABLED: 'true',
  CHANNEX_INVENTORY_RECOVERY_ENABLED: 'true', CHANNEX_STAGING_DB_PROJECT_REF: 'jgkblfozftcvymvwhhii',
  CHANNEX_STAGING_DB_URL: 'https://jgkblfozftcvymvwhhii.supabase.co' };
function fixture() {
  const start = '2026-10-27', end = shiftIsoDay(start, 500);
  const state: BookingInventoryState = { property: 'HELMTEST-calderwood', captureEnabled: true, captureVersion: 1, configurationVersion: 1,
    configuration: { environment: 'staging', topology: 'single-unit', connection: 'calderwood-hosted-inventory', listing: mapping.roomTypeId,
      generation: 1, publishEnabled: true, timeZone: 'America/New_York', start, end, requiredSources: ['channex-staging-bookings'],
      coverage: [{ source: 'channex-staging-bookings', start, end, complete: true, observedAt: now - 1000, freshUntil: now + 1800000 }] },
    plannedCaptureVersion: 0, plannedConfigurationVersion: 0, planVersion: 0, journalVersion: 0, journal: emptyInventoryJournal(),
    lastDigest: null, plannedFreshUntil: 0, inputsMatchPlan: false,
    inputs: { authority: 'helm', plan: { advance_notice_hours: 24, booking_window_days: 365, turnover_buffer_days: 0, checkin_time: '16:00' },
      bookings: [{ id: 'private-booking-id', status: 'confirmed', check_in: '2026-11-01', check_out: '2026-11-03', duplicate_of: null,
        hold_kind: null, source: 'manual', channel: 'manual' }], rateDays: [], periods: [] } };
  let writes = 0;
  const store: BookingInventoryConsumerStore = { property: state.property, read: async () => structuredClone(state),
    commit: async (expected, journal, freshUntil, digest) => {
      if (expected.planVersion !== state.planVersion || expected.journalVersion !== state.journalVersion) return false;
      state.journal = structuredClone(journal); state.journalVersion++; state.planVersion++; writes++;
      state.plannedCaptureVersion = state.captureVersion; state.plannedConfigurationVersion = state.configurationVersion;
      state.inputsMatchPlan = true; state.lastDigest = digest; state.plannedFreshUntil = freshUntil; return true;
    }, journal: { read: async () => ({ version: state.journalVersion, journal: state.journal }), append: async () => { throw Error('Unexpected dispatch'); } } };
  const client = new ChannexAvailabilityClient('synthetic', { environment: 'staging', helmProperty: state.property,
    connection: state.configuration.connection, generation: 1, propertyId: mapping.propertyId, roomTypeId: mapping.roomTypeId,
    propertyTitle: '65 Calderwood - Isolated Staging' }, async () => { throw Error('Unexpected provider IO'); }, () => now);
  return { state, store, client, writes: () => writes };
}
test('recovery is restricted to Ryan and the exact enabled isolated preview', () => {
  assert.equal(inventoryRecoveryAllowed('ryan@risingtidestr.com', env), true);
  for (const email of [undefined, 'dotti@risingtidestr.com', 'ryan@risingtidestr.com.evil']) assert.equal(inventoryRecoveryAllowed(email, env), false);
  for (const key of Object.keys(env)) assert.equal(inventoryRecoveryAllowed('ryan@risingtidestr.com', { ...env, [key]: '' }), false);
  assert.equal(inventoryRecoveryAllowed('ryan@risingtidestr.com', { ...env, VERCEL_ENV: 'production' }), false);
});
test('review prepares one durable 500-day intent without exposing bookings or changing policy', async () => {
  const f = fixture();
  const view = await prepareInventoryRecovery(f.store, () => now);
  const again = await prepareInventoryRecovery(f.store, () => now);
  assert.equal(view.days, 500); assert.equal(view.job?.status, 'pending'); assert.equal(view.job?.id, again.job?.id);
  assert.equal(f.writes(), 1); assert.equal(f.state.inputs.plan?.booking_window_days, 365);
  assert.doesNotMatch(JSON.stringify(view), /private-booking-id|coverage|inputs|bookings/);
  assert.equal(view.job?.lastDate, '2028-03-09');
});
test('parallel reviews cannot create competing intents', async () => {
  const f = fixture();
  const results = await Promise.allSettled([prepareInventoryRecovery(f.store, () => now), prepareInventoryRecovery(f.store, () => now)]);
  assert.equal(f.writes(), 1); assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
});
test('incomplete coverage, disabled publishing, wrong route and ordinary windows block review before writes', async () => {
  for (const mutate of [
    (s: BookingInventoryState) => { s.configuration.end = shiftIsoDay(s.configuration.start, 366); },
    (s: BookingInventoryState) => { s.configuration.coverage = []; },
    (s: BookingInventoryState) => { s.configuration.publishEnabled = false; },
    (s: BookingInventoryState) => { s.inputs.authority = 'guesty'; },
    (s: BookingInventoryState) => { s.configuration.generation = 2; },
    (s: BookingInventoryState) => { s.inputs.plan!.booking_window_days = 500; },
  ]) { const f = fixture(); mutate(f.state); await assert.rejects(prepareInventoryRecovery(f.store, () => now)); assert.equal(f.writes(), 0); }
});
test('changed source or configuration refuses execution before provider preflight', async () => {
  for (const mutate of [
    (s: BookingInventoryState) => { s.captureVersion++; },
    (s: BookingInventoryState) => { s.configurationVersion++; },
    (s: BookingInventoryState) => { s.inputsMatchPlan = false; },
    (s: BookingInventoryState) => { s.configuration.coverage[0].freshUntil = now - 1; },
  ]) {
    const f = fixture(); const { job } = await prepareInventoryRecovery(f.store, () => now); mutate(f.state);
    await assert.rejects(executeInventoryRecovery(f.store, f.client, { id: job!.id, digest: job!.digest }, async () => { assert.fail('preflight must not run'); }, () => now));
  }
});
test('isolation failure prevents dispatch and keeps the reviewed intent', async () => {
  const f = fixture(); const { job } = await prepareInventoryRecovery(f.store, () => now);
  await assert.rejects(executeInventoryRecovery(f.store, f.client, { id: job!.id, digest: job!.digest }, async () => { throw Error('Channel connected'); }, () => now), /Channel connected/);
  assert.equal(inventoryRecoveryView(f.state).job?.status, 'pending');
});
test('malformed or substituted browser bindings fail without provider IO', async () => {
  const f = fixture(); const { job } = await prepareInventoryRecovery(f.store, () => now);
  for (const binding of [{ id: job!.id, digest: '0'.repeat(64) }, { id: job!.id, digest: job!.digest, property: 'live' }, {}]) {
    await assert.rejects(executeInventoryRecovery(f.store, f.client, binding, async () => { assert.fail('No IO'); }, () => now));
  }
});

test('archived history cannot be silently skipped when checking recovery cooldown', async () => {
  const { prepareInventoryArchive } = await import('../channex-staging/inventory-archive.ts');
  const f = fixture(); await prepareInventoryRecovery(f.store, () => now);
  f.state.configuration.publishEnabled = false;
  const archive = prepareInventoryArchive(f.state);
  f.state.journal = archive.next;
  f.state.journalVersion = archive.next.format === 2 ? archive.next.baseVersion : 0;
  f.state.configuration.publishEnabled = true;
  await assert.rejects(prepareInventoryRecovery(f.store, () => now), /history needs review/);
});
