import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PILOTS, TEST_RATE_TITLE, emptyLedger, applyRevision, availability, conflicts, latestBookings, normalizeRevision, parseLedger, nights, revisionTime, syntheticScenario, type Revision } from '../channex-staging/core.ts';
import { ChannexStagingClient, importStagingRevisions } from '../channex-staging/client.ts';
import { loadLedger, saveLedger, withJournalLock } from '../channex-staging/journal.ts';
const full = { whole: true, front: true, back: true };
const revision = (over: Partial<Revision> = {}): Revision => ({ id: 'r1', bookingId: 'b1', member: 'back', status: 'new', checkIn: '2027-02-01', checkOut: '2027-03-01', receivedAt: '2026-09-30T12:00:00.000001Z', ...over });
const ledger = (...rows: Revision[]) => rows.reduce((state, r) => applyRevision(state, r).ledger, emptyLedger());
const on = (rows: Revision[], date = '2027-02-01') => availability(ledger(...rows), [], date, new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10), full).map((r) => r.availability);
const raw = () => ({ id: 'r1', attributes: { booking_id: 'b1', property_id: PILOTS.back.propertyId, ota_name: 'Offline', ota_reservation_code: 'HELMTEST-back', status: 'new', arrival_date: '2027-02-01', departure_date: '2027-03-01', inserted_at: '2026-09-30T12:00:00.000001', rooms: [{ room_type_id: PILOTS.back.roomTypeId, checkin_date: '2027-02-01', checkout_date: '2027-03-01' }], customer: { name: 'Not retained' }, guarantee: { card_number: 'Not retained' } } });

test('whole house closes both units; units never close each other', () => {
  assert.deepEqual(on([revision({ member: 'whole' })]), [0, 0, 0]);
  assert.deepEqual(on([revision()]), [0, 1, 0]);
  assert.deepEqual(on([revision({ member: 'front' })]), [0, 0, 1]);
});
test('cancelling back retains front occupancy on whole house', () => {
  const rows = [revision(), revision({ id: 'f1', bookingId: 'f', member: 'front' }), revision({ id: 'r2', status: 'cancelled', receivedAt: '2026-09-30T12:01:00Z' })];
  assert.deepEqual(on(rows), [0, 0, 1]);
  rows.push(revision({ id: 'f2', bookingId: 'f', member: 'front', status: 'cancelled', receivedAt: '2026-09-30T12:02:00Z' }));
  assert.deepEqual(on(rows), [1, 1, 1]);
});
test('checkout is exclusive and a moved booking releases only its previous nights', () => {
  assert.deepEqual(on([revision()], '2027-03-01'), [1, 1, 1]);
  const moved = revision({ id: 'r2', status: 'modified', checkIn: '2027-03-01', checkOut: '2027-04-01', receivedAt: '2026-09-30T12:01:00Z' });
  assert.deepEqual(on([revision(), moved]), [1, 1, 1]);
  assert.deepEqual(on([revision(), moved], '2027-03-01'), [0, 1, 0]);
});
test('owner or maintenance holds survive booking cancellations and block linked listings', () => {
  const state = ledger(revision(), revision({ id: 'cancel', status: 'cancelled', receivedAt: '2026-09-30T12:01:00Z' }));
  const days = availability(state, [{ id: 'owner-hold', member: 'back', checkIn: '2027-02-01', checkOut: '2027-02-03' }], '2027-02-01', '2027-02-02', full);
  assert.deepEqual(days.map((r) => r.availability), [0, 1, 0]);
  assert.deepEqual(days[0].blockers, ['owner-hold']);
  assert.deepEqual(availability(state, [{ id: 'repair', member: 'whole', checkIn: '2027-02-01', checkOut: '2027-02-03' }], '2027-02-01', '2027-02-02', full).map((r) => r.availability), [0, 0, 0]);
});
test('missing sources close all inventory; outside Jan-Apr units stay closed', () => {
  assert.deepEqual(availability(emptyLedger(), [], '2027-02-01', '2027-02-02', { ...full, whole: false }).map((r) => r.availability), [0, 0, 0]);
  assert.deepEqual(on([], '2027-05-01'), [1, 0, 0]);
  assert.deepEqual(on([], '2026-12-31'), [1, 0, 0]);
});
test('duplicate is idempotent and stale revisions cannot resurrect a cancelled booking', () => {
  const first = ledger(revision());
  assert.equal(applyRevision(first, revision()).outcome, 'duplicate');
  const cancelled = applyRevision(first, revision({ id: 'cancel', status: 'cancelled', receivedAt: '2026-09-30T12:02:00Z' })).ledger;
  const stale = applyRevision(cancelled, revision({ id: 'late-modified', status: 'modified', receivedAt: '2026-09-30T12:01:00Z' }));
  assert.equal(stale.outcome, 'stale');
  assert.equal(latestBookings(stale.ledger)[0].status, 'cancelled');
});
test('microsecond ordering is preserved; ambiguous revisions and reused IDs fail closed', () => {
  assert.equal(revisionTime('2026-09-30T12:00:00.1'), '2026-09-30T12:00:00.100000Z');
  const state = ledger(revision());
  assert.throws(() => applyRevision(state, revision({ checkOut: '2027-04-01' })), /reused/);
  assert.throws(() => applyRevision(state, revision({ id: 'same-time' })), /Ambiguous/);
  const result = applyRevision(state, revision({ id: 'newer', status: 'cancelled', receivedAt: '2026-09-30T12:00:00.000002Z' }));
  assert.equal(latestBookings(result.ledger)[0].status, 'cancelled');
});
test('conflicts include same-unit and whole/unit but permit parallel unit stays', () => {
  const front = revision({ id: 'front', bookingId: 'front', member: 'front' });
  assert.deepEqual(conflicts(ledger(revision(), front)), []);
  assert.equal(conflicts(ledger(revision(), front, revision({ id: 'whole', bookingId: 'whole', member: 'whole' }))).length, 2);
  assert.equal(conflicts(ledger(revision(), revision({ id: 'back2', bookingId: 'back2' }))).length, 1);
});
test('reject malformed calendar dates, oversized ranges, invalid members and timestamps', () => {
  for (const [a, b] of [['2027-02-30', '2027-03-03'], ['2027-02-01', '2027-02-01'], ['2027-01-01', '2029-01-01']]) assert.throws(() => nights(a, b));
  for (const stamp of ['2026-09-30T25:00:00', '2026-02-30T12:00:00', 'bad']) assert.throws(() => revisionTime(stamp));
  assert.throws(() => ledger(revision({ member: 'unknown' as 'back' })));
  assert.throws(() => parseLedger({ version: 2, revisions: [] }));
});
test('normalization discards guest and payment data, requires exact pilot identity and synthetic marker', () => {
  const result = normalizeRevision(raw());
  assert.equal(result.member, 'back');
  assert.doesNotMatch(JSON.stringify(result), /customer|guarantee|retained|card/);
  const otherProperty = raw(); otherProperty.attributes.property_id = 'other' as typeof PILOTS.back.propertyId;
  assert.throws(() => normalizeRevision(otherProperty), /outside/);
  const wrongRoom = raw(); wrongRoom.attributes.rooms[0].room_type_id = PILOTS.front.roomTypeId as typeof PILOTS.back.roomTypeId;
  assert.throws(() => normalizeRevision(wrongRoom), /mapping/);
  const real = raw(); real.attributes.ota_name = 'Airbnb';
  assert.throws(() => normalizeRevision(real), /Non-synthetic/);
  const noMarker = raw(); noMarker.attributes.ota_reservation_code = 'ordinary-booking';
  assert.throws(() => normalizeRevision(noMarker), /Non-synthetic/);
  const multi = raw(); multi.attributes.rooms.push(multi.attributes.rooms[0]);
  assert.throws(() => normalizeRevision(multi), /multi-room/);
});
test('six-step demonstration has the expected availability transitions', () => {
  assert.deepEqual(syntheticScenario().map((s) => [s.whole, s.front, s.back]), [[0,0,0], [1,1,1], [0,1,0], [0,0,0], [0,0,1], [1,1,1]]);
});

test('failed durable save never acknowledges; ACK failure can replay without duplicating', async () => {
  let saved = emptyLedger(), acknowledgements = 0;
  const api = { readRevisions: async () => [revision()], acknowledge: async () => { acknowledgements++; throw new Error('network'); } };
  await assert.rejects(() => importStagingRevisions(api, saved, async () => { throw new Error('disk'); }), /disk/);
  assert.equal(acknowledgements, 0);
  await assert.rejects(() => importStagingRevisions(api, saved, async (value) => { saved = value; }), /network/);
  assert.equal(saved.revisions.length, 1);
  const result = await importStagingRevisions({ ...api, acknowledge: async () => { acknowledgements++; } }, saved, async (value) => { saved = value; });
  assert.equal(result.duplicate, 1); assert.equal(result.acknowledged, 1); assert.equal(saved.revisions.length, 1);
});
test('a malformed batch produces no partial persistence or acknowledgements', async () => {
  let touched = false;
  const api = { readRevisions: async () => [revision(), revision({ id: 'bad', checkIn: 'bad' })], acknowledge: async () => { touched = true; } };
  await assert.rejects(() => importStagingRevisions(api, emptyLedger(), async () => { touched = true; }));
  assert.equal(touched, false);
});
test('journal survives reload, is private, and rejects concurrent writers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'helm-channex-test-')), path = join(dir, 'ledger.json');
  try {
    assert.deepEqual(await loadLedger(path), emptyLedger());
    await withJournalLock(path, async () => {
      await assert.rejects(() => withJournalLock(path, async () => undefined), { code: 'EEXIST' });
      await saveLedger(path, ledger(revision()));
    });
    assert.equal((await loadLedger(path)).revisions.length, 1);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.doesNotMatch(await readFile(path, 'utf8'), /customer|guarantee/);
    await withJournalLock(path, async () => undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

const rateId = '00000000-0000-4000-8000-000000000001';
function fakeApi(options: { channel?: boolean; warn?: boolean; readBackMismatch?: boolean; pages?: boolean } = {}) {
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const fake = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)); calls.push({ url, init });
    const unit = url.pathname.includes(PILOTS.back.propertyId) || url.pathname.includes(PILOTS.back.roomTypeId) || url.searchParams.get('filter[property_id]') === PILOTS.back.propertyId ? 'back' : 'front';
    const p = PILOTS[unit];
    let body: unknown;
    const rel = { property: { data: { id: p.propertyId } }, room_type: { data: { id: p.roomTypeId } } };
    if (init?.method === 'POST') body = { data: [{ id: 'task' }], meta: { message: 'Success', warnings: options.warn ? [{ warning: 'invalid' }] : [] } };
    else if (url.pathname.includes('/properties/')) body = { data: { id: p.propertyId, attributes: { title: `17 Beach - ${unit} (Staging)`, currency: 'USD', timezone: 'America/New_York' } } };
    else if (url.pathname.includes('/room_types/')) body = { data: { id: p.roomTypeId, attributes: { count_of_rooms: 1, occ_adults: p.capacity }, relationships: rel } };
    else if (url.pathname.endsWith('/availability')) body = { data: { [p.roomTypeId]: { '2027-02-01': options.readBackMismatch ? 9 : 0 } } };
    else if (url.pathname.endsWith('/restrictions')) body = { data: { [rateId]: { '2027-02-01': { rate: '100.00', stop_sell: true, min_stay_arrival: 20, min_stay_through: 1 } } } };
    else if (url.pathname.endsWith('/rate_plans')) body = { data: [{ id: rateId, attributes: { title: TEST_RATE_TITLE, currency: 'USD', stop_sell: Array(7).fill(true) }, relationships: rel }], meta: { page: 1, total: 1, limit: 100 } };
    else if (url.pathname.endsWith('/booking_revisions/feed')) {
      const page = Number(url.searchParams.get('pagination[page]'));
      const r = raw(); r.id = `r${page}`;
      body = { data: unit === 'back' ? [r] : [], meta: { page, total: unit === 'back' ? (options.pages ? 2 : 1) : 0, limit: options.pages ? 1 : 100 } };
    } else body = { data: options.channel ? [{ id: 'attached-channel' }] : [], meta: { page: 1, total: options.channel ? 1 : 0, limit: 100 } };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { calls, client: new ChannexStagingClient('unit-test-secret', fake) };
}
test('requests use only staging, private header auth, no redirects or cache', async () => {
  const { client, calls } = fakeApi();
  const status = await client.inspect(); assert.equal(status.length, 2);
  for (const call of calls) {
    assert.equal(call.url.origin, 'https://staging.channex.io');
    assert.doesNotMatch(call.url.href, /unit-test-secret/);
    assert.equal(call.init?.redirect, 'error'); assert.equal(call.init?.cache, 'no-store');
    assert.equal((call.init?.headers as Record<string, string>)['user-api-key'], 'unit-test-secret');
  }
});
test('any attached channel blocks inventory changes before the first POST', async () => {
  const { client, calls } = fakeApi({ channel: true });
  const days = availability(emptyLedger(), [], '2027-02-01', '2027-02-02', full);
  await assert.rejects(() => client.publishStoppedInventory(days), /channel is attached/);
  assert.equal(calls.filter((r) => r.init?.method === 'POST').length, 0);
});
test('stopped inventory sends correct currency units and verifies read-back', async () => {
  const { client, calls } = fakeApi();
  const days = availability(ledger(revision({ member: 'whole' })), [], '2027-02-01', '2027-02-02', full);
  assert.deepEqual(await client.publishStoppedInventory(days), { verifiedNights: 2 });
  const posts = calls.filter((r) => r.init?.method === 'POST');
  assert.match(posts[0].url.pathname, /restrictions$/);
  const values = JSON.parse(String(posts[0].init?.body)).values;
  assert.equal(values.length, 1);
  assert.equal(posts.length, 4);
  assert.match(posts[1].url.pathname, /restrictions$/);
  assert.match(posts[2].url.pathname, /availability$/);
  for (const post of posts) assert.equal(new Set(JSON.parse(String(post.init?.body)).values.map((v: {property_id: string}) => v.property_id)).size, 1, 'one property per request');
  for (const value of values) { assert.equal(value.rate, '100.00'); assert.equal(value.min_stay_arrival, 20); assert.equal(value.stop_sell, true); }
});
test('HTTP 200 warnings are failures and stop subsequent availability writes', async () => {
  const { client, calls } = fakeApi({ warn: true });
  await assert.rejects(() => client.publishStoppedInventory(availability(emptyLedger(), [], '2027-02-01', '2027-02-02', full)), /rejected part/);
  assert.equal(calls.filter((r) => r.init?.method === 'POST').length, 1);
});
test('invalid inventory batches never reach the network', async () => {
  const { client, calls } = fakeApi();
  await assert.rejects(() => client.publishStoppedInventory([{ member: 'front', date: '2027-02-01', availability: 1, blockers: [] }]), /Both/);
  await assert.rejects(() => client.publishStoppedInventory([{ member: 'front', date: '2027-05-01', availability: 1, blockers: [] }]), /outside/);
  assert.equal(calls.length, 0);
});
test('revision collection paginates and normalizes without retaining customer fields', async () => {
  const { client } = fakeApi({ pages: true });
  const rows = await client.readRevisions(); assert.equal(rows.length, 2);
  assert.doesNotMatch(JSON.stringify(rows), /customer|guarantee/);
});
test('network and server failures do not leak secrets or response bodies', async () => {
  const key = 'secret-never-print';
  const client = new ChannexStagingClient(key, async () => new Response(key, { status: 401 }));
  await assert.rejects(() => client.inspect(), (e: Error) => /401/.test(e.message) && !e.message.includes(key));
  const down = new ChannexStagingClient(key, async () => { throw new Error(key); });
  await assert.rejects(() => down.inspect(), (e: Error) => /network/.test(e.message) && !e.message.includes(key));
  assert.throws(() => new ChannexStagingClient(''), /not configured/);
});
test('accepted tasks are not reported as verified when inventory read-back differs', async () => {
  const { client, calls } = fakeApi({ readBackMismatch: true });
  await assert.rejects(() => client.publishStoppedInventory(availability(emptyLedger(), [], '2027-02-01', '2027-02-02', full)), /read-back did not match/);
  assert.equal(calls.filter((r) => r.init?.method === 'POST').length, 4, 'no repeated writes while polling');
  assert.equal(calls.filter((r) => r.url.pathname.endsWith('/availability') && r.init?.method === 'GET').length, 8);
});
