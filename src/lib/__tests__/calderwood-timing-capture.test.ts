import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALDERWOOD, readCalderwoodGuesty } from '../calderwood-readonly/guesty-reader.ts';
import { captureCalderwoodTiming, timingCaptureFingerprint } from '../calderwood-readonly/timing-capture.ts';
import { readCalderwoodLocalClocks } from '../calderwood-readonly/local-clock-reader.ts';
import { readCalderwoodConfirmations } from '../calderwood-readonly/confirmation-reader.ts';
import { loadCalderwoodRead } from '../calderwood-readonly/access.ts';
import { ingestReviewedMessageTiming, type ReviewedTimingPacket } from '../channex-messaging/timing-ingestion.ts';
const now = new Date('2027-01-10T15:00:00Z');
const row = { id: '000000000000000000000001', listingId: CALDERWOOD.guestyListingId, start: '2027-01-15', end: '2027-01-18', status: 'confirmed', source: 'synthetic', timing: { arrivalAt: null, departureAt: null, issues: [], clockVerified: false } };
const snapshot: Awaited<ReturnType<typeof readCalderwoodGuesty>> = {
  mode: 'read-only-snapshot', executable: false, inventoryAuthority: false, paginationComplete: true, baselineComplete: false,
  missingEvidence: ['independent-blocks', 'authoritative-revisions', 'channex-mapping', 'cross-provider-comparison'],
  window: { from: '2027-01-01', to: '2027-02-01' }, reservations: [row],
};
function source() {
  const calls: string[] = [];
  const fetcher = async (url: string, init: RequestInit) => {
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    const u = new URL(url); assert.equal(u.origin, 'https://open-api.guesty.com'); calls.push(u.pathname);
    if (u.pathname === `/v1/reservations/${row.id}`) return Response.json({
      _id: row.id, listingId: row.listingId, status: 'confirmed', checkInDateLocalized: row.start, checkOutDateLocalized: row.end,
      plannedArrival: null, plannedDeparture: '12:00', listing: { timezone: 'America/New_York', defaultCheckInTime: '16:00', defaultCheckOutTime: '11:00' }, guest: 'PRIVATE',
    });
    if (u.pathname === '/v1/reservations-v3') return Response.json([{
      _id: row.id, status: 'confirmed', confirmedAt: '2027-01-01T10:01:02.123Z', guest: 'PRIVATE',
      stay: [{ unitId: row.listingId, unitTypeId: row.listingId, checkInDateLocalized: row.start, checkOutDateLocalized: row.end }],
    }]);
    assert.equal(u.pathname, '/v1/reservations-v3/search');
    return Response.json({ results: [{ reservationId: row.id, status: 'confirmed', source: 'synthetic',
      checkInDateLocalized: row.start, checkOutDateLocalized: row.end,
      stay: [{ listingId: row.listingId, checkInDateLocalized: row.start, checkOutDateLocalized: row.end }],
    }], pagination: { skip: 0, limit: 100, hasMore: false } });
  };
  return { calls, dependencies: {
    clock: () => now,
    read: (token: string, window: { from: string; to: string }) => readCalderwoodGuesty(token, window, fetcher),
    localClocks: (token: string, rows: typeof snapshot.reservations) => readCalderwoodLocalClocks(token, rows, fetcher),
    confirmations: (token: string, rows: typeof snapshot.reservations, at: Date) => readCalderwoodConfirmations(token, rows, at, fetcher),
  } };
}
const bookingId = '10000000-0000-4000-8000-000000000001';
const observationId = '10000000-0000-4000-8000-000000000002';
async function packet(): Promise<ReviewedTimingPacket> {
  const { capture } = await captureCalderwoodTiming('HELMTEST', snapshot, source().dependencies);
  return { capture, binding: { bookingId, sourceReservationId: row.id, canonicalRevision: 'a'.repeat(32), expectedObservationRevision: null },
    review: { id: '10000000-0000-4000-8000-000000000003', reviewedAt: now.toISOString(), source: 'guesty-local-clock-review', fingerprint: capture.fingerprint } } as ReviewedTimingPacket;
}
test('real readers cross-check both endpoint orders and retain explicit clocks and true confirmation seconds', async () => {
  const { calls, dependencies } = source();
  const result = await captureCalderwoodTiming('HELMTEST-secret', snapshot, dependencies);
  assert.deepEqual(calls, [`/v1/reservations/${row.id}`, '/v1/reservations-v3', '/v1/reservations-v3', `/v1/reservations/${row.id}`, '/v1/reservations-v3/search']);
  assert.deepEqual(result.capture.candidates[0], { reservationId: row.id, listingId: row.listingId, checkIn: row.start, checkOut: row.end,
    arrivalAt: '2027-01-15T21:00:00.000Z', departureAt: '2027-01-18T17:00:00.000Z', confirmedAt: '2027-01-01T10:01:02.123Z',
    arrivalBasis: 'listing.defaultCheckInTime', departureBasis: 'plannedDeparture' });
  assert.equal(result.capture.canSend, false); assert.equal(result.capture.automaticImport, false);
  assert.equal(result.reservations[0].timing.confirmation?.at, result.capture.candidates[0].confirmedAt);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false); assert.equal(JSON.stringify(result).includes('HELMTEST-secret'), false);
});
test('collection membership, status, dates, scope or identity changes withhold the whole capture', async () => {
  for (const rows of [[], [row, { ...row, id: '000000000000000000000002' }], [row, row],
    [{ ...row, status: 'canceled' }], [{ ...row, end: '2027-01-19' }], [{ ...row, listingId: 'other' }]]) {
    const dependencies = source().dependencies;
    await assert.rejects(captureCalderwoodTiming('token', snapshot, { ...dependencies, read: async () => ({ ...snapshot, reservations: rows as typeof snapshot.reservations }) }), /cross-checked/);
  }
});
test('changes in override, its basis, or confirmation between passes are rejected', async () => {
  for (const change of ['clock', 'basis', 'confirmation']) {
    const dependencies = source().dependencies; let clocks = 0, confirmations = 0;
    await assert.rejects(captureCalderwoodTiming('token', snapshot, { ...dependencies,
      localClocks: async (token, input) => { const rows = await dependencies.localClocks(token, input); if (++clocks === 2) {
        if (change === 'clock') rows[0].timing.arrivalAt = '2027-01-15T22:00:00Z';
        if (change === 'basis') rows[0].timing.localEvidence!.arrivalBasis = 'plannedArrival';
      } return rows; },
      confirmations: async (token, input, now) => { const rows = await dependencies.confirmations(token, input, now); if (++confirmations === 2 && change === 'confirmation') rows[0].timing.confirmation = null; return rows; },
    }), /cross-checked/);
  }
});
test('missing confirmation remains incomplete even when dates and local clocks are stable', async () => {
  const dependencies = source().dependencies;
  const result = await captureCalderwoodTiming('token', snapshot, { ...dependencies, confirmations: async (_token, rows) => rows.map(r => ({ ...r, timing: { ...r.timing, confirmation: null } })) });
  assert.deepEqual(result.capture.candidates, []); assert.deepEqual(result.capture.incompleteReservationIds, [row.id]);
});
test('read limits, time budget, backward clock, provider failures and secrets fail closed', async () => {
  const dependencies = source().dependencies;
  for (const changed of [[row, row], Array.from({ length: 13 }, (_, i) => ({ ...row, id: i.toString(16).padStart(24, '0') }))]) {
    let calls = 0;
    await assert.rejects(captureCalderwoodTiming('token', { ...snapshot, reservations: changed }, { ...dependencies, localClocks: async () => { calls++; return []; } }));
    assert.equal(calls, 0);
  }
  for (const jump of [-1, 120001, NaN]) {
    let calls = 0;
    await assert.rejects(captureCalderwoodTiming('token', snapshot, { ...dependencies, clock: () => new Date(now.getTime() + (calls++ ? jump : 0)) }));
  }
  await assert.rejects(captureCalderwoodTiming('token', snapshot, { ...dependencies, read: async () => { throw Error('PRIVATE token'); } }), error => error instanceof Error && !error.message.includes('PRIVATE'));
});
test('protected preview withholds history and derived timing if the checked collection fails', async () => {
  let reads = 0, historyReads = 0;
  const dependencies = source().dependencies;
  const result = await loadCalderwoodRead({ email: 'staff@risingtidestr.com', env: { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'codex/channex-staging-pilot', CHANNEX_STAGING_ENABLED: 'true' },
    ...snapshot.window, includeTimingCapture: true, includeMessageHistory: true }, {
      ...dependencies, token: async () => 'token', read: async () => ++reads === 1 ? snapshot : { ...snapshot, reservations: [] },
      messageHistory: async () => { historyReads++; throw Error(); },
    });
  assert.equal(result.timingCaptureError, true); assert.equal(result.timingCapture, null); assert.equal(historyReads, 0);
  assert.equal(result.messageHistoryError, true); assert.equal(result.reservations[0].timing.clockVerified, false);
});
test('reviewed capture calls the owner observation RPC once with exact binding and no message evidence', async () => {
  const value = await packet(); let calls = 0;
  const result = await ingestReviewedMessageTiming(async (name, args) => {
    calls++; assert.equal(name, 'automation_message_observe_times');
    assert.deepEqual(args, { p_booking_id: bookingId, p_canonical_revision: 'a'.repeat(32), p_expected_revision: null,
      p_observation: { check_in: row.start, check_out: row.end, arrival_time: '16:00', departure_time: '12:00',
        confirmed_at: '2027-01-01T10:01:02.123Z', observed_at: now.toISOString(),
        source_revision: `capture:${value.capture.fingerprint}`, evidence_id: `review:${value.review.id}` } });
    return { data: observationId, error: null };
  }, value, now);
  assert.equal(calls, 1); assert.deepEqual(result, { state: 'observed', observationRevision: observationId, canSend: false });
});
test('unreviewed, stale, incomplete, mismatched or extra-field packets cannot reach an RPC', async () => {
  const original = await packet(); let calls = 0;
  const rpc = async () => { calls++; return { data: observationId, error: null }; };
  const changes: ((p: ReviewedTimingPacket) => void)[] = [
    p => { p.review.fingerprint = 'b'.repeat(64); }, p => { p.capture.candidates[0].confirmedAt = '2027-01-09T00:00:00Z'; },
    p => { p.binding.sourceReservationId = '000000000000000000000003'; }, p => { p.capture.incompleteReservationIds.push(row.id); },
    p => { p.capture.startedAt = '2027-01-10T14:00:00Z'; }, p => { p.review.reviewedAt = '2027-01-10T16:00:00Z'; },
    p => { Object.assign(p.review, { queued: false }); }, p => { Object.assign(p.capture.candidates[0], { guest: 'PRIVATE' }); },
  ];
  for (const change of changes) { const value = structuredClone(original); change(value); await assert.rejects(ingestReviewedMessageTiming(rpc, value, now)); }
  await assert.rejects(ingestReviewedMessageTiming(rpc, { ...original, review: undefined }, now)); assert.equal(calls, 0);
});
test('invalid local dates, sub-minute or ambiguous clocks cannot be imported even with a matching hash', async () => {
  const original = await packet(); let calls = 0;
  for (const arrivalAt of ['2027-01-16T21:00:00Z', '2027-01-15T21:00:01Z', '2027-11-07T05:30:00Z']) {
    const value = structuredClone(original), c = value.capture.candidates[0]; c.arrivalAt = arrivalAt;
    if (arrivalAt.includes('11-07')) { c.checkIn = '2027-11-07'; c.checkOut = '2027-11-08'; c.departureAt = '2027-11-08T17:00:00Z'; }
    value.review.fingerprint = value.capture.fingerprint = timingCaptureFingerprint(value.capture.candidates, []);
    await assert.rejects(ingestReviewedMessageTiming(async () => { calls++; return { data: observationId, error: null }; }, value, now));
  }
  assert.equal(calls, 0);
});
test('lost, rejected or malformed RPC replies never retry or expose details', async () => {
  const value = await packet();
  for (const failure of ['throw', 'rejected', 'bad-receipt']) {
    let calls = 0;
    await assert.rejects(ingestReviewedMessageTiming(async () => {
      calls++; if (failure === 'throw') throw Error('PRIVATE');
      return failure === 'rejected' ? { data: null, error: { message: 'PRIVATE' } } : { data: 'PRIVATE', error: null };
    }, value, now), { message: 'Timing import unconfirmed; reconcile this review before continuing' });
    assert.equal(calls, 1);
  }
});
