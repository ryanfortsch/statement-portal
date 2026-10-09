import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { bookingRehearsal, REHEARSAL_DATES } from '../channex-staging/rehearsal.ts';
import { runStoppedRehearsal, type RehearsalReceipt } from '../channex-staging/rehearsal-runner.ts';
import { importStagingRevisions, type StagingSnapshot } from '../channex-staging/client.ts';
import { nights, TEST_START, TEST_END, applyRevision, emptyLedger, availability, type AvailabilityDay, type Revision } from '../channex-staging/core.ts';
import { loadLedger, saveLedger, withJournalLock } from '../channex-staging/journal.ts';

const steps = bookingRehearsal();
const get = (id: string) => steps.find((step) => step.id === id)!;
const at = (id: string, date: string) => (['whole', 'front', 'back'] as const).map((member) => get(id).inventory.find((day) => day.member === member && day.date === date)!.availability);

test('all 15 rehearsal transitions match their independently specified night-by-night expectations', () => {
  assert.equal(steps.length, 15);
  assert.ok(steps.every((step) => step.passed), JSON.stringify(steps.filter((step) => !step.passed)));
  assert.ok(steps.every((step) => step.cells.length === 9 && step.inventory.length === 9));
  assert.deepEqual(at('whole-moved', '2027-02-01'), [1, 1, 1]);
  assert.deepEqual(at('whole-moved', '2027-02-03'), [0, 0, 0]);
});
test('independent maintenance and sibling bookings survive cancellation in the full board pipeline', () => {
  assert.deepEqual(at('hold-survives', '2027-02-01'), [1, 1, 1]);
  assert.deepEqual(at('hold-survives', '2027-02-02'), [0, 0, 0]);
  assert.deepEqual(at('hold-survives', '2027-02-03'), [1, 1, 1]);
  assert.deepEqual(at('back-long-stay', '2027-02-03'), [0, 1, 0]);
  assert.deepEqual(at('back-cancelled', '2027-02-03'), [0, 0, 1]);
  assert.deepEqual(at('delayed-replay', '2027-02-03'), [1, 1, 1]);
});
test('source gaps are explicitly unverified and close only the affected scope', () => {
  assert.ok(get('stale-parent').cells.every((cell) => cell.state === 'unknown'));
  assert.ok(get('stale-parent').inventory.every((day) => day.availability === 0));
  assert.ok(get('unit-outage').cells.every((cell) => cell.state === 'unknown'));
  assert.equal(get('missing-night').cells.filter((cell) => cell.state === 'unknown').length, 3);
  assert.deepEqual(at('missing-night', '2027-02-02'), [0, 0, 0]);
  assert.deepEqual(at('missing-night', '2027-02-03'), [1, 1, 1]);
  assert.deepEqual(at('recovered', '2027-02-02'), [1, 1, 1]);
});
test('parallel unit stays are valid but whole-house overlaps are retained and flagged', () => {
  assert.equal(get('both-units').overlapNights, 0);
  assert.equal(get('conflicting-bookings').overlapNights, 20);
  assert.ok(get('conflicting-bookings').cells.every((cell) => cell.overlap));
});
test('Jan-Apr boundaries and DST retain checkout-exclusive physical inventory', () => {
  const revision: Revision = { id: 'boundary', bookingId: 'boundary', member: 'back', status: 'new', checkIn: '2027-03-13', checkOut: '2027-05-02', receivedAt: '2026-09-30T12:00:00Z' };
  const ledger = applyRevision(emptyLedger(), revision).ledger;
  assert.equal(nights('2027-03-13', '2027-03-16').length, 3);
  const days = availability(ledger, [], '2027-04-30', '2027-05-03', { whole: true, front: true, back: true });
  assert.equal(days.find((day) => day.date === '2027-05-01' && day.member === 'whole')!.availability, 0);
  assert.equal(days.find((day) => day.date === '2027-05-02' && day.member === 'whole')!.availability, 1);
  assert.ok(days.filter((day) => day.date >= '2027-05-01' && day.member !== 'whole').every((day) => day.availability === 0 && day.blockers.includes('outside-pilot-season')));
});

function fakeClient(options: { failWrite?: number; failCleanup?: boolean; finalMismatch?: boolean } = {}) {
  const snapshot: StagingSnapshot = { mappings: [], bookings: [], inventory: (['front', 'back'] as const).flatMap((unit) => nights(TEST_START, TEST_END).map((date) => ({ unit, date, inventory: 1, stopSell: true, minStay: 20 }))) };
  const writes: AvailabilityDay[][] = [];
  let reads = 0;
  return { snapshot, writes,
    readSnapshot: async () => {
      reads++;
      const copy = structuredClone(snapshot);
      if (reads > 1 && options.finalMismatch) copy.inventory[31].stopSell = false;
      return copy;
    },
    publishStoppedInventory: async (days: AvailabilityDay[]) => {
      writes.push(structuredClone(days));
      const cleanup = days.every((day) => day.blockers.includes('rehearsal-cleanup'));
      if (writes.length === options.failWrite || (cleanup && options.failCleanup)) throw new Error('Injected API failure');
      for (const day of days.filter((day) => day.member !== 'whole')) snapshot.inventory.find((night) => night.unit === day.member && night.date === day.date)!.inventory = day.availability;
      return { verifiedNights: 6 };
    },
  };
}

test('API runner verifies every step and finishes at zero inventory with all 240 unit-nights stopped', async () => {
  const client = fakeClient(), receipts: RehearsalReceipt[] = [];
  const receipt = await runStoppedRehearsal(client, async (r) => { receipts.push(structuredClone(r)); });
  assert.equal(receipt.state, 'passed'); assert.equal(receipt.steps.length, 15);
  assert.equal(receipt.cleanup, 'verified'); assert.equal(receipt.finalStoppedNights, 240);
  assert.equal(client.writes.length, 16);
  assert.ok(client.writes.flat().every((day) => REHEARSAL_DATES.includes(day.date)));
  assert.ok(client.writes.at(-1)!.every((day) => day.availability === 0));
  assert.equal(receipts[0].state, 'running'); assert.equal(receipts[0].steps.length, 0);
});
test('preflight refuses active stays, missing nights, duplicates, open rates and changed minimums before writing', async () => {
  for (const fault of ['booking', 'missing', 'duplicate', 'open', 'minimum']) {
    const client = fakeClient();
    if (fault === 'booking') client.snapshot.bookings.push({ id: 'r', bookingId: 'b', member: 'back', status: 'new', checkIn: '2027-02-01', checkOut: '2027-03-01', receivedAt: '2026-09-30T12:00:00Z' });
    if (fault === 'missing') client.snapshot.inventory.pop();
    if (fault === 'duplicate') client.snapshot.inventory[1] = client.snapshot.inventory[0];
    if (fault === 'open') client.snapshot.inventory[0].stopSell = false;
    if (fault === 'minimum') client.snapshot.inventory[0].minStay = 2;
    await assert.rejects(() => runStoppedRehearsal(client, async () => undefined));
    assert.equal(client.writes.length, 0, fault);
  }
});
test('a failed receipt save before the run permits no API writes', async () => {
  const client = fakeClient();
  await assert.rejects(() => runStoppedRehearsal(client, async () => { throw new Error('disk'); }), /disk/);
  assert.equal(client.writes.length, 0);
});
test('mid-run API failure triggers zero-inventory cleanup and never records a passing run', async () => {
  const client = fakeClient({ failWrite: 3 }), receipts: RehearsalReceipt[] = [];
  await assert.rejects(() => runStoppedRehearsal(client, async (r) => { receipts.push(structuredClone(r)); }), /Injected/);
  assert.equal(client.writes.length, 4);
  assert.ok(client.writes.at(-1)!.every((day) => day.availability === 0));
  assert.equal(receipts.at(-1)!.state, 'failed'); assert.equal(receipts.at(-1)!.cleanup, 'verified');
});
test('mid-run receipt failure still attempts cleanup and records failure when storage recovers', async () => {
  const client = fakeClient(), receipts: RehearsalReceipt[] = [];
  let writes = 0;
  await assert.rejects(() => runStoppedRehearsal(client, async (r) => {
    if (++writes === 2) throw new Error('disk interruption');
    receipts.push(structuredClone(r));
  }), /disk interruption/);
  assert.equal(client.writes.length, 2); assert.ok(client.writes.at(-1)!.every((day) => day.availability === 0));
  assert.equal(receipts.at(-1)!.state, 'failed');
});
test('cleanup failures and final stop-sell mismatches remain blocked', async () => {
  for (const options of [{ failCleanup: true }, { finalMismatch: true }]) {
    const client = fakeClient(options), receipts: RehearsalReceipt[] = [];
    await assert.rejects(() => runStoppedRehearsal(client, async (r) => { receipts.push(structuredClone(r)); }), /cleanup could not be verified/);
    assert.equal(receipts.at(-1)!.state, 'failed'); assert.equal(receipts.at(-1)!.cleanup, 'failed');
    assert.equal(receipts.at(-1)!.finalStoppedNights, null);
  }
});
test('process exit after durable save preserves replay and leaves the lock for operator inspection', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'helm-rehearsal-crash-')), path = join(dir, 'ledger.json');
  const revision: Revision = { id: 'crash-revision', bookingId: 'crash-booking', member: 'back', status: 'new', checkIn: '2027-02-01', checkOut: '2027-03-01', receivedAt: '2026-09-30T12:00:00.000001Z' };
  try {
    const script = `
      import { importStagingRevisions } from ${JSON.stringify(new URL('../channex-staging/client.ts', import.meta.url).href)};
      import { loadLedger, saveLedger, withJournalLock } from ${JSON.stringify(new URL('../channex-staging/journal.ts', import.meta.url).href)};
      const path = ${JSON.stringify(path)}, revision = ${JSON.stringify(revision)};
      await withJournalLock(path, async () => importStagingRevisions({ readRevisions: async () => [revision], acknowledge: async () => process.exit(23) }, await loadLedger(path), (ledger) => saveLedger(path, ledger)));
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8', timeout: 10000 });
    assert.equal(child.status, 23, child.stderr);
    assert.equal((await loadLedger(path)).revisions.length, 1);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    await assert.rejects(() => withJournalLock(path, async () => undefined), { code: 'EEXIST' });
    // Explicit test-owned operator recovery, never automatic lock stealing.
    await unlink(`${path}.lock`);
    let acknowledgements = 0;
    const result = await withJournalLock(path, async () => importStagingRevisions({ readRevisions: async () => [revision], acknowledge: async () => { acknowledgements++; } }, await loadLedger(path), (ledger) => saveLedger(path, ledger)));
    assert.equal(result.duplicate, 1); assert.equal(acknowledgements, 1);
    assert.equal((await loadLedger(path)).revisions.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
