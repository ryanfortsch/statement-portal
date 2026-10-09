import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALDERWOOD, readCalderwoodGuesty } from '../calderwood-readonly/guesty-reader.ts';
const window = { from: '2027-01-01', to: '2027-02-01' };
const row = (id = '000000000000000000000001') => ({ reservationId: id, status: 'confirmed', source: 'airbnb', checkInDateLocalized: '2027-01-02', checkOutDateLocalized: '2027-01-05', stay: [{ listingId: CALDERWOOD.guestyListingId, checkInDateLocalized: '2027-01-02', checkOutDateLocalized: '2027-01-05' }], guestId: 'private', notes: 'private', createdAt: 'not a revision' });
const response = (results: unknown[], skip = 0, hasMore = false) => Response.json({ results, pagination: { skip, limit: 100, hasMore } });
test('fixed scoped GET retains only minimal snapshot fields and cannot become inventory authority', async () => {
  const result = await readCalderwoodGuesty('test-token', window, async (url, options) => {
    const u = new URL(url);
    assert.equal(u.origin, 'https://open-api.guesty.com');
    assert.equal(u.pathname, '/v1/reservations-v3/search');
    assert.equal(u.searchParams.get('filter[listingId]'), CALDERWOOD.guestyListingId);
    assert.equal(u.searchParams.get('filter[checkOut][gte]'), window.from);
    assert.equal(u.searchParams.get('filter[status]'), null);
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.ok(!url.includes('test-token'));
    return response([row()]);
  });
  assert.deepEqual(Object.keys(result.reservations[0]), ['id', 'listingId', 'start', 'end', 'status', 'source']);
  assert.equal(result.baselineComplete, false); assert.equal(result.inventoryAuthority, false);
  assert.equal(CALDERWOOD.channexMapping, null);
});
test('reads all bounded pages and detects duplicate or malformed continuation', async () => {
  const first = Array.from({ length: 100 }, (_, i) => row((i + 1).toString(16).padStart(24, '0')));
  let calls = 0;
  const result = await readCalderwoodGuesty('token', window, async () => calls++ === 0 ? response(first, 0, true) : response([row('000000000000000000000101')], 100));
  assert.equal(result.reservations.length, 101);
  calls = 0;
  await assert.rejects(readCalderwoodGuesty('token', window, async () => calls++ === 0 ? response(first, 0, true) : response([first[0]], 100)), /changed/);
  await assert.rejects(readCalderwoodGuesty('token', window, async () => response([row()], 0, true)), /Incomplete/);
});
test('rejects foreign property, multi-stay, absent identity and inconsistent local dates', async () => {
  for (const bad of [{ ...row(), stay: [{ ...row().stay[0], listingId: 'foreign' }] }, { ...row(), stay: [...row().stay, ...row().stay] }, { ...row(), reservationId: undefined }, { ...row(), checkInDateLocalized: '2027-01-03' }]) {
    await assert.rejects(readCalderwoodGuesty('token', window, async () => response([bad])));
  }
});
test('empty snapshots remain incomplete and errors do not reveal provider payloads or credentials', async () => {
  const empty = await readCalderwoodGuesty('token', window, async () => response([]));
  assert.equal(empty.paginationComplete, true); assert.equal(empty.baselineComplete, false);
  await assert.rejects(readCalderwoodGuesty('token', window, async () => new Response('SECRET', { status: 401 })), e => e instanceof Error && !e.message.includes('SECRET'));
  await assert.rejects(readCalderwoodGuesty('token', window, async () => { throw Error('SECRET'); }), e => e instanceof Error && !e.message.includes('SECRET'));
});
test('invalid dates and credentials fail before network; no silent fallback for malformed envelopes', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json({ results: [] }); };
  await assert.rejects(readCalderwoodGuesty('', window, fetcher));
  await assert.rejects(readCalderwoodGuesty('token', { ...window, from: '2027-02-30' }, fetcher));
  assert.equal(calls, 0);
  await assert.rejects(readCalderwoodGuesty('token', window, fetcher));
});
