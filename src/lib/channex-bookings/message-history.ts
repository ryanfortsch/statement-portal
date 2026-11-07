/** GET-only guest-conversation evidence. Posts are records, not delivery receipts.
 * Contracts: https://open-api-docs.guesty.com/reference/get_communication-conversations
 * https://open-api-docs.guesty.com/reference/get_communication-conversations-conversationid-posts
 * No body, contact, attachment, credential, workflow inference or database access.
 */
import { createHash } from 'node:crypto';
import { GUESTY_CALDERWOOD, GUESTY_ACCOUNT, type GuestyHandoffStay } from './message-identity.ts';

const CALDERWOOD = { guestyListingId: GUESTY_CALDERWOOD };
type Reservation = GuestyHandoffStay;
type Fetcher = (input: string, init: RequestInit) => Promise<Response>;
type Row = Record<string, unknown>;
export type GuestyPostEvidence = {
  id: string; conversationId: string; recordedAt: string;
  module: 'airbnb2' | 'platform' | 'email' | 'sms' | 'note' | 'log' | 'unknown';
  author: 'user' | 'guest' | 'system' | 'unknown';
  imported: boolean | null;
};
export type GuestyStayHistory = {
  reservationId: string; accountId: string | null; conversationIds: string[];
  posts: GuestyPostEvidence[]; paginationComplete: boolean;
  issue: 'no_conversation' | 'shared_conversation' | null;
};
export type GuestyHistorySnapshot = {
  mode: 'read-only-message-records'; executable: false; handoffComplete: false;
  queueVerified: false; cleanerHistoryVerified: false; deliveryVerified: false;
  startedAt: string; finishedAt: string; evidenceDigest: string; stays: GuestyStayHistory[];
};
const fields = '_id accountId createdAt meta.reservations._id meta.reservations.status meta.reservations.listing._id';
function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid message evidence response');
  return value as Row;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{24}$/.test(value)) throw Error('Invalid message evidence identity');
  return value;
}
function page(value: unknown, key: 'conversations' | 'posts', max: number) {
  const envelope = row(value), data = row(envelope.data), cursor = row(data.cursor);
  if (envelope.status !== 200 || !Array.isArray(data[key]) || data[key].length > max
    || typeof cursor.after !== 'string' || cursor.after.length > 2048 || /[\r\n]/.test(cursor.after)) throw Error('Incomplete message evidence page');
  if (cursor.after && data[key].length === 0) throw Error('Empty continuing message evidence page');
  return { values: data[key] as unknown[], after: cursor.after };
}
function post(value: unknown, conversationId: string, reservationId: string, now: Date): GuestyPostEvidence {
  const p = row(value), deliveryModule = row(p.module);
  if (p.conversationId !== conversationId) throw Error('Message conversation changed');
  if (p.reservationId != null && p.reservationId !== reservationId) throw Error('Message reservation changed');
  const recordedAt = confirmedInstant(p.createdAt, now);
  if (!recordedAt) throw Error('Invalid message record time');
  // Only documented metadata is retained. Even a source field named sentAt or
  // status=sent cannot turn a post into a workflow delivery receipt here.
  const kinds = ['airbnb2', 'platform', 'email', 'sms', 'note', 'log'];
  const author = p.from && typeof p.from === 'object' && !Array.isArray(p.from) ? (p.from as Row).type : null;
  return { id: id(p._id), conversationId, recordedAt,
    module: kinds.includes(deliveryModule.type as string) ? deliveryModule.type as GuestyPostEvidence['module'] : 'unknown',
    author: ['user', 'guest', 'system'].includes(author as string) ? author as GuestyPostEvidence['author'] : 'unknown',
    imported: typeof p.isFromMigration === 'boolean' ? p.isFromMigration : null };
}
export async function readCalderwoodMessageHistory(token: string, reservations: Reservation[],
  fetcher: Fetcher = fetch, clock: () => Date = () => new Date()): Promise<GuestyHistorySnapshot> {
  const start = clock();
  if (typeof globalThis.window !== 'undefined' || !token || token.length > 4096 || /[\x00-\x20\x7f]/.test(token)
    || !Number.isFinite(start.getTime())) throw Error('Explicit server token and observation time required');
  const confirmed = reservations.filter(r => r.status === 'confirmed');
  if (confirmed.length > 12) throw Error('Message evidence is limited to 12 confirmed stays');
  const requested = new Set<string>();
  const accounts = new Set<string>();
  for (const r of confirmed) {
    if (r.listingId !== CALDERWOOD.guestyListingId || requested.has(id(r.id))) throw Error('Invalid message evidence request scope');
    requested.add(r.id); accounts.add(id(r.accountId));
    if (accounts.size > 1 || r.accountId !== GUESTY_ACCOUNT) throw Error('Account outside scope');
  }
  let calls = 0;
  const now = () => {
    const result = clock();
    if (!Number.isFinite(result.getTime()) || result.getTime() < start.getTime() || result.getTime() - start.getTime() > 90000) throw Error('Message evidence collection time limit reached');
    return result;
  };
  async function get(path: string, query: URLSearchParams) {
    now();
    if (++calls > 75) throw Error('Message evidence request limit reached');
    let response: Response;
    try {
      response = await fetcher(`https://open-api.guesty.com/v1/communication/conversations${path}?${query}`, {
        method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bearer ${token.trim()}`, Accept: 'application/json' },
      });
    } catch { throw Error('Message evidence request failed; details withheld'); }
    if (response.status !== 200 || response.redirected) throw Error(`Message evidence HTTP ${response.status}; response withheld`);
    try { const text = await response.text(); if (text.length > 2_000_000) throw Error(); const result: unknown = JSON.parse(text); now(); return result; }
    catch { throw Error('Invalid or timed-out message evidence response; details withheld'); }
  }
  const stays: GuestyStayHistory[] = [], postIds = new Set<string>(), exclusiveConversationIds = new Set<string>();
  let accountId: string | null = null;
  for (const reservation of confirmed) {
    const conversations: { id: string; shared: boolean }[] = [];
    const conversationIds = new Set<string>();
    const query = new URLSearchParams({ type: 'guest', fields, sort: 'createdAt', limit: '25',
      filters: JSON.stringify([{ field: 'reservation._id', operator: '$eq', value: reservation.id },
        { field: 'listing._id', operator: '$eq', value: CALDERWOOD.guestyListingId }]) });
    let after = '', complete = false;
    const cursors = new Set<string>();
    for (let n = 0; n < 4; n++) {
      if (after) query.set('cursorAfter', after);
      const result = page(await get('', query), 'conversations', 25);
      for (const value of result.values) {
        const c = row(value), conversationId = id(c._id), sourceAccount = id(c.accountId);
        if (sourceAccount !== reservation.accountId) throw Error('Conversation account outside scope');
        if (conversationIds.has(conversationId)) throw Error('Repeated or cross-stay conversation');
        conversationIds.add(conversationId);
        if (accountId && accountId !== sourceAccount) throw Error('Message evidence account changed');
        accountId = sourceAccount;
        const meta = row(c.meta);
        if (!Array.isArray(meta.reservations) || meta.reservations.length === 0) throw Error('Conversation reservation binding missing');
        const matches = meta.reservations.map(row).filter(r => r._id === reservation.id);
        if (matches.length !== 1 || matches[0].status !== 'confirmed'
          || row(matches[0].listing)._id !== CALDERWOOD.guestyListingId) throw Error('Conversation outside requested stay');
        conversations.push({ id: conversationId, shared: meta.reservations.length !== 1 });
        if (conversations.length > 4) throw Error('Too many conversations for pilot stay');
      }
      after = result.after;
      if (!after) { complete = true; break; }
      if (cursors.has(after)) throw Error('Message evidence cursor repeated');
      cursors.add(after);
    }
    if (!complete) throw Error('Conversation pagination limit reached');
    const stay: GuestyStayHistory = { reservationId: reservation.id, accountId: conversations.length ? accountId : null,
      conversationIds: conversations.map(c => c.id).sort(), posts: [], paginationComplete: false,
      issue: !conversations.length ? 'no_conversation' : conversations.some(c => c.shared) ? 'shared_conversation' : null };
    // Returning-guest threads can span multiple stays. Do not assign their posts
    // to one reservation or read unrelated guest content to guess the match.
    if (stay.issue) { stays.push(stay); continue; }
    for (const conversation of conversations) {
      if (exclusiveConversationIds.has(conversation.id)) throw Error('Repeated cross-stay conversation');
      exclusiveConversationIds.add(conversation.id);
      const query = new URLSearchParams({ sort: 'createdAt' });
      let after = '', complete = false;
      const cursors = new Set<string>();
      for (let n = 0; n < 20; n++) {
        if (after) query.set('cursorAfter', after);
        const result = page(await get(`/${conversation.id}/posts`, query), 'posts', 100);
        for (const value of result.values) {
          const evidence = post(value, conversation.id, reservation.id, now());
          if (postIds.has(evidence.id)) throw Error('Repeated message record');
          postIds.add(evidence.id); stay.posts.push(evidence);
          if (stay.posts.length > 500) throw Error('Message record limit reached');
        }
        after = result.after;
        if (!after) { complete = true; break; }
        if (cursors.has(after)) throw Error('Message evidence cursor repeated');
        cursors.add(after);
      }
      if (!complete) throw Error('Message pagination limit reached');
    }
    stay.posts.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id));
    stay.paginationComplete = true;
    stays.push(stay);
  }
  return { mode: 'read-only-message-records', executable: false, handoffComplete: false,
    queueVerified: false, cleanerHistoryVerified: false, deliveryVerified: false,
    startedAt: start.toISOString(), finishedAt: now().toISOString(), stays,
    evidenceDigest: createHash('sha256').update(JSON.stringify(stays)).digest('hex') };
}

function confirmedInstant(value: unknown, now: Date): string | null {
  if (!Number.isFinite(now.getTime())) throw Error('Valid observation time required');
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) return null;
  const date = value.slice(0, 10), day = Date.parse(date + 'T00:00:00Z'), at = Date.parse(value);
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== date || !Number.isFinite(at) || at > now.getTime()) return null;
  return new Date(at).toISOString();
}
