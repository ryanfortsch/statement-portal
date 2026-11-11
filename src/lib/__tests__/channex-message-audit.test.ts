import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditMessageHandoff } from '../channex-bookings/message-audit.ts';
import { resolveMessageStayIdentities, GUESTY_CALDERWOOD, GUESTY_ACCOUNT } from '../channex-bookings/message-identity.ts';
import type { CanonicalSnapshot } from '../channex-bookings/reconciliation.ts';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const id = (n: number) => n.toString(16).padStart(24, '0');
const start = '2026-11-06', end = '2027-01-01';
const canonical: CanonicalSnapshot = { format: 1, propertyId: '65_calderwood', authority: 'guesty', rows: [
  { id: uid(1), channel: 'airbnb', source: 'ical_import', status: 'confirmed', checkIn: '2026-11-10',
    checkOut: '2026-11-14', code: 'SYNTHETIC-CODE', duplicateOf: null, holdKind: null },
] };
const mirror = [{ guesty_reservation_id: id(1), property_id: '65_calderwood', listing_id: GUESTY_CALDERWOOD,
  confirmation_code: 'SYNTHETIC-CODE', check_in: '2026-11-10', check_out: '2026-11-14', channel: 'Airbnb', status: 'confirmed' }];
const env = { VERCEL_ENV: 'production', CHANNEX_PRODUCTION_MODE: 'inspect',
  NEXT_PUBLIC_SUPABASE_URL: 'https://qjueexujiuticjrtqdyj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic', CHANNEX_PRODUCTION_API_KEY: 'synthetic' };
const clock = () => Date.parse('2026-11-06T18:00:00Z');
const detail = { _id: id(1), accountId: GUESTY_ACCOUNT, listingId: GUESTY_CALDERWOOD,
  confirmationCode: 'SYNTHETIC-CODE', status: 'confirmed', integration: { platform: 'airbnb2' },
  checkInDateLocalized: '2026-11-10', checkOutDateLocalized: '2026-11-14' };
const conversation = { _id: id(2), accountId: GUESTY_ACCOUNT,
  meta: { reservations: [{ _id: id(1), status: 'confirmed', listing: { _id: GUESTY_CALDERWOOD } }] } };
const post = { _id: id(3), conversationId: id(2), createdAt: '2026-10-01T18:00:00Z',
  from: { type: 'user' }, module: { type: 'airbnb2' }, body: 'PRIVATE_BODY' };
const page = (key: string, rows: unknown[]) => Response.json({ status: 200, data: { [key]: rows, cursor: { after: '' } } });
function fixture() {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(url.pathname);
    assert.equal(url.origin, 'https://open-api.guesty.com');
    assert.equal(init?.method, 'GET'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    assert.ok(init.signal); assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer synthetic-token');
    if (url.pathname.includes('/reservations/')) {
      assert.equal(url.searchParams.get('fields')?.includes('guest'), false);
      return Response.json({ ...detail, guest: 'PRIVATE_GUEST', money: 'PRIVATE_MONEY' });
    }
    return url.pathname.endsWith('/posts') ? page('posts', [post]) : page('conversations', [conversation]);
  };
  const deps = { context: async () => structuredClone({ canonical, mirror, automationsEnabled: false }),
    verifyDormant: async () => {}, token: async () => 'synthetic-token', clock, fetcher };
  return { deps, calls };
}

test('real orchestrator reads both sources twice and never marks posts as completed sends', async () => {
  const { deps, calls } = fixture();
  const result = await auditMessageHandoff(env, deps);
  assert.equal(calls.length, 6);
  assert.equal(result.currentAndUpcomingStays, 1); assert.equal(result.conversationRecords, 1);
  assert.equal(result.rows[0].canonicalId, uid(1)); assert.equal(result.rows[0].paginationComplete, true);
  for (const flag of ['guestDeliveryHistoryVerified', 'cleanerDeliveryHistoryVerified', 'pendingQueueVerified',
    'sourceStoppedAndDrained', 'readyForAutomaticMessaging'] as const) assert.equal(result[flag], false);
  for (const value of ['PRIVATE', 'SYNTHETIC-CODE', 'synthetic-token', 'createdAt', 'sentAt'])
    assert.equal(JSON.stringify(result).includes(value), false);
  assert.equal(result.bookingsChanged + result.messagesSent + result.historicalSendsImported, 0);
});

test('exact canonical identity is preserved and same-date or normalized-code guesses fail', () => {
  assert.equal(resolveMessageStayIdentities(canonical, mirror, start, end)[0].canonicalId, uid(1));
  for (const patch of [{ confirmation_code: 'DIFFERENT' }, { confirmation_code: ' synthetic-code ' },
    { check_out: '2026-11-15' }, { status: 'canceled' }, { listing_id: id(9) }, { channel: 'Vrbo' }])
    assert.throws(() => resolveMessageStayIdentities(canonical, [{ ...mirror[0], ...patch }], start, end));
  assert.throws(() => resolveMessageStayIdentities(canonical, [mirror[0], { ...mirror[0], guesty_reservation_id: id(8),
    check_in: '2025-01-01', check_out: '2025-01-02', status: 'closed' }], start, end));
  assert.throws(() => resolveMessageStayIdentities({ ...canonical, rows: [...canonical.rows,
    { ...canonical.rows[0], id: uid(9), checkIn: '2025-01-01', checkOut: '2025-01-02', status: 'cancelled' }] }, mirror, start, end));
});

test('only current/upcoming canonical rows enter the review; other channels cannot silently disappear', () => {
  const rows = [canonical.rows[0], { ...canonical.rows[0], id: uid(2), duplicateOf: uid(1) },
    { ...canonical.rows[0], id: uid(3), code: 'PAST', checkIn: '2026-11-01', checkOut: start }];
  assert.equal(resolveMessageStayIdentities({ ...canonical, rows }, mirror, start, end).length, 1);
  assert.throws(() => resolveMessageStayIdentities({ ...canonical, rows: [{ ...canonical.rows[0], channel: 'vrbo' }] }, mirror, start, end));
  assert.throws(() => resolveMessageStayIdentities(canonical, mirror, end, start));
  assert.throws(() => resolveMessageStayIdentities(canonical, [...mirror, mirror[0]], start, end));
});

test('unrelated incomplete historical mirror rows do not block discovery, but still count toward identity ambiguity', () => {
  const incomplete = { ...mirror[0], guesty_reservation_id: id(22), confirmation_code: null,
    listing_id: null, check_in: null, check_out: null, channel: null, status: null };
  assert.equal(resolveMessageStayIdentities(canonical, [...mirror, incomplete], start, end).length, 1);
  assert.throws(() => resolveMessageStayIdentities(canonical,
    [...mirror, { ...incomplete, confirmation_code: mirror[0].confirmation_code }], start, end));
  assert.throws(() => resolveMessageStayIdentities(canonical,
    [{ ...incomplete, confirmation_code: mirror[0].confirmation_code }], start, end));
});

test('legacy CSV identities remain collision candidates but can never become API destinations', () => {
  const legacy = { ...mirror[0], guesty_reservation_id: 'csv:SYNTHETIC-OLD', confirmation_code: 'OLDER-STAY' };
  assert.equal(resolveMessageStayIdentities(canonical, [...mirror, legacy], start, end).length, 1);
  assert.throws(() => resolveMessageStayIdentities(canonical,
    [...mirror, { ...legacy, confirmation_code: mirror[0].confirmation_code }], start, end));
  for (const invalid of ['csv:SYNTHETIC-OLD', '../other', 'https://example.invalid/'])
    assert.throws(() => resolveMessageStayIdentities(canonical, [{ ...mirror[0], guesty_reservation_id: invalid }], start, end));
});

test('environment, dormant gates and disabled automations are checked before token or provider access', async () => {
  const { deps, calls } = fixture(); let tokens = 0; deps.token = async () => { tokens++; return 'synthetic-token'; };
  await assert.rejects(auditMessageHandoff({ ...env, VERCEL_ENV: 'preview' }, deps));
  await assert.rejects(auditMessageHandoff(env, { ...deps, verifyDormant: async () => { throw Error('PRIVATE'); } }));
  await assert.rejects(auditMessageHandoff(env, { ...deps, context: async () => ({ canonical, mirror, automationsEnabled: true }) }));
  await assert.rejects(auditMessageHandoff(env, { ...deps, context: async () => ({ canonical, mirror: [], automationsEnabled: false }) }));
  assert.equal(tokens, 0); assert.equal(calls.length, 0);
});

test('live reservation must retain exact listing, account, channel, code, status and dates before history reads', async () => {
  for (const patch of [{ accountId: id(90) }, { listingId: id(91) }, { confirmationCode: 'OTHER' },
    { status: 'canceled' }, { checkInDateLocalized: '2026-11-11' }, { _id: id(92) }, { integration: { platform: 'manual' } }]) {
    const { deps } = fixture(); let calls = 0;
    deps.fetcher = async () => { calls++; return Response.json({ ...detail, ...patch }); };
    await assert.rejects(auditMessageHandoff(env, deps), /SOURCE_READ_FAILED/);
    assert.equal(calls, 1);
  }
});

test('source or local change during review invalidates the whole observation', async () => {
  for (const change of ['post', 'canonical', 'mirror', 'gate', 'detail']) {
    const { deps } = fixture(); const fetcher = deps.fetcher; let contexts = 0, posts = 0, details = 0, gates = 0;
    deps.context = async () => {
      const result = structuredClone({ canonical, mirror, automationsEnabled: false });
      if (++contexts === 2 && change === 'canonical') result.canonical.rows[0].checkOut = '2026-11-15';
      if (contexts === 2 && change === 'mirror') result.mirror[0].status = 'canceled';
      return result;
    };
    deps.verifyDormant = async () => { if (++gates === 2 && change === 'gate') throw Error('changed'); };
    deps.fetcher = async (input, init) => {
      if (String(input).includes('/posts?') && ++posts === 2 && change === 'post') return page('posts', [{ ...post, _id: id(10) }]);
      if (String(input).includes('/reservations/') && ++details === 2 && change === 'detail') return Response.json({ ...detail, status: 'canceled' });
      return fetcher(input, init);
    };
    await assert.rejects(auditMessageHandoff(env, deps));
  }
});

test('private auth and network errors are never returned; deadline and midnight changes fail closed', async () => {
  const { deps } = fixture();
  for (const patch of [{ token: async () => { throw Error('PRIVATE_AUTH'); } },
    { fetcher: async () => { throw Error('PRIVATE_NETWORK'); } },
    { fetcher: async () => new Response('PRIVATE_BODY', { status: 429 }) }])
    await assert.rejects(auditMessageHandoff(env, { ...deps, ...patch }), e => e instanceof Error && !e.message.includes('PRIVATE'));
  for (const step of [90_001, 86400000, -1]) {
    let n = 0;
    await assert.rejects(auditMessageHandoff(env, { ...deps, clock: () => clock() + step * n++ }));
  }
});

test('post-free and missing conversations never count as verified unsent queues', async () => {
  const { deps } = fixture(), fetcher = deps.fetcher;
  deps.fetcher = async (input, init) => String(input).includes('/conversations?')
    ? page('conversations', []) : fetcher(input, init);
  const result = await auditMessageHandoff(env, deps);
  assert.equal(result.rows[0].issue, 'no_conversation'); assert.equal(result.rows[0].paginationComplete, false);
  assert.equal(result.pendingQueueVerified, false); assert.equal(result.readyForAutomaticMessaging, false);
});
