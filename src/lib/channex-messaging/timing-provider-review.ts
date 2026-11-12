import 'server-only';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { GUESTY_ACCOUNT, GUESTY_CALDERWOOD } from '../channex-bookings/message-identity.ts';
import { projectRemoteBooking } from '../channex-bookings/reconciliation.ts';
import { CALDERWOOD_PRODUCTION as mapping } from '../channex-production-preflight.ts';
import { todayInEastern } from '../sca-quotes-types.ts';
import { readGuestySourceTiming } from './preparation.ts';
import { scheduleContextSchema } from './schedule-store.ts';
import { inspectMessageThreadIdentity } from './thread-identity.ts';
import { discoverBookingThread } from './thread-discovery.ts';
import { sourceTimingRowSchema } from './timing-evidence.ts';
import type { createChannexTimingBindingStore } from './timing-binding-store.ts';

const id = z.uuid(), instant = z.iso.datetime({ offset: true });
const requestSchema = z.object({ bindingId: id, captureId: id, bookingId: id }).strict();
type ReviewRequest = z.infer<typeof requestSchema>;
const snapshotSchema = z.object({
  capture: z.object({ id, checkedAt: instant, savedAt: instant,
    sourceContract: z.literal('guesty_v2_clocks_v3_confirmed_at_double_read'), row: sourceTimingRowSchema }).strict(),
  context: scheduleContextSchema,
  scope: z.object({ environment: z.literal('production'), propertyId: z.literal(mapping.propertyId),
    channelId: id, provider: z.literal('Airbnb') }).strict(),
  route: z.object({ remoteBookingId: id, threadId: id.optional(), revisionId: id }).strict(),
}).strict();
type ReviewDeps = {
  // Trusted server loader: retained capture, current enabled schedule context,
  // scope and persisted booking mapping. Never implement this with browser JSON.
  load: (request: Readonly<ReviewRequest>) => Promise<unknown>;
  credentials: () => Promise<{ guestyToken: string; channexKey: string }>;
  store: Pick<ReturnType<typeof createChannexTimingBindingStore>, 'bind'>;
  fetcher?: typeof fetch; clock?: () => number;
};
type State = 'disabled' | 'invalid' | 'unavailable' | 'changed' | 'created' | 'existing' | 'uncertain';
class Changed extends Error {}
function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error();
  return raw as Record<string, unknown>;
}

/** Explicit one-stay provider review, default off. Up to 18 GETs including bounded
 * thread discovery (eight when the trusted loader already has a thread); no provider
 * writes, scheduler or sender. Original capture values must still match Guesty,
 * while Channex must match the persisted latest revision and the exact open
 * booking/property/channel thread. Irrelevant guest/payment/message data is dropped.
 *
 * The caller retains bindingId. An uncertain save is reconciled through the stored
 * binding; never rotate its ID or automatically repeat this review. SQL validates
 * retained capture/current context again under locks when bind() commits.
 * This is not permission to hand over or send messages.
 */
export async function reviewCalderwoodTimingBinding(raw: unknown, actor: string, deps: ReviewDeps,
  options: { enabled?: boolean } = {}) {
  let requests = 0;
  const result = (state: State, bindingId?: string) => ({ state, ...(bindingId ? { bindingId } : {}),
    sourceReads: requests, jobsCreated: 0 as const, messagesSent: 0 as const, canSend: false as const });
  if (options.enabled !== true) return result('disabled');
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success || typeof actor !== 'string' || actor.trim().length < 3 || actor.trim().length > 320)
    return result('invalid');
  const request = Object.freeze(parsed.data), clock = deps.clock ?? Date.now, fetcher = deps.fetcher ?? fetch;
  let saving = false;
  try {
    const started = clock();
    if (!Number.isSafeInteger(started)) throw Error();
    const day = todayInEastern(new Date(started));
    let last = started;
    const remaining = () => {
      const at = clock();
      if (!Number.isSafeInteger(at) || at < last || at - started >= 80_000 || todayInEastern(new Date(at)) !== day) throw Error();
      last = at; return 80_000 - (at - started);
    };
    const load = async () => {
      remaining();
      const s = snapshotSchema.parse(await deps.load(request)); remaining();
      if (s.capture.id !== request.captureId || s.capture.row.bookingId !== request.bookingId
        || s.capture.row.start >= s.capture.row.end || s.capture.row.end <= day
        || Date.parse(s.capture.row.clocks.confirmedAt) > Date.parse(s.capture.checkedAt)
        || Date.parse(s.capture.checkedAt) > Date.parse(s.capture.savedAt)
        || Date.parse(s.capture.savedAt) > started || Date.parse(s.context.sourceEvidenceAt) > started) throw Error();
      return s;
    };
    const before = await load();
    const credentials = await deps.credentials(); remaining();
    const { guestyToken, channexKey } = credentials;
    if ([guestyToken, channexKey].some(k => typeof k !== 'string' || !k || k.length > 4096 || /[\x00-\x20\x7f]/.test(k))) throw Error();
    const read = async (provider: 'guesty' | 'channex', path: string, maxBytes: number) => {
      if (++requests > 18) throw Error();
      const res = await fetcher((provider === 'guesty' ? 'https://open-api.guesty.com/v1' : 'https://app.channex.io/api/v1') + path,
        { method: 'GET', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(Math.min(8000, remaining())),
          headers: { Accept: 'application/json', ...(provider === 'guesty'
            ? { Authorization: `Bearer ${guestyToken}` } : { 'user-api-key': channexKey }) } });
      if (res.status !== 200 || res.redirected || !res.body) { await res.body?.cancel(); throw Error(); }
      const reader = res.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
      try {
        for (;;) {
          const part = await reader.read(); remaining();
          if (part.done) break;
          bytes += part.value.byteLength; if (bytes > maxBytes) throw Error(); chunks.push(part.value);
        }
        const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        if (provider === 'channex') {
          const envelope = object(value), meta = envelope.meta === undefined ? {} : object(envelope.meta);
          if (envelope.errors !== undefined || (meta.warnings !== undefined
            && (!Array.isArray(meta.warnings) || meta.warnings.length))) throw Error();
        }
        return value;
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    };
    const { row } = before.capture, { remoteBookingId, revisionId } = before.route;
    const scan = async () => {
      const [observed] = await readGuestySourceTiming([{ canonicalId: row.bookingId, id: row.guestyId,
        listingId: GUESTY_CALDERWOOD, accountId: GUESTY_ACCOUNT, code: row.code,
        start: row.start, end: row.end, status: 'confirmed' }], (path, bytes) => read('guesty', path, bytes), started);
      if (!observed || !isDeepStrictEqual(observed.clocks, { start: row.start, end: row.end, ...row.clocks })) throw new Changed();
      // GET booking-by-ID returns the latest revision; no feed ACK or raw fields.
      const remote = projectRemoteBooking(object(await read('channex', `/bookings/${remoteBookingId}`, 1_048_576)).data);
      if (remote.id !== remoteBookingId || remote.revisionId !== revisionId || remote.code !== row.code
        || remote.checkIn !== row.start || remote.checkOut !== row.end || remote.status === 'cancelled') throw new Changed();
      const threadId = before.route.threadId ?? await discoverBookingThread(
        (path, bytes) => read('channex', path, bytes), before.scope, remoteBookingId);
      const thread = object(await read('channex', `/message_threads/${threadId}`, 1_048_576)).data;
      if (inspectMessageThreadIdentity(thread, before.scope, { bookingId: remoteBookingId, threadId }, true)) throw new Changed();
      return { remote, threadId };
    };
    const first = await scan(), second = await scan();
    if (!isDeepStrictEqual(first, second) || !isDeepStrictEqual(before, await load())) throw new Changed();
    remaining();
    const intent = { ...request, context: before.context, remoteBookingId, threadId: first.threadId, reviewedRow: row,
      reviewStartedAt: new Date(started).toISOString(), reviewCheckedAt: new Date(last).toISOString() };
    saving = true;
    const saved = await deps.store.bind(intent, actor.trim(), clock);
    if ((saved.state !== 'created' && saved.state !== 'existing') || saved.bindingId !== request.bindingId)
      return result('uncertain', request.bindingId);
    return result(saved.state, saved.bindingId);
  } catch (error) {
    // Never return provider data, credentials, arbitrary field names or exceptions.
    return result(saving ? 'uncertain' : error instanceof Changed ? 'changed' : 'unavailable', saving ? request.bindingId : undefined);
  }
}
