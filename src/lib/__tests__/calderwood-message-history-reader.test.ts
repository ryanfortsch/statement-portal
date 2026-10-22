import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALDERWOOD } from '../calderwood-readonly/guesty-reader.ts';
import { readCalderwoodMessageHistory } from '../calderwood-readonly/message-history-reader.ts';
import { loadCalderwoodRead } from '../calderwood-readonly/access.ts';
const ident = (n: number) => n.toString(16).padStart(24, '0');
const now = () => new Date('2027-01-01T12:00:00Z');
const stay = { id: ident(1), listingId: CALDERWOOD.guestyListingId, start: '2027-01-15', end: '2027-01-18', status: 'confirmed', source: 'synthetic', timing: { arrivalAt: null, departureAt: null, issues: [], clockVerified: false } };
const conversation = { _id: ident(2), accountId: ident(3), meta: { reservations: [{ _id: stay.id, status: 'confirmed', listing: { _id: stay.listingId } }] } };
const post = { _id: ident(4), conversationId: conversation._id, module: { type: 'airbnb2' }, from: { type: 'user' }, createdAt: '2026-12-01T12:34:56.123Z', isFromMigration: false };
const page = (key: string, values: unknown[], after = '') => ({ status: 200, data: { [key]: values, cursor: { after, before: '' } } });
const conversations = (values: unknown[] = [conversation], after = '') => Response.json(page('conversations', values, after));
const posts = (values: unknown[] = [post], after = '') => Response.json(page('posts', values, after));
const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'codex/channex-staging-pilot', CHANNEX_STAGING_ENABLED: 'true' };
const input = { email: 'staff@risingtidestr.com', env, from: '2027-01-01', to: '2027-02-01', includeMessageHistory: true };
const read = async () => ({ mode: 'read-only-snapshot' as const, executable: false as const, inventoryAuthority: false as const, paginationComplete: true as const, baselineComplete: false as const, missingEvidence: ['independent-blocks', 'authoritative-revisions', 'channex-mapping', 'cross-provider-comparison'] as const, window: { from: input.from, to: input.to }, reservations: [stay] });

test('GET-only collector binds exact stay and projects records without claiming delivery or exposing content', async () => {
  const calls: string[] = [];
  const result = await readCalderwoodMessageHistory('secret-token', [stay], async (url, init) => {
    calls.push(url); const request = new URL(url);
    assert.equal(request.origin, 'https://open-api.guesty.com');
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer secret-token');
    if (request.pathname.endsWith('/posts')) return posts([{ ...post, body: 'PRIVATE', sentAt: post.createdAt, status: 'sent', attachments: ['PRIVATE'], module: { type: 'airbnb2', to: ['PRIVATE'] }, from: { type: 'user', fullName: 'PRIVATE' } }]);
    assert.equal(request.searchParams.get('type'), 'guest');
    assert.equal(request.searchParams.get('fields'), '_id accountId createdAt meta.reservations._id meta.reservations.status meta.reservations.listing._id');
    assert.deepEqual(JSON.parse(request.searchParams.get('filters')!), [{ field: 'reservation._id', operator: '$eq', value: stay.id }, { field: 'listing._id', operator: '$eq', value: CALDERWOOD.guestyListingId }]);
    return conversations([{ ...conversation, guest: 'PRIVATE' }]);
  }, now);
  assert.equal(calls.length, 2);
  assert.equal(result.stays[0].paginationComplete, true);
  assert.deepEqual(result.stays[0].posts[0], { id: post._id, conversationId: conversation._id, recordedAt: post.createdAt, module: 'airbnb2', author: 'user', imported: false });
  for (const flag of ['executable', 'handoffComplete', 'queueVerified', 'cleanerHistoryVerified', 'deliveryVerified'] as const) assert.equal(result[flag], false);
  for (const secret of ['PRIVATE', 'secret-token', 'sentAt', 'workflow']) assert.ok(!JSON.stringify(result).includes(secret));
});

test('follows nonempty cursor even for a short page and waits for explicit empty cursor', async () => {
  const requests: string[] = [];
  const result = await readCalderwoodMessageHistory('token', [stay], async url => {
    const request = new URL(url); requests.push(url);
    if (request.pathname.endsWith('/posts')) return request.searchParams.has('cursorAfter') ? posts([{ ...post, _id: ident(5) }]) : posts([post], 'next-post');
    return request.searchParams.has('cursorAfter') ? conversations([]) : conversations([conversation], 'next-conversation');
  }, now);
  assert.equal(requests.length, 4); assert.equal(result.stays[0].posts.length, 2);
  assert.equal(new URL(requests[1]).searchParams.get('cursorAfter'), 'next-conversation');
  assert.equal(new URL(requests[3]).searchParams.get('cursorAfter'), 'next-post');
});

test('no thread and shared returning-guest threads cannot become empty verified history', async () => {
  for (const values of [[], [{ ...conversation, meta: { reservations: [...conversation.meta.reservations, { _id: ident(9) }] } }]]) {
    let calls = 0;
    const result = await readCalderwoodMessageHistory('token', [stay], async () => { calls++; return conversations(values); }, now);
    assert.equal(calls, 1); assert.equal(result.stays[0].paginationComplete, false); assert.equal(result.stays[0].posts.length, 0);
    assert.equal(result.stays[0].issue, values.length ? 'shared_conversation' : 'no_conversation');
  }
});

test('invalid scope, duplicate stays and oversized collection fail before network', async () => {
  let calls = 0; const fetcher = async () => { calls++; return conversations(); };
  for (const rows of [[{ ...stay, id: '../other' }], [{ ...stay, listingId: 'foreign' }], [stay, stay], Array.from({ length: 13 }, (_, n) => ({ ...stay, id: ident(n) }))]) await assert.rejects(readCalderwoodMessageHistory('token', rows as Parameters<typeof readCalderwoodMessageHistory>[1], fetcher, now));
  for (const token of ['', 'bad\r\n']) await assert.rejects(readCalderwoodMessageHistory(token, [stay], fetcher, now));
  await assert.rejects(readCalderwoodMessageHistory('token', [stay], fetcher, () => new Date('invalid')));
  assert.equal(calls, 0);
  const result = await readCalderwoodMessageHistory('token', [{ ...stay, status: 'closed' }], fetcher, now);
  assert.equal(result.stays.length, 0); assert.equal(calls, 0);
});

test('foreign or changed conversation identity is rejected before reading posts', async () => {
  for (const c of [{ ...conversation, _id: '../bad' }, { ...conversation, accountId: null }, { ...conversation, meta: {} },
    ...[{ _id: ident(99), status: 'confirmed', listing: { _id: stay.listingId } }, { ...conversation.meta.reservations[0], status: 'canceled' }, { ...conversation.meta.reservations[0], listing: { _id: 'other' } }].map(r => ({ ...conversation, meta: { reservations: [r] } }))]) {
    let calls = 0;
    await assert.rejects(readCalderwoodMessageHistory('token', [stay], async () => { calls++; return conversations([c]); }, now));
    assert.equal(calls, 1);
  }
});

test('provider errors and malformed JSON never leak response, token or exception content', async () => {
  for (const response of [new Response('PRIVATE', { status: 401 }), new Response('PRIVATE', { status: 429 }), new Response('PRIVATE', { status: 404 }), new Response('PRIVATE'), Response.json({ status: 200, data: { conversations: [] } })]) {
    await assert.rejects(readCalderwoodMessageHistory('token', [stay], async () => response, now), e => e instanceof Error && !e.message.includes('PRIVATE'));
  }
  await assert.rejects(readCalderwoodMessageHistory('token', [stay], async () => { throw Error('PRIVATE'); }, now), e => e instanceof Error && !e.message.includes('PRIVATE'));
});

test('missing cursor, repeated cursor, repeated posts and cross-thread posts fail closed', async () => {
  for (const makePosts of [() => Response.json({ status: 200, data: { posts: [] } }), () => posts([post, post]), () => posts([{ ...post, conversationId: ident(99) }]), () => posts([{ ...post, createdAt: '2027-01-02T00:00:00Z' }]), () => posts([{ ...post, createdAt: '2027-02-30T00:00:00Z' }])]) {
    await assert.rejects(readCalderwoodMessageHistory('token', [stay], async url => url.includes('/posts?') ? makePosts() : conversations(), now));
  }
  let n = 10;
  await assert.rejects(readCalderwoodMessageHistory('token', [stay], async url => url.includes('/posts?') ? posts([{ ...post, _id: ident(n++) }], 'repeated') : conversations(), now), /cursor repeated/);
});

test('bounded pagination and duration cannot report successful incomplete reads', async () => {
  let n = 10;
  await assert.rejects(readCalderwoodMessageHistory('token', [stay], async url => url.includes('/posts?') ? posts([{ ...post, _id: ident(n++) }], `cursor-${n}`) : conversations(), now), /pagination limit/);
  let stamp = 0;
  await assert.rejects(readCalderwoodMessageHistory('token', [stay], async () => conversations(), () => new Date(now().getTime() + stamp++ * 91000)), /time limit/);
});

test('mixed accounts and duplicated conversations cannot be silently combined', async () => {
  for (const values of [[conversation, conversation], [conversation, { ...conversation, _id: ident(20), accountId: ident(30) }]]) await assert.rejects(readCalderwoodMessageHistory('token', [stay], async () => conversations(values), now));
});

test('notes, logs, unknown metadata and migrated posts remain unclassified records', async () => {
  const result = await readCalderwoodMessageHistory('token', [stay], async url => url.includes('/posts?') ? posts([
    { ...post, module: { type: 'log' }, from: undefined }, { ...post, _id: ident(5), module: { type: 'PRIVATE' }, from: { type: 'PRIVATE' }, isFromMigration: true },
  ]) : conversations(), now);
  assert.deepEqual(result.stays[0].posts.map(p => [p.module, p.author, p.imported]), [['log', 'unknown', false], ['unknown', 'unknown', true]]);
  assert.equal(result.deliveryVerified, false); assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('evidence digest changes only with projected source records', async () => {
  const collect = (body: string, createdAt = post.createdAt) => readCalderwoodMessageHistory('token', [stay], async url => url.includes('/posts?') ? posts([{ ...post, body, createdAt }]) : conversations(), now);
  assert.equal((await collect('one')).evidenceDigest, (await collect('two')).evidenceDigest);
  assert.notEqual((await collect('one')).evidenceDigest, (await collect('one', '2026-12-02T12:00:00Z')).evidenceDigest);
});

test('preview guards run before token and history access; optional source failure retains the booking read', async () => {
  let tokenCalls = 0, historyCalls = 0;
  const deps = { token: async () => { tokenCalls++; return 'secret'; }, read, messageHistory: async () => { historyCalls++; throw Error('PRIVATE'); } };
  await assert.rejects(loadCalderwoodRead({ ...input, env: { ...env, VERCEL_ENV: 'production' } }, deps));
  assert.equal(tokenCalls, 0); assert.equal(historyCalls, 0);
  const result = await loadCalderwoodRead(input, deps);
  assert.equal(result.messageHistory, null); assert.equal(result.messageHistoryError, true); assert.equal(result.reservations.length, 1);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  await loadCalderwoodRead({ ...input, includeMessageHistory: false }, deps);
  assert.equal(historyCalls, 1);
});

test('protected loader runs the actual collector against its bounded confirmed snapshot', async () => {
  const result = await loadCalderwoodRead(input, { token: async () => 'secret', read, messageHistory: (token, stays) => readCalderwoodMessageHistory(token, stays, async url => url.includes('/posts?') ? posts() : conversations(), now) });
  assert.equal(result.messageHistoryError, false); assert.equal(result.messageHistory?.stays[0].posts.length, 1);
  assert.equal(result.messageHistory?.handoffComplete, false);
});


test('a shared conversation appearing for both requested stays remains explicitly unresolved for both', async () => {
  const other = { ...stay, id: ident(99) };
  const shared = { ...conversation, meta: { reservations: [...conversation.meta.reservations, { ...conversation.meta.reservations[0], _id: other.id }] } };
  let calls = 0;
  const result = await readCalderwoodMessageHistory('token', [stay, other], async () => { calls++; return conversations([shared]); }, now);
  assert.equal(calls, 2);
  assert.deepEqual(result.stays.map(s => s.issue), ['shared_conversation', 'shared_conversation']);
  assert.ok(result.stays.every(s => !s.paginationComplete && s.posts.length === 0));
});
