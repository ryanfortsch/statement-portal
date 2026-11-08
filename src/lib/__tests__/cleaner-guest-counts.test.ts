import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { enrichCleanerGuestCounts, resolveCleanerCountTargets, readCleanerCountReservation,
  type CleanerCountContext } from '../cleaner-guest-counts.ts';
import { GUESTY_ACCOUNT, GUESTY_CALDERWOOD } from '../channex-bookings/message-identity.ts';

const sourceId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
function context(): CleanerCountContext {
  return { authority: 'guesty',
    report: { propertyName: 'Synthetic home', from: '2030-01-01', through: '2031-01-01', stays: [{
      checkIn: '2030-02-10', checkOut: '2030-02-14', arrivalTime: '15:00', checkoutTime: '11:00',
      guests: null, staying: false, adjusted: false, noCleaning: false, needsReview: false,
    }] },
    bookings: [{ id: 'private-canonical-id', property_id: '65_calderwood', check_in: '2030-02-10', check_out: '2030-02-14',
      status: 'confirmed', duplicate_of: null, num_guests: null, guest_name: 'Private fixture', source: 'guesty_legacy',
      first_seen_at: null, last_seen_at: null, external_confirmation_code: 'SYNTHETIC-CODE' }],
    mirror: [{ guesty_reservation_id: sourceId, property_id: '65_calderwood', listing_id: GUESTY_CALDERWOOD,
      confirmation_code: 'SYNTHETIC-CODE', check_in: '2030-02-10', check_out: '2030-02-14', status: 'confirmed' }],
  };
}
const source = (extra: Record<string, unknown> = {}) => ({ _id: sourceId, accountId: GUESTY_ACCOUNT,
  listingId: GUESTY_CALDERWOOD, confirmationCode: 'SYNTHETIC-CODE', checkInDateLocalized: '2030-02-10',
  checkOutDateLocalized: '2030-02-14', status: 'confirmed', guestsCount: 7, privateGuestName: 'Do not project', ...extra });
const now = () => new Date('2030-01-01T12:00:00Z');

test('two matching reads enrich the private projection without changing inputs or copying private fields', async () => {
  const before = context(); const original = JSON.stringify(before); let reads = 0; let reloads = 0;
  const result = await enrichCleanerGuestCounts(before, {
    readReservation: async id => { assert.equal(id, sourceId); reads++; return source(); },
    reloadContext: async () => { reloads++; return context(); }, now,
  });
  assert.equal(reads, 2); assert.equal(reloads, 1);
  assert.equal(result.stays[0].guests, 7); assert.equal(result.stays[0].guestCountSource, 'guesty');
  assert.equal(result.stays[0].arrivalTime, '15:00');
  assert.deepEqual(result.guestCountCheck, { status: 'verified', checkedAt: now().toISOString() });
  assert.equal(JSON.stringify(before), original);
  assert.doesNotMatch(JSON.stringify(result), /private|SYNTHETIC-CODE|aaaaaaaa|accountId|listingId|Do not project/);
});
test('known counts and an empty report never read Guesty', async () => {
  for (const empty of [false, true]) {
    const before = context();
    if (empty) before.report.stays = [];
    else before.report.stays[0].guests = 2;
    const result = await enrichCleanerGuestCounts(before, {
      readReservation: async () => { throw Error('must not read'); }, reloadContext: async () => { throw Error('must not reload'); },
    });
    assert.equal(result, before.report);
  }
});
test('Helm authority, ambiguous IDs/codes, mismatched dates and unresolved dates stop before API access', async () => {
  const changes: Array<(c: CleanerCountContext) => void> = [
    c => { c.authority = 'helm'; },
    c => { c.bookings[0].external_confirmation_code = null; },
    c => { c.bookings.push({ ...c.bookings[0], id: 'different' }); },
    c => { c.report.stays[0].needsReview = true; },
    c => { c.report.stays[0].checkOut = '2030-02-15'; },
    c => { c.mirror = [...c.mirror as object[], ...(c.mirror as object[])]; },
    c => { c.mirror = [...c.mirror as object[], { ...(c.mirror as object[])[0], guesty_reservation_id: 'bbbbbbbbbbbbbbbbbbbbbbbb', confirmation_code: ' synthetic-code ' }]; },
    c => { c.mirror = [{ ...(c.mirror as object[])[0], guesty_reservation_id: '../other' }]; },
    c => { c.mirror = [{ ...(c.mirror as object[])[0], status: 'cancelled' }]; },
    c => { c.mirror = [{ ...(c.mirror as object[])[0], listing_id: 'cccccccccccccccccccccccc' }]; },
    c => { c.mirror = [{ ...(c.mirror as object[])[0], check_in: '2030-02-09' }]; },
    c => { c.mirror = null; },
    c => { c.report.stays = Array.from({ length: 13 }, () => ({ ...c.report.stays[0] })); },
  ];
  for (const change of changes) {
    const before = context(); change(before); let reads = 0;
    const result = await enrichCleanerGuestCounts(before, { readReservation: async () => { reads++; return source(); }, reloadContext: async () => before });
    assert.equal(reads, 0); assert.equal(result.guestCountCheck?.status, 'unavailable');
    assert.equal(result.stays[0].guests, null);
  }
});
test('each remote identity and count must be valid; no silent defaults, coercion or partial success', async () => {
  for (const invalid of [{ _id: 'bbbbbbbbbbbbbbbbbbbbbbbb' }, { accountId: 'bbbbbbbbbbbbbbbbbbbbbbbb' },
    { listingId: 'bbbbbbbbbbbbbbbbbbbbbbbb' }, { confirmationCode: 'OTHER' }, { status: 'cancelled' },
    { checkInDateLocalized: '2030-02-11' }, { checkOutDateLocalized: '2030-02-15' },
    ...[undefined, null, 0, -1, 1.5, 101, '7'].map(guestsCount => ({ guestsCount }))]) {
    const before = context();
    const result = await enrichCleanerGuestCounts(before, { readReservation: async () => source(invalid), reloadContext: async () => before });
    assert.equal(result.guestCountCheck?.status, 'unavailable'); assert.equal(result.stays[0].guests, null);
  }
});
test('a changed count or failed source read remains explicitly unverified', async () => {
  for (const failure of ['changed', 'network']) {
    let reads = 0; const before = context();
    const result = await enrichCleanerGuestCounts(before, {
      readReservation: async () => { reads++; if (failure === 'network') throw Error('private upstream error'); return source({ guestsCount: reads + 1 }); },
      reloadContext: async () => before,
    });
    assert.equal(result.guestCountCheck?.status, 'unavailable'); assert.equal(result.stays[0].guests, null);
    assert.doesNotMatch(JSON.stringify(result), /private upstream/);
  }
});
test('local cancellation, date/count/mapping changes or authority handover discard the entire stale schedule', async () => {
  for (const change of [(c: CleanerCountContext) => { c.report.stays = []; },
    (c: CleanerCountContext) => { c.report.stays[0].checkOut = '2030-02-15'; },
    (c: CleanerCountContext) => { c.bookings[0].num_guests = 2; },
    (c: CleanerCountContext) => { c.mirror = []; },
    (c: CleanerCountContext) => { c.authority = 'helm'; }]) {
    const after = context(); change(after);
    await assert.rejects(enrichCleanerGuestCounts(context(), { readReservation: async () => source(), reloadContext: async () => after }), /schedule changed/);
    await assert.rejects(enrichCleanerGuestCounts(context(), { readReservation: async () => { throw Error('network unavailable'); }, reloadContext: async () => after }), /schedule changed/);
  }
});
test('projected Guesty read is fixed-origin, read-only, uncached and independently signalled', async () => {
  const signals: unknown[] = [];
  const fetcher = (async (url, options) => {
    const u = new URL(String(url));
    assert.equal(u.origin, 'https://open-api.guesty.com'); assert.equal(u.pathname, `/v1/reservations/${sourceId}`);
    assert.equal(u.searchParams.get('fields')?.includes('guestsCount'), true);
    assert.equal(options?.method, 'GET'); assert.equal(options?.redirect, 'error'); assert.equal(options?.cache, 'no-store');
    signals.push(options?.signal); return Response.json(source());
  }) as typeof fetch;
  const signal = new AbortController().signal;
  await readCleanerCountReservation(sourceId, 'synthetic-token', signal, fetcher);
  await readCleanerCountReservation(sourceId, 'synthetic-token', signal, fetcher);
  assert.notEqual(signals[0], signals[1]);
  await assert.rejects(readCleanerCountReservation('../bad', 'synthetic-token', signal, fetcher));
  await assert.rejects(readCleanerCountReservation(sourceId, 'synthetic-token', AbortSignal.abort(), fetcher));
});
test('source errors, oversized or malformed payloads are rejected without retry', async () => {
  for (const make of [() => new Response('private error', { status: 429 }),
    () => new Response('private error', { status: 401 }), () => new Response('invalid JSON'),
    () => new Response('x'.repeat(32769))]) {
    let calls = 0;
    const fetcher = (async () => { calls++; return make(); }) as typeof fetch;
    await assert.rejects(readCleanerCountReservation(sourceId, 'synthetic-token', new AbortController().signal, fetcher));
    assert.equal(calls, 1);
  }
});
test('preview readers contain no persistence, send path, OAuth refresh or public access', () => {
  assert.equal(resolveCleanerCountTargets(context()).length, 1);
  for (const file of ['../cleaner-guest-counts.server.ts', '../cleaner-stay-report.server.ts']) {
    const code = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(code, /\.insert\(|\.upsert\(|\.update\(|\.delete\(|\.rpc\(|portal_token|sendMessage|getGuestyToken/);
  }
});
