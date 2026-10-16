import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALDERWOOD } from '../calderwood-readonly/guesty-reader.ts';
import { normalizeCalderwoodTiming, normalizeCalderwoodLocalTiming, reviewCalderwoodMessageTiming } from '../calderwood-readonly/message-timing.ts';
import { readCalderwoodLocalClocks } from '../calderwood-readonly/local-clock-reader.ts';
import { loadCalderwoodRead } from '../calderwood-readonly/access.ts';

const start = '2027-01-15', end = '2027-01-18';
const search = normalizeCalderwoodTiming({ start, end, arrival: start + 'T16:00:00Z', stayArrival: start + 'T16:00:00Z', departure: end + 'T11:00:00Z', stayDeparture: end + 'T11:00:00Z' });
const local = { start, end, timezone: 'America/New_York', plannedArrival: '16:00', plannedDeparture: '11:00', defaultArrival: '17:00', defaultDeparture: '10:00' };
const reservation = { id: '000000000000000000000001', listingId: CALDERWOOD.guestyListingId, start, end, status: 'confirmed', source: 'synthetic', timing: search };
const payload = { _id: reservation.id, listingId: reservation.listingId, checkInDateLocalized: start, checkOutDateLocalized: end, status: 'confirmed', plannedArrival: local.plannedArrival, plannedDeparture: local.plannedDeparture, listing: { timezone: local.timezone, defaultCheckInTime: local.defaultArrival, defaultCheckOutTime: local.defaultDeparture } };
const clock = (input = local) => normalizeCalderwoodLocalTiming(input, search);

test('local fields resolve winter and summer clocks without offsetting V3 timestamps', () => {
  const winter = clock();
  assert.equal(winter.arrivalAt, '2027-01-15T21:00:00.000Z');
  assert.equal(winter.departureAt, '2027-01-18T16:00:00.000Z');
  assert.equal(winter.clockVerified, true);
  assert.equal(winter.localEvidence?.disagreesWithSearch, true);
  assert.equal(winter.localEvidence?.searchArrivalAt, search.arrivalAt);
  assert.equal(winter.localEvidence?.arrivalBasis, 'plannedArrival');
  const summer = clock({ ...local, start: '2027-07-15', end: '2027-07-18' });
  assert.equal(summer.arrivalAt, '2027-07-15T20:00:00.000Z');
  assert.equal(summer.departureAt, '2027-07-18T15:00:00.000Z');
  const rows = reviewCalderwoodMessageTiming({ status: 'confirmed', timing: winter }, new Date('2027-01-01T00:00:00Z'));
  assert.equal(rows.find(r => r.key === 'key_code')?.at, '2027-01-15T20:00:00.000Z');
  assert.equal(rows.find(r => r.key === 'cleaner_arrival')?.at, '2027-01-15T14:00:00.000Z');
  assert.equal(rows.find(r => r.key === 'confirmation')?.at, null);
  assert.ok(rows.every(r => r.canSend === false));
});

test('reservation overrides win, missing overrides use fetched defaults, invalid overrides never fall back', () => {
  assert.equal(clock({ ...local, plannedArrival: '18:30' }).arrivalAt, '2027-01-15T23:30:00.000Z');
  const fallback = normalizeCalderwoodLocalTiming({ ...local, plannedArrival: null, plannedDeparture: undefined }, search);
  assert.equal(fallback.arrivalAt, '2027-01-15T22:00:00.000Z');
  assert.equal(fallback.departureAt, '2027-01-18T15:00:00.000Z');
  assert.equal(fallback.localEvidence?.arrivalBasis, 'listing.defaultCheckInTime');
  for (const plannedArrival of ['', '24:00', '16:60', '4:00', '16:00Z', '2027-01-15T16:00:00Z', 16]) {
    const result = normalizeCalderwoodLocalTiming({ ...local, plannedArrival }, search);
    assert.equal(result.arrivalAt, null);
    assert.equal(result.departureAt, '2027-01-18T16:00:00.000Z');
  }
  const missing = normalizeCalderwoodLocalTiming({ ...local, plannedArrival: null, defaultArrival: undefined, plannedDeparture: null, defaultDeparture: null }, search);
  assert.equal(missing.clockVerified, false);
  assert.equal(missing.arrivalAt, null);
});

test('wrong zone, invalid dates and ambiguous or missing DST clocks stay unverified', () => {
  for (const timezone of [undefined, 'UTC', 'America/Chicago']) assert.equal(normalizeCalderwoodLocalTiming({ ...local, timezone }, search).clockVerified, false);
  assert.equal(clock({ ...local, start: '2027-02-30' }).arrivalAt, null);
  assert.equal(clock({ ...local, start: '2027-03-14', end: '2027-03-17', plannedArrival: '02:30' }).arrivalAt, null);
  assert.equal(clock({ ...local, start: '2027-11-07', end: '2027-11-10', plannedArrival: '01:30' }).arrivalAt, null);
});

test('projected reader binds the exact stay and drops private fields while skipping nonconfirmed records', async () => {
  let calls = 0;
  const canceled = { ...reservation, id: '000000000000000000000002', status: 'canceled' };
  const result = await readCalderwoodLocalClocks('synthetic-token', [reservation, canceled], async (url, init) => {
    calls++;
    assert.equal(init.method, 'GET'); assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error');
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer synthetic-token');
    const request = new URL(url);
    assert.equal(request.origin, 'https://open-api.guesty.com');
    assert.equal(request.pathname, '/v1/reservations/' + reservation.id);
    assert.equal(request.searchParams.get('fields'), '_id listingId checkInDateLocalized checkOutDateLocalized status plannedArrival plannedDeparture listing.defaultCheckInTime listing.defaultCheckOutTime listing.timezone');
    return Response.json({ ...payload, guest: { name: 'PRIVATE' }, keyCode: 'PRIVATE', listing: { ...payload.listing, accessCode: 'PRIVATE' } });
  });
  assert.equal(calls, 1);
  assert.equal(result[0].timing.clockVerified, true);
  assert.equal(result[1], canceled);
  assert.equal(reservation.timing.clockVerified, false);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(result).includes('synthetic-token'), false);
});

test('mismatched identity, dates, status and malformed responses cannot establish a local clock', async () => {
  for (const changed of [{ ...payload, _id: '000000000000000000000003' }, { ...payload, listingId: 'foreign' }, { ...payload, status: 'canceled' }, { ...payload, checkInDateLocalized: '2027-01-16' }, { ...payload, checkOutDateLocalized: '2027-01-19' }, { ...payload, listing: null }, null, []]) {
    await assert.rejects(readCalderwoodLocalClocks('token', [reservation], async () => Response.json(changed)));
  }
  for (const response of [new Response('PRIVATE', { status: 429 }), new Response('PRIVATE', { status: 503 }), new Response('PRIVATE')]) {
    await assert.rejects(readCalderwoodLocalClocks('token', [reservation], async () => response), e => e instanceof Error && !e.message.includes('PRIVATE'));
  }
  await assert.rejects(readCalderwoodLocalClocks('token', [reservation], async () => { throw Error('PRIVATE'); }), e => e instanceof Error && !e.message.includes('PRIVATE'));
});

test('out-of-scope, duplicate and oversized requests stop before provider access', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json(payload); };
  for (const rows of [[{ ...reservation, listingId: 'foreign' }], [{ ...reservation, id: '../other' }], [reservation, reservation], Array.from({ length: 13 }, (_, i) => ({ ...reservation, id: i.toString(16).padStart(24, '0') }))]) {
    await assert.rejects(readCalderwoodLocalClocks('token', rows as Parameters<typeof readCalderwoodLocalClocks>[1], fetcher));
  }
  for (const token of ['', 'bad\r\ntoken']) await assert.rejects(readCalderwoodLocalClocks(token, [reservation], fetcher));
  assert.equal(calls, 0);
});

test('preview access keeps the original unverified snapshot when a local read fails', async () => {
  const input = { email: 'staff@risingtidestr.com', env: { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'codex/channex-staging-pilot', CHANNEX_STAGING_ENABLED: 'true' }, from: '2027-01-01', to: '2027-02-01', includeLocalClocks: true };
  const dependencies = {
    token: async () => 'secret-token',
    read: async () => ({ mode: 'read-only-snapshot' as const, executable: false as const, inventoryAuthority: false as const, paginationComplete: true as const, baselineComplete: false as const, missingEvidence: ['independent-blocks', 'authoritative-revisions', 'channex-mapping', 'cross-provider-comparison'] as const, window: { from: input.from, to: input.to }, reservations: [reservation] }),
    localClocks: async () => { throw Error('PRIVATE'); },
  };
  const failed = await loadCalderwoodRead(input, dependencies);
  assert.equal(failed.localClockError, true);
  assert.equal(failed.reservations[0].timing.clockVerified, false);
  assert.ok(!JSON.stringify(failed).includes('PRIVATE'));
  let calls = 0;
  const localClocks = async () => { calls++; return [{ ...reservation, timing: clock() }]; };
  await assert.rejects(loadCalderwoodRead({ ...input, email: 'outside@example.com' }, { ...dependencies, localClocks }));
  assert.equal(calls, 0);
  const success = await loadCalderwoodRead(input, { ...dependencies, localClocks });
  assert.equal(success.localClockError, false);
  assert.equal(success.reservations[0].timing.clockVerified, true);
});
