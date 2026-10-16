import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALDERWOOD } from '../calderwood-readonly/guesty-reader.ts';
import { confirmedInstant, readCalderwoodConfirmations } from '../calderwood-readonly/confirmation-reader.ts';
import { reviewCalderwoodMessageTiming } from '../calderwood-readonly/message-timing.ts';
import { loadCalderwoodRead } from '../calderwood-readonly/access.ts';
const now = new Date('2027-01-10T00:00:00Z');
const row = { id: '000000000000000000000001', listingId: CALDERWOOD.guestyListingId, start: '2027-01-15', end: '2027-01-18', status: 'confirmed', source: 'synthetic', timing: { arrivalAt: null, departureAt: null, issues: [], clockVerified: false } };
const payload = (id = row.id) => ({ _id: id, status: 'confirmed', confirmedAt: '2027-01-01T17:30:21.123Z', stay: [{ unitId: row.listingId, unitTypeId: row.listingId, checkInDateLocalized: row.start, checkOutDateLocalized: row.end }] });

test('confirmation parser preserves seconds and offsets, rejects guessed or future timestamps', () => {
  assert.equal(confirmedInstant('2027-01-01T12:30:21.123-05:00', now), '2027-01-01T17:30:21.123Z');
  for (const value of [null, undefined, 1, '', '2027-01-01', '2027-01-01T17:30:21', '2027-02-30T17:30:21Z', '2027-01-01T25:00:00Z', '2027-01-01T17:30:61Z', '2027-02-01T17:30:21Z']) assert.equal(confirmedInstant(value, now), null);
  assert.throws(() => confirmedInstant(null, new Date(NaN)));
});

test('bounded V3 batches bind response IDs without relying on order and discard private fields', async () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ ...row, id: (i + 1).toString(16).padStart(24, '0') }));
  const sizes: number[] = [];
  const result = await readCalderwoodConfirmations('synthetic-token', rows, now, async (url, init) => {
    const parsed = new URL(url), ids = parsed.searchParams.getAll('reservationIds[]');
    sizes.push(ids.length);
    assert.equal(parsed.origin, 'https://open-api.guesty.com'); assert.equal(parsed.pathname, '/v1/reservations-v3');
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer synthetic-token');
    return Response.json(ids.toReversed().map(id => ({ ...payload(id), guest: { name: 'PRIVATE' }, keyCode: 'PRIVATE', money: { details: 'PRIVATE' } })));
  });
  assert.deepEqual(sizes, [10, 2]);
  assert.deepEqual(result.map(r => r.id), rows.map(r => r.id));
  assert.ok(result.every(r => r.timing.confirmation?.at === '2027-01-01T17:30:21.123Z'));
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  assert.ok(!JSON.stringify(result).includes('synthetic-token'));
  assert.equal('confirmation' in row.timing, false);
});

test('missing confirmedAt never borrows creation, booking or channel confirmation dates', async () => {
  for (const confirmedAt of [null, undefined, '', '2027-02-01T00:00:00Z']) {
    const result = await readCalderwoodConfirmations('token', [row], now, async () => Response.json([{ ...payload(), confirmedAt, createdAt: '2027-01-01T10:00:00Z', bookingDate: '2027-01-01T10:00:00Z', channelMetadata: { confirmedAt: '2027-01-01T10:00:00Z' } }]));
    assert.equal(result[0].timing.confirmation, null);
    assert.equal(reviewCalderwoodMessageTiming(result[0], now)[0].at, null);
  }
});

test('confirmation evidence is independent of local clock evidence and never proves sent or permits replay', async () => {
  const [result] = await readCalderwoodConfirmations('token', [row], now, async () => Response.json([payload()]));
  const schedule = reviewCalderwoodMessageTiming(result, now);
  assert.equal(result.timing.clockVerified, false);
  assert.equal(schedule[0].at, '2027-01-01T18:00:21.123Z');
  assert.match(schedule[0].review, /never replay automatically/);
  assert.ok(schedule.slice(1).every(r => r.at === null));
  assert.ok(schedule.every(r => r.canSend === false));
  assert.ok(reviewCalderwoodMessageTiming({ ...result, status: 'canceled' }, now).every(r => r.at === null));
  for (const at of ['bad', '2028-01-01T00:00:00Z']) assert.equal(reviewCalderwoodMessageTiming({ ...result, timing: { ...result.timing, confirmation: { source: 'guesty-v3-confirmedAt', at } } }, now)[0].at, null);
});

test('wrong, duplicate, missing or changed reservation records cannot establish confirmation evidence', async () => {
  const p = payload(), s = p.stay[0];
  const bad = [[], [p, p], [{ ...p, _id: 'foreign' }], [{ ...p, status: 'canceled' }], [{ ...p, stay: [] }], [{ ...p, stay: [s, s] }], [{ ...p, stay: [{ ...s, unitId: 'foreign' }] }], [{ ...p, stay: [{ ...s, unitTypeId: 'foreign' }] }], [{ ...p, stay: [{ ...s, checkOutDateLocalized: '2027-01-19' }] }]];
  for (const data of bad) await assert.rejects(readCalderwoodConfirmations('token', [row], now, async () => Response.json(data)));
  const rows = [row, { ...row, id: '000000000000000000000002' }];
  await assert.rejects(readCalderwoodConfirmations('token', rows, now, async () => Response.json([p, p])));
});

test('scope limits and authorization reject before reads; nonconfirmed records are not requested', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json([payload()]); };
  const badRows = [[{ ...row, listingId: 'foreign' }], [{ ...row, id: '../other' }], [row, row], Array.from({ length: 13 }, () => row)];
  for (const rows of badRows) await assert.rejects(readCalderwoodConfirmations('token', rows as Parameters<typeof readCalderwoodConfirmations>[1], now, fetcher));
  for (const token of ['', 'bad\ntoken']) await assert.rejects(readCalderwoodConfirmations(token, [row], now, fetcher));
  const cancelled = { ...row, status: 'canceled' };
  assert.deepEqual(await readCalderwoodConfirmations('token', [cancelled], now, fetcher), [cancelled]);
  assert.equal(calls, 0);
});

test('provider failures are sanitized and enrichment failures preserve existing local clocks', async () => {
  for (const response of [new Response('PRIVATE', { status: 429 }), new Response('PRIVATE', { status: 503 }), new Response('PRIVATE')]) await assert.rejects(readCalderwoodConfirmations('token', [row], now, async () => response), e => e instanceof Error && !e.message.includes('PRIVATE'));
  await assert.rejects(readCalderwoodConfirmations('token', [row], now, async () => { throw Error('PRIVATE'); }), e => e instanceof Error && !e.message.includes('PRIVATE'));
  const input = { email: 'staff@risingtidestr.com', env: { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'codex/channex-staging-pilot', CHANNEX_STAGING_ENABLED: 'true' }, from: '2027-01-01', to: '2027-02-01', includeLocalClocks: true, includeConfirmations: true };
  let calls = 0;
  const dependencies = {
    token: async () => 'token',
    read: async () => ({ mode: 'read-only-snapshot' as const, executable: false as const, inventoryAuthority: false as const, paginationComplete: true as const, baselineComplete: false as const, missingEvidence: ['independent-blocks', 'authoritative-revisions', 'channex-mapping', 'cross-provider-comparison'] as const, window: { from: input.from, to: input.to }, reservations: [row] }),
    localClocks: async () => [{ ...row, timing: { ...row.timing, arrivalAt: '2027-01-15T21:00:00Z', clockVerified: true } }],
    confirmations: async () => { calls++; throw Error('PRIVATE'); },
  };
  await assert.rejects(loadCalderwoodRead({ ...input, email: null }, dependencies));
  assert.equal(calls, 0);
  const result = await loadCalderwoodRead(input, dependencies);
  assert.equal(result.confirmationError, true);
  assert.equal(result.reservations[0].timing.arrivalAt, '2027-01-15T21:00:00Z');
  assert.equal(result.reservations[0].timing.clockVerified, true);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
