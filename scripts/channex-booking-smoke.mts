/** Manual, restartable CRS exercise. Synthetic bookings only, no OTA or production access. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, open, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ChannexStagingClient, importStagingRevisions } from '../src/lib/channex-staging/client.ts';
import { PILOTS, availability, nights, record, textField, type Unit } from '../src/lib/channex-staging/core.ts';
import { loadLedger, saveLedger, withJournalLock } from '../src/lib/channex-staging/journal.ts';

const directory = resolve('.channex-staging');
const ledgerPath = resolve(directory, 'revisions.json');
const checkpointPath = resolve(directory, 'booking-smoke.json');
type Checkpoint = { run: string; next: number; pending: boolean; ids: Partial<Record<Unit, string>> };
const key = process.env.CHANNEX_STAGING_API_KEY ?? '';
const steps = [
  { unit: 'back', status: 'new', start: '2027-02-01', end: '2027-03-01', expected: [0, 1, 0] },
  { unit: 'front', status: 'new', start: '2027-02-01', end: '2027-02-21', expected: [0, 0, 0] },
  { unit: 'front', status: 'modified', start: '2027-02-10', end: '2027-03-02', expected: [0, 0, 0] },
  { unit: 'back', status: 'cancelled', start: '2027-02-01', end: '2027-03-01', expected: [0, 0, 1] },
  { unit: 'front', status: 'cancelled', start: '2027-02-10', end: '2027-03-02', expected: [1, 1, 1] },
] as const;
async function checkpoint(state: Checkpoint) {
  const temporary = `${checkpointPath}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(state)); await file.sync(); } finally { await file.close(); }
  await rename(temporary, checkpointPath);
  const dir = await open(directory, 'r'); try { await dir.sync(); } finally { await dir.close(); }
}
async function request(path: string, method = 'GET', body?: unknown) {
  // Paths are constructed below from the two allowlisted properties and validated UUIDs.
  let response: Response;
  try { response = await fetch(`https://staging.channex.io/api/v1${path}`, { method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000), headers: { 'user-api-key': key, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
  catch { throw new Error('Staging booking request interrupted; checkpoint retained.'); }
  if (!response.ok) throw new Error(`Staging booking request failed: HTTP ${response.status}; checkpoint retained.`);
  const result = record(await response.json());
  if (result.errors) throw new Error('Staging booking response has errors; checkpoint retained.');
  return result;
}
function checkedId(value: unknown): string {
  const id = textField(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('Unexpected booking UUID');
  return id;
}
async function findExisting(unit: Unit, code: string) {
  const matches: Record<string, unknown>[] = [];
  let foundCount = 0;
  for (let page = 1; page <= 20; page++) {
    const query = new URLSearchParams({ 'filter[property_id]': PILOTS[unit].propertyId, 'pagination[page]': String(page), 'pagination[limit]': '100' });
    const result = await request(`/bookings?${query}`), meta = record(result.meta);
    if (!Array.isArray(result.data) || !Number.isInteger(meta.total) || meta.page !== page) throw new Error('Invalid booking collection');
    for (const item of result.data) {
      const row = record(item), a = record(row.attributes);
      if (a.property_id !== PILOTS[unit].propertyId || a.ota_name !== 'Offline' || !String(a.ota_reservation_code).startsWith('HELMTEST-')) throw new Error('Non-test booking present; test stopped');
      if (a.ota_reservation_code === code) matches.push(row);
    }
    foundCount += result.data.length;
    if (foundCount === meta.total) {
      if (matches.length > 1) throw new Error('Duplicate test bookings require operator reconciliation');
      return matches[0];
    }
    if (!result.data.length || foundCount > (meta.total as number)) break;
  }
  throw new Error('Incomplete booking collection');
}
async function main() {
  if (!key || process.env.CHANNEX_STAGING_ALLOW_TEST_WRITES !== 'yes') throw new Error('A staging key and CHANNEX_STAGING_ALLOW_TEST_WRITES=yes are required');
  const client = new ChannexStagingClient(key);
  await withJournalLock(ledgerPath, async () => {
    let state: Checkpoint;
    try { state = JSON.parse(await readFile(checkpointPath, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; state = { run: randomUUID(), next: 0, pending: false, ids: {} }; await checkpoint(state); }
    checkedId(state.run);
    if (!Number.isInteger(state.next) || state.next < 0 || state.next > steps.length || typeof state.pending !== 'boolean' || !state.ids || typeof state.ids !== 'object') throw new Error('Invalid smoke checkpoint');
    if (state.next === steps.length) { console.log('Booking smoke already completed; no new bookings created.'); return; }
    for (; state.next < steps.length;) {
      const step = steps[state.next], unit = step.unit, code = `HELMTEST-${state.run}-${unit}`;
      const maps = await client.inspect(); // Stop-sell and no channels checked again for every mutation.
      const mapping = maps.find((m) => m.unit === unit)!;
      const existing = await findExisting(unit, code);
      const alreadyMatches = existing && record(existing.attributes).status === step.status && record(existing.attributes).arrival_date === step.start && record(existing.attributes).departure_date === step.end;
      if (!alreadyMatches) {
        if (step.status === 'new' && existing) throw new Error('Test create collides with an existing booking');
        if (step.status !== 'new' && (!existing || existing.id !== state.ids[unit])) throw new Error('Refusing to modify a booking not owned by this test run');
        if (step.status === 'new' && state.pending && !existing) throw new Error('Previous create outcome is uncertain; inspect Channex before retrying');
        state.pending = true; await checkpoint(state);
        const booking = { property_id: mapping.propertyId, ota_reservation_code: code, ota_name: 'Offline', ...(step.status === 'new' ? {} : { status: step.status }), arrival_date: step.start, departure_date: step.end, arrival_hour: '16:00', currency: 'USD', notes: 'HELM SYNTHETIC STAGING TEST - no real guest, payment, or OTA booking', customer: { name: 'Helm Test', surname: unit === 'front' ? 'Front Unit' : 'Back Unit' }, rooms: [{ room_type_id: mapping.roomTypeId, rate_plan_id: mapping.ratePlanId, days: Object.fromEntries(nights(step.start, step.end).map((date) => [date, '100.00'])), occupancy: { adults: 2, children: 0, infants: 0, ages: [] }, services: [], taxes: [] }] };
        const response = await request(step.status === 'new' ? '/bookings' : `/bookings/${checkedId(existing!.id)}`, step.status === 'new' ? 'POST' : 'PUT', { booking });
        state.ids[unit] = checkedId(record(response.data).id); await checkpoint(state);
      } else { state.ids[unit] = checkedId(existing.id); await checkpoint(state); }
      let verified = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        const current = await findExisting(unit, code);
        if (current && record(current.attributes).status === step.status && record(current.attributes).arrival_date === step.start && record(current.attributes).departure_date === step.end) { verified = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (!verified) throw new Error('Booking did not reach expected state; checkpoint retained');
      // Pull through the same adapter and durable journal used by the regular CLI.
      const imported = await importStagingRevisions(client, await loadLedger(ledgerPath), (ledger) => saveLedger(ledgerPath, ledger));
      const rows = imported.ledger.revisions.filter((r) => Object.values(state.ids).includes(r.bookingId));
      const days = availability({ version: 1, revisions: rows }, [], '2027-02-15', '2027-02-16', { whole: true, front: true, back: true });
      assert.deepEqual(days.map((d) => d.availability), step.expected, 'linked availability from received revisions');
      if (step.status === 'modified') assert.deepEqual(availability({ version: 1, revisions: rows }, [], '2027-02-05', '2027-02-06', { whole: true, front: true, back: true }).map((d) => d.availability), [0, 1, 0], 'moving front releases its old nights, not the whole house');
      console.log(JSON.stringify({ step: state.next + 1, unit, status: step.status, acknowledged: imported.acknowledged, linkedAvailability: days.map((d) => d.availability) }));
      state.next++; state.pending = false; await checkpoint(state);
    }
    const replay = await importStagingRevisions(client, await loadLedger(ledgerPath), (ledger) => saveLedger(ledgerPath, ledger));
    assert.equal(replay.acknowledged, 0, 'the feed is empty after ACK');
    console.log('PASS: new, concurrent unit bookings, date change, independent cancellations, and empty post-ACK feed. Both synthetic bookings are cancelled.');
  });
}
main().catch((error) => { console.error(error instanceof Error ? error.message : 'Booking smoke failed'); process.exitCode = 1; });
