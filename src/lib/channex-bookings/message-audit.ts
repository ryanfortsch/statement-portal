import 'server-only';
import { requireProductionInspectionEnvironment } from '../channex-production-runtime.ts';
import { fingerprint, parseCanonicalSnapshot } from './reconciliation.ts';
import { todayInEastern, shiftIsoDay } from '../sca-quotes-types.ts';
import { MessageHandoffError, resolveMessageStayIdentities, type GuestyHandoffStay } from './message-identity.ts';
import { readCalderwoodMessageHistory } from './message-history.ts';

type Context = { canonical: unknown; mirror: unknown; automationsEnabled: boolean };
type Dependencies = { context: () => Promise<Context>; verifyDormant: () => Promise<void>;
  token: () => Promise<string>; fetcher?: typeof fetch; clock?: () => number };

/** Temporary migration read using the documented, still available field-projected
 * reservation detail endpoint. It avoids reading finances/guest contact fields.
 * No legacy list feed, message POST, queue toggle, ACK or ledger writer. */
async function verifySourceStays(stays: GuestyHandoffStay[], token: string, fetcher: typeof fetch, remaining: () => number) {
  const fields = '_id accountId listingId confirmationCode checkInDateLocalized checkOutDateLocalized status integration.platform';
  for (const stay of stays) {
    try {
      const res = await fetcher(`https://open-api.guesty.com/v1/reservations/${stay.id}?${new URLSearchParams({ fields })}`, {
        method: 'GET', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(Math.min(8000, remaining())),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (res.status !== 200 || res.redirected) throw Error();
      const text = await res.text(); if (text.length > 100_000) throw Error();
      const d = JSON.parse(text);
      if (d?._id !== stay.id || d.accountId !== stay.accountId || d.listingId !== stay.listingId
        || d.confirmationCode !== stay.code || d.status !== 'confirmed' || d.integration?.platform !== 'airbnb2'
        || d.checkInDateLocalized !== stay.start || d.checkOutDateLocalized !== stay.end) throw Error();
      remaining();
    } catch { throw new MessageHandoffError('SOURCE_READ_FAILED'); }
  }
}

/** Owner-only observation, not handoff evidence or a send authorization. Two
 * equal scans detect changes but cannot establish atomic source completeness. */
export async function auditMessageHandoff(env: Record<string, string | undefined>, deps: Dependencies) {
  requireProductionInspectionEnvironment(env);
  const clock = deps.clock ?? Date.now, fetcher = deps.fetcher ?? fetch;
  const started = clock(), start = todayInEastern(new Date(started)), end = shiftIsoDay(start, 500);
  const remaining = () => {
    const now = clock(), left = 90_000 - (now - started);
    if (!Number.isSafeInteger(now) || now < started || left <= 0 || todayInEastern(new Date(now)) !== start)
      throw new MessageHandoffError('READ_LIMIT_REACHED');
    return left;
  };
  try {
    await deps.verifyDormant();
    const before = await deps.context();
    if (before.automationsEnabled !== false) throw new MessageHandoffError('MESSAGE_AUTOMATIONS_ENABLED');
    const canonical = parseCanonicalSnapshot(before.canonical);
    const stays = resolveMessageStayIdentities(canonical, before.mirror, start, end);
    const token = await deps.token();
    if (!token || token.length > 4096 || /[\x00-\x20\x7f]/.test(token)) throw new MessageHandoffError('SOURCE_READ_FAILED');
    let requests = 0;
    const boundedFetch: typeof fetch = async (input, init) => {
      const left = remaining();
      if (++requests > 75) throw new MessageHandoffError('READ_LIMIT_REACHED');
      return fetcher(input, { ...init, signal: AbortSignal.any([AbortSignal.timeout(left), ...(init?.signal ? [init.signal] : [])]) });
    };
    await verifySourceStays(stays, token, boundedFetch, remaining);
    const first = await readCalderwoodMessageHistory(token, stays, boundedFetch, () => new Date(clock()));
    const second = await readCalderwoodMessageHistory(token, stays, boundedFetch, () => new Date(clock()));
    await verifySourceStays(stays, token, boundedFetch, remaining);
    const after = await deps.context();
    await deps.verifyDormant(); remaining();
    if (fingerprint(before) !== fingerprint(after) || first.evidenceDigest !== second.evidenceDigest)
      throw new MessageHandoffError('SOURCES_CHANGED');
    return { ok: true, mode: 'message-handoff-review', property: '65_calderwood', observedAt: new Date(clock()).toISOString(),
      window: { start, end }, currentAndUpcomingStays: stays.length, repeatedObservationsAgree: true,
      canonicalFingerprint: fingerprint(canonical), recordFingerprint: first.evidenceDigest,
      conversationRecords: first.stays.reduce((n, s) => n + s.posts.length, 0),
      rows: first.stays.map(s => ({ canonicalId: stays.find(b => b.id === s.reservationId)!.canonicalId,
        guestyReservationId: s.reservationId, conversationIds: s.conversationIds,
        records: s.posts.length, paginationComplete: s.paginationComplete, issue: s.issue,
        sourceConversationUrls: s.conversationIds.map(id => `https://app.guesty.com/inbox/${id}`) })),
      guestDeliveryHistoryVerified: false, cleanerDeliveryHistoryVerified: false, pendingQueueVerified: false,
      sourceStoppedAndDrained: false, readyForAutomaticMessaging: false,
      bookingsChanged: 0, messagesSent: 0, historicalSendsImported: 0,
      nextChecks: ['Guesty workflow completion and future queue per stay', 'Cleaner send history per recipient',
        'Verified current Channex conversation', 'Guesty queue stop/drain at cutover'] };
  } catch (e) {
    if (e instanceof MessageHandoffError) throw e;
    throw new MessageHandoffError('HANDOFF_READ_FAILED');
  }
}
