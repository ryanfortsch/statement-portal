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
type ProviderDeps = {
  // Trusted server loader: retained capture, current enabled schedule context,
  // scope and persisted booking mapping. Never implement this with browser JSON.
  load: (request: Readonly<Pick<ReviewRequest, 'captureId' | 'bookingId'>>) => Promise<unknown>;
  credentials: () => Promise<{ guestyToken: string; channexKey: string }>;
  fetcher?: typeof fetch; clock?: () => number;
};
type State = 'disabled' | 'invalid' | 'unavailable' | 'changed' | 'created' | 'existing' | 'uncertain';
class Changed extends Error {}
function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error();
  return raw as Record<string, unknown>;
}

/** Private read-only provider check, shared by owner review and scheduling.
 * A successful observation is not a binding, a source-drain proof or permission
 * to send. Keep the verified snapshot server-side. No persistence or provider POST.
 */
export async function inspectCalderwoodTimingProviders(raw: unknown, deps: ProviderDeps,
  options: { enabled?: boolean } = {}) {
  let requests = 0;
  const result = (state: 'disabled' | 'invalid' | 'unavailable' | 'changed') => ({ state, sourceReads: requests });
  if (options.enabled !== true) return result('disabled');
  const parsed = requestSchema.omit({ bindingId: true }).safeParse(raw);
  if (!parsed.success) return result('invalid');
  const request = Object.freeze(parsed.data), clock = deps.clock ?? Date.now, fetcher = deps.fetcher ?? fetch;
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
    return { state: 'verified' as const, sourceReads: requests, snapshot: before,
      threadId: first.threadId, startedAt: new Date(started).toISOString(), checkedAt: new Date(last).toISOString() };
  } catch (error) { return result(error instanceof Changed ? 'changed' : 'unavailable'); }
}

/** Explicit owner review. Only this wrapper persists a binding; the shared
 * provider inspection above never creates or refreshes one. No automatic retry.
 */
export async function reviewCalderwoodTimingBinding(raw: unknown, actor: string,
  deps: ProviderDeps & { store: Pick<ReturnType<typeof createChannexTimingBindingStore>, 'bind'> },
  options: { enabled?: boolean } = {}) {
  const result = (state: State, sourceReads: number, bindingId?: string) => ({ state,
    ...(bindingId ? { bindingId } : {}), sourceReads, jobsCreated: 0 as const, messagesSent: 0 as const, canSend: false as const });
  if (options.enabled !== true) return result('disabled', 0);
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success || typeof actor !== 'string' || actor.trim().length < 3 || actor.trim().length > 320)
    return result('invalid', 0);
  const request = parsed.data;
  const inspected = await inspectCalderwoodTimingProviders({ captureId: request.captureId, bookingId: request.bookingId }, deps, options);
  if (inspected.state !== 'verified') return result(inspected.state, inspected.sourceReads);
  const intent = { ...request, context: inspected.snapshot.context,
    remoteBookingId: inspected.snapshot.route.remoteBookingId, threadId: inspected.threadId,
    reviewedRow: inspected.snapshot.capture.row, reviewStartedAt: inspected.startedAt, reviewCheckedAt: inspected.checkedAt };
  try {
    const saved = await deps.store.bind(intent, actor.trim(), deps.clock ?? Date.now);
    if ((saved.state !== 'created' && saved.state !== 'existing') || saved.bindingId !== request.bindingId)
      return result('uncertain', inspected.sourceReads, request.bindingId);
    return result(saved.state, inspected.sourceReads, saved.bindingId);
  } catch { return result('uncertain', inspected.sourceReads, request.bindingId); }
}
