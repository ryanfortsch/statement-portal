/** Server-only, unconnected staging inventory edge. No env fallback or scheduler.
 * API contract: https://docs.channex.io/api-v.1-documentation/ari
 */
import { z } from 'zod';
import { createAvailabilityRequest, validateAvailabilityRequest } from './availability-request.ts';
import { inventoryDigest, type InventoryJob } from './inventory-outbox.ts';
import { todayInEastern } from '../sca-quotes-types.ts';

const BASE = 'https://staging.channex.io/api/v1';
const uuid = z.string().uuid();
const identity = z.string().trim().min(1).max(160);
const routeSchema = z.object({
  environment: z.literal('staging'), helmProperty: identity, connection: identity,
  generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  propertyId: uuid, roomTypeId: uuid,
  propertyTitle: z.string().min(1).max(200).endsWith('Isolated Staging'),
}).strict();
export type AvailabilityRoute = z.infer<typeof routeSchema>;
export type AvailabilityOutcome =
  | { status: 'accepted'; task: string }
  | { status: 'ambiguous' }
  | { status: 'rejected'; failure: 'retryable' | 'permanent'; retryAfterMs: number };
export type AvailabilityObservation = {
  complete: boolean; matches: boolean; observedAt: number;
  // Room counts alone prove neither task settlement nor rate-level/OTA state.
  settled: false; canVerify: false;
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid staging response');
  return value as Record<string, unknown>;
}
function cleanEnvelope(value: unknown) {
  const body = object(value);
  if ('errors' in body || 'error' in body) throw new Error('Staging response requires review');
  if (body.meta !== undefined) {
    const warnings = object(body.meta).warnings;
    if (warnings !== undefined && (!Array.isArray(warnings) || warnings.length)) throw new Error('Partial staging response');
  }
  return body;
}
function stamp(clock: () => number) {
  const now = clock();
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid inventory clock');
  return now;
}
function retryDelay(header: string | null, now: number) {
  const delay = header && /^\d+$/.test(header) ? Number(header) * 1000 : header ? Date.parse(header) - now : 0;
  if (header && /^\d+$/.test(header) && !Number.isSafeInteger(delay)) return null;
  if (Number.isFinite(delay) && (!Number.isSafeInteger(delay) || !Number.isSafeInteger(now + Math.max(60_000, delay)))) return null;
  return Number.isSafeInteger(delay) ? Math.max(60_000, delay) : 60_000;
}
export class ChannexAvailabilityClient {
  readonly route: Readonly<AvailabilityRoute>;
  #key: string;
  #fetch: typeof fetch;
  #clock: () => number;
  constructor(apiKey: string, route: AvailabilityRoute, fetcher: typeof fetch = fetch, clock = Date.now) {
    if (typeof window !== 'undefined' || !apiKey.trim()) throw new Error('Explicit server-side staging credential required');
    this.route = Object.freeze(routeSchema.parse(route));
    this.#key = apiKey.trim(); this.#fetch = fetcher; this.#clock = clock;
  }
  #validate(job: InventoryJob, allowPast = false) {
    const r = this.route, now = stamp(this.#clock);
    if (job.environment !== 'staging' || job.property !== r.helmProperty || job.connection !== r.connection ||
        job.generation !== r.generation || !job.id || !Number.isSafeInteger(job.version) || job.version < 1 ||
        !Array.isArray(job.days) || job.days.length < 1 || job.days.length > 366 || inventoryDigest(job.days) !== job.digest) {
      throw new Error('Inventory route or digest mismatch');
    }
    let previous = '';
    for (const day of job.days) {
      if (Object.keys(day).sort().join(',') !== 'available,date,stopSell' || !/^\d{4}-\d{2}-\d{2}$/.test(day.date) ||
          !Number.isFinite(Date.parse(day.date)) || new Date(day.date).toISOString().slice(0, 10) !== day.date ||
          (!allowPast && day.date < todayInEastern(new Date(now))) || (previous && Date.parse(day.date) - Date.parse(previous) !== 86400000) ||
          (day.available !== 0 && day.available !== 1) || day.stopSell !== (day.available === 0)) {
        throw new Error('Invalid availability-only window');
      }
      previous = day.date;
    }
  }
  async #request(path: string, body?: string) {
    return this.#fetch(`${BASE}${path}`, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000),
      headers: { 'user-api-key': this.#key, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body }),
    });
  }
  async #get(path: string) {
    try {
      const response = await this.#request(path);
      if (response.status !== 200 || response.redirected) throw new Error();
      return cleanEnvelope(await response.json());
    } catch { throw new Error('Staging availability inspection failed'); }
  }
  async #inspect() {
    const r = this.route;
    const property = object((await this.#get(`/properties/${r.propertyId}`)).data), attrs = object(property.attributes);
    if (property.id !== r.propertyId || attrs.title !== r.propertyTitle || attrs.currency !== 'USD' || attrs.timezone !== 'America/New_York') {
      throw new Error('Isolated staging property changed');
    }
    const room = object((await this.#get(`/room_types/${r.roomTypeId}`)).data);
    const parent = object(object(object(room.relationships).property).data);
    if (room.id !== r.roomTypeId || parent.id !== r.propertyId || object(room.attributes).count_of_rooms !== 1) {
      throw new Error('Single-unit staging room changed');
    }
    const params = new URLSearchParams({ 'filter[property_id]': r.propertyId, 'pagination[page]': '1', 'pagination[limit]': '100' });
    const channels = await this.#get(`/channels?${params}`), meta = object(channels.meta);
    if (!Array.isArray(channels.data) || channels.data.length || meta.total !== 0 || meta.page !== 1 || meta.limit !== 100) {
      throw new Error('Staging property must have no channel connections');
    }
  }
  async #counts(job: InventoryJob) {
    const params = new URLSearchParams({ 'filter[property_id]': this.route.propertyId,
      'filter[date][gte]': job.days[0].date, 'filter[date][lte]': job.days.at(-1)!.date });
    const body = await this.#get(`/availability?${params}`);
    const data = object(body.data), raw = data[this.route.roomTypeId];
    const days = raw === undefined ? {} : object(raw);
    const complete = job.days.every(day => days[day.date] === 0 || days[day.date] === 1);
    return { days, complete };
  }
  /** Read checks precede the durable submitting barrier. The permit can be used
   * only once, within five seconds, for the identical claimed intent.
   */
  async prepare(job: InventoryJob) {
    this.#validate(job);
    const bound = structuredClone(job);
    await this.#inspect();
    const observed = await this.#counts(bound);
    if (!observed.complete) throw new Error('Incomplete staging availability; reviewed initialization required');
    const values = bound.days.filter(day => observed.days[day.date] !== day.available).map(day => ({
      property_id: this.route.propertyId, room_type_id: this.route.roomTypeId, date: day.date, availability: day.available,
    }));
    const request = values.length ? createAvailabilityRequest(values, stamp(this.#clock)) : null;
    let used = false;
    return {
      changedDates: values.length,
      request: request ? structuredClone(request) : null,
      submit: async (prepared: InventoryJob): Promise<AvailabilityOutcome> => {
        const now = stamp(this.#clock);
        this.#validate(prepared);
        if (used || !request || now >= request.expiresAt || prepared.id !== bound.id || prepared.version !== bound.version ||
            prepared.digest !== bound.digest || prepared.status !== 'submitting' || !prepared.token ||
            !Number.isSafeInteger(prepared.leaseUntil) || now >= prepared.leaseUntil!) throw new Error('Submission permit unavailable');
        if (!prepared.request || JSON.stringify(validateAvailabilityRequest(prepared.request, prepared, now)) !== JSON.stringify(request)) {
          throw new Error('Submission permit requires the saved exact request');
        }
        used = true; // Consumed before any IO, including timeouts or malformed responses.
        try {
          const response = await this.#request('/availability', request.body);
          if (response.redirected) return { status: 'ambiguous' };
          const body = object(await response.json());
          if (response.status === 429 && !('data' in body) && !('meta' in body) && object(body.errors).code === 'http_too_many_requests') {
            const retryAfterMs = retryDelay(response.headers.get('retry-after'), now);
            return retryAfterMs === null ? { status: 'ambiguous' } : { status: 'rejected', failure: 'retryable', retryAfterMs };
          }
          if (response.status === 401 && !('data' in body) && !('meta' in body) && object(body.errors).code === 'unauthorized') {
            return { status: 'rejected', failure: 'permanent', retryAfterMs: 0 };
          }
          if (response.status !== 200) return { status: 'ambiguous' };
          cleanEnvelope(body);
          const meta = object(body.meta);
          // Channex omits warnings on clean responses as well as returning [].
          // cleanEnvelope already rejects malformed or nonempty warnings.
          if (meta.message !== 'Success' ||
              !Array.isArray(body.data) || body.data.length !== 1) return { status: 'ambiguous' };
          const task = object(body.data[0]);
          if (task.type !== 'task' || !uuid.safeParse(task.id).success) return { status: 'ambiguous' };
          return { status: 'accepted', task: task.id as string };
        } catch { return { status: 'ambiguous' }; }
      },
    };
  }
  async observe(job: InventoryJob): Promise<AvailabilityObservation> {
    this.#validate(job, true);
    await this.#inspect();
    const actual = await this.#counts(job);
    return { complete: actual.complete, matches: actual.complete && job.days.every(d => actual.days[d.date] === d.available),
      observedAt: stamp(this.#clock), settled: false, canVerify: false };
  }
}
