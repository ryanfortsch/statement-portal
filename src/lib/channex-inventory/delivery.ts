import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CALDERWOOD_PRODUCTION as m, inspectCalderwoodProduction } from '../channex-production-preflight.ts';
import { nights } from '../channex-bookings/primitives.ts';
import { todayInEastern } from '../sca-quotes-types.ts';
import { inventoryDigest } from './planner.ts';

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const deliveryAttemptSchema = z.object({ token: z.string().uuid(), planVersion: integer.min(1),
  planId: hash, planDigest: hash, requestBody: z.string().min(1).max(150000), requestDigest: hash,
  start: z.string(), end: z.string(), expiresAt: integer, state: z.literal('leased') }).strict();
export type DeliveryAttempt = z.infer<typeof deliveryAttemptSchema>;
export const deliveryOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('accepted'), taskId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('uncertain') }).strict(),
  z.object({ kind: z.literal('rate-limited'), retryAfterSeconds: integer.min(60).max(86400) }).strict(),
  z.object({ kind: z.literal('unauthorized') }).strict(),
]);
export type DeliveryOutcome = z.infer<typeof deliveryOutcomeSchema>;
export interface InventoryDeliveryStore {
  claim(token: string): Promise<{ status: 'claimed' | 'existing'; attempt: DeliveryAttempt } | { status: 'disabled' | 'blocked' | 'stale' | 'already-accepted' }>;
  begin(token: string, requestDigest: string): Promise<{ status: 'started'; expiresAt: number } | { status: 'blocked' }>;
  record(token: string, requestDigest: string, outcome: DeliveryOutcome): Promise<void>;
}
export interface InventoryRecoveryStore extends InventoryDeliveryStore {
  recover(previousToken: string, token: string): ReturnType<InventoryDeliveryStore['claim']>;
}
export interface PreparedInventoryDelivery { send(): Promise<DeliveryOutcome> }
export interface InventoryDeliveryTransport { prepare(attempt: DeliveryAttempt): Promise<PreparedInventoryDelivery> }
function validAttempt(input: DeliveryAttempt, now: number) {
  const a = deliveryAttemptSchema.parse(input), days = nights(a.start, a.end);
  if (!Number.isSafeInteger(now) || a.start !== todayInEastern(new Date(now)) || a.expiresAt <= now || a.expiresAt > now + 30000 || days.length !== 500 ||
    createHash('sha256').update(a.requestBody).digest('hex') !== a.requestDigest) throw Error('Invalid availability request lease');
  const row = z.object({ property_id: z.literal(m.propertyId), room_type_id: z.literal(m.roomTypeId),
    date: z.string(), availability: z.union([z.literal(0), z.literal(1)]) }).strict();
  const body = z.object({ values: z.array(row).length(500) }).strict().parse(JSON.parse(a.requestBody));
  if (body.values.some((v, i) => v.date !== days[i]) || inventoryDigest(body.values.map(v => ({ date: v.date, available: v.availability }))) !== a.planDigest) {
    throw Error('Availability request does not match its saved plan');
  }
  return a;
}
const accepted = z.object({ data: z.array(z.object({ id: z.string().uuid(), type: z.literal('task') }).strict()).length(1),
  meta: z.object({ message: z.literal('Success'), warnings: z.array(z.unknown()).length(0) }).strict() }).strict();
const rejected = z.object({ errors: z.object({ code: z.enum(['unauthorized', 'http_too_many_requests']), title: z.string() }).strict() }).strict();
/** Fixed production host, closed/unmapped property only. Deliberately unsuitable
 * for live cutover until channel-aware preflight and acceptance/recovery are reviewed.
 * A 200 task receipt is acceptance only, never proof of completion or OTA delivery. */
export function createUnmappedInventoryTransport(key: string, fetcher: typeof fetch = fetch, clock = Date.now): InventoryDeliveryTransport {
  if (typeof window !== 'undefined' || !key || key !== key.trim() || key.length > 4096 || /[\x00-\x20\x7f]/.test(key)) throw Error('Explicit production credential required');
  return { async prepare(input) {
    // Clone before any await; a caller cannot replace the durable bytes later.
    const a = validAttempt(structuredClone(input), clock());
    await inspectCalderwoodProduction(key, fetcher);
    validAttempt(a, clock());
    let used = false;
    return { async send() {
      if (used) throw Error('Availability permit already consumed');
      used = true;
      validAttempt(a, clock());
      try {
        const response = await fetcher('https://app.channex.io/api/v1/availability', {
          method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000),
          headers: { 'user-api-key': key, Accept: 'application/json', 'Content-Type': 'application/json' }, body: a.requestBody,
        });
        if (response.redirected) return { kind: 'uncertain' };
        const body: unknown = await response.json(), ok = accepted.safeParse(body), no = rejected.safeParse(body);
        if (response.status === 200 && ok.success) return { kind: 'accepted', taskId: ok.data.data[0].id };
        if (no.success && response.status === 401 && no.data.errors.code === 'unauthorized') return { kind: 'unauthorized' };
        if (no.success && response.status === 429 && no.data.errors.code === 'http_too_many_requests') {
          const header = response.headers.get('retry-after');
          const seconds = header && /^\d+$/.test(header) ? Number(header) : header ? Math.ceil((Date.parse(header) - clock()) / 1000) : 60;
          return { kind: 'rate-limited', retryAfterSeconds: Number.isFinite(seconds) ? Math.max(60, Math.min(86400, seconds)) : 60 };
        }
        return { kind: 'uncertain' };
      } catch { return { kind: 'uncertain' }; }
    } };
  } };
}
/** One attempt, no hidden retry. Already-accepted means the exact current plan
 * has a durable Channex acceptance, not OTA delivery. It performs no provider IO.
 * A lost begin response never permits IO. A lost outcome response must be retried
 * through record(), never through send(). */
export async function deliverInventoryOnce(store: InventoryDeliveryStore, transport: InventoryDeliveryTransport, token: string, clock = Date.now) {
  z.string().uuid().parse(token);
  return dispatchInventoryClaim(store, transport, await store.claim(token), token, clock);
}
/** One explicit latest-state recovery, no retry loop. Persist distinct tokens and
 * refresh the canonical plan first. SQL enforces cooldown, freshness and budget. */
export async function recoverInventoryOnce(store: InventoryRecoveryStore, transport: InventoryDeliveryTransport, previousToken: string, token: string, clock = Date.now) {
  z.string().uuid().parse(previousToken); z.string().uuid().parse(token);
  if (previousToken === token) throw Error('Recovery requires a new token');
  return dispatchInventoryClaim(store, transport, await store.recover(previousToken, token), token, clock);
}
async function dispatchInventoryClaim(store: InventoryDeliveryStore, transport: InventoryDeliveryTransport, claimed: Awaited<ReturnType<InventoryDeliveryStore['claim']>>, token: string, clock: () => number) {
  if (!('attempt' in claimed)) return { status: claimed.status };
  const a = validAttempt(claimed.attempt, clock());
  if (a.token !== token) throw Error('Delivery claim token mismatch');
  const prepared = await transport.prepare(a);
  const begun = await store.begin(a.token, a.requestDigest);
  if (begun.status !== 'started' || begun.expiresAt !== a.expiresAt || clock() >= begun.expiresAt) return { status: 'blocked' as const };
  let outcome: DeliveryOutcome;
  try { outcome = deliveryOutcomeSchema.parse(await prepared.send()); }
  catch { outcome = { kind: 'uncertain' }; }
  await store.record(a.token, a.requestDigest, outcome);
  return { status: outcome.kind, token: a.token, requestDigest: a.requestDigest };
}
