import 'server-only';
import { z } from 'zod';
import { CALDERWOOD_PRODUCTION as m } from './channex-production-preflight.ts';
import { requireProductionInspectionEnvironment } from './channex-production-runtime.ts';

const API = 'https://app.channex.io/api/v1';
const LIMIT = 100;
const MAX_BYTES = 512 * 1024;
const DEADLINE_MS = 20_000;
const uuid = z.string().uuid();
const listingId = z.string().regex(/^[1-9][0-9]{0,29}$/);
/** Reviewed server configuration only. Never infer the expected identity from
 * the very provider response being checked, or from URL/search/form inputs. */
export const channelReviewSchema = z.object({ channelId: uuid, listingId,
  minStayType: z.enum(['Arrival', 'Through']) }).strict();
export type ChannelReview = z.infer<typeof channelReviewSchema>;
const settings = z.object({ listing_id: z.unknown().optional(), parent_listing_id: z.unknown().optional(),
  los_enabled: z.unknown().optional(), min_stay_type: z.unknown().optional(), derived_option: z.unknown().optional() });
const channel = z.object({ type: z.literal('channel'), id: uuid,
  attributes: z.object({ id: uuid, channel: z.string().min(1).max(100), is_active: z.boolean(),
    currency: z.string().nullable(), expected_removal_date: z.string().nullable(), settings,
    properties: z.array(uuid).max(100),
    rate_plans: z.array(z.object({ id: uuid, rate_plan_id: uuid, settings })).max(100),
  }), relationships: z.object({ properties: z.object({ data: z.array(z.object({ id: uuid, type: z.literal('property') })).max(100) }) }),
}).refine(c => c.id === c.attributes.id);
const envelope = z.object({ errors: z.never().optional(), meta: z.object({ warnings: z.array(z.unknown()).length(0).optional() }).optional() });
const collection = envelope.extend({ data: z.array(channel).max(LIMIT), meta: z.object({
  page: z.literal(1), limit: z.literal(LIMIT), total: z.number().int().min(0).max(LIMIT), warnings: z.array(z.unknown()).length(0).optional(),
}) }).refine(p => p.data.length === p.meta.total && new Set(p.data.map(c => c.id)).size === p.data.length);
const detail = envelope.extend({ data: channel });
const rate = envelope.extend({ data: z.object({ id: z.literal(m.ratePlanId), type: z.literal('rate_plan'),
  attributes: z.object({ currency: z.literal('USD'), sell_mode: z.literal('per_room'), rate_mode: z.literal('manual') }),
  relationships: z.object({ property: z.object({ data: z.object({ id: z.literal(m.propertyId) }) }),
    room_type: z.object({ data: z.object({ id: z.literal(m.roomTypeId) }) }) }),
}) });
export type ChannelAuditCode = 'CONFIGURATION_REQUIRED' | 'ACCESS_DENIED' | 'PROVIDER_UNAVAILABLE' | 'INVALID_RESPONSE' | 'CHANGED_DURING_CHECK';
export class ChannelAuditError extends Error {
  readonly code: ChannelAuditCode;
  constructor(code: ChannelAuditCode) { super(`Channel review: ${code}`); this.code = code; }
}
export type ChannelAuditCheck = { key: string; label: string; passed: boolean };
export type ChannelAudit = {
  checkedAt: number; channelCount: number; activeChannels: number; mappedRates: number;
  status: 'not-connected' | 'needs-review' | 'mapping-verified'; checks: ChannelAuditCheck[];
  mappingVerified: boolean; providerWrites: 0; readyForCutover: false; priceLabsDeliveryVerified: false;
};
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}
function canonical(rows: z.infer<typeof channel>[]) {
  return stable(rows.map(c => ({ ...c, attributes: { ...c.attributes,
    properties: [...c.attributes.properties].sort(), rate_plans: [...c.attributes.rate_plans].sort((a,b) => a.id.localeCompare(b.id)) },
    relationships: { properties: { data: [...c.relationships.properties.data].sort((a,b) => a.id.localeCompare(b.id)) } },
  })).sort((a,b) => a.id.localeCompare(b.id)));
}
function noOverrides(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === 'object' && Object.values(value as Record<string, unknown>).every(v => v === null || (Array.isArray(v) && v.length === 0));
}
/** GET-only diagnostic, never a send permit. Two matching observations detect
 * visible drift but do not lock the remote configuration or prove OTA delivery.
 * The existing closed/unmapped publishing preflight is deliberately unchanged. */
export async function auditCalderwoodChannels(key: string, expected: ChannelReview | null, fetcher: typeof fetch = fetch, clock = Date.now): Promise<ChannelAudit> {
  if (typeof window !== 'undefined' || typeof key !== 'string' || !key || key !== key.trim()
    || key.length > 4096 || /[\x00-\x20\x7f]/.test(key)) throw new ChannelAuditError('CONFIGURATION_REQUIRED');
  // Clone before the first await. Caller mutation cannot approve a different mapping.
  let review: ChannelReview | null;
  try { review = expected === null ? null : channelReviewSchema.parse(expected); }
  catch { throw new ChannelAuditError('CONFIGURATION_REQUIRED'); }
  const start = clock();
  if (!Number.isSafeInteger(start) || start < 0) throw new ChannelAuditError('CONFIGURATION_REQUIRED');
  // An explicit signal also opts out of Next/React GET deduplication: the
  // second observation must reach Channex, not reuse the first response.
  const signal = AbortSignal.timeout(DEADLINE_MS);
  const read = async (path: string): Promise<unknown> => {
    try {
      if (signal.aborted || clock() < start || clock() - start >= DEADLINE_MS) throw new ChannelAuditError('PROVIDER_UNAVAILABLE');
      const response = await fetcher(`${API}${path}`, { method: 'GET', redirect: 'error', cache: 'no-store', signal,
        headers: { 'user-api-key': key, Accept: 'application/json' } });
      if ([401,403,404].includes(response.status)) throw new ChannelAuditError('ACCESS_DENIED');
      if (response.status !== 200 || response.redirected) throw new ChannelAuditError('PROVIDER_UNAVAILABLE');
      if (!response.body) throw new ChannelAuditError('INVALID_RESPONSE');
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
      try { for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) throw new ChannelAuditError('INVALID_RESPONSE');
        chunks.push(value);
      } } finally { await reader.cancel().catch(() => {}); }
      if (signal.aborted || clock() < start || clock() - start >= DEADLINE_MS) throw new ChannelAuditError('PROVIDER_UNAVAILABLE');
      try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new ChannelAuditError('INVALID_RESPONSE'); }
    } catch (error) {
      if (error instanceof ChannelAuditError) throw error;
      throw new ChannelAuditError('PROVIDER_UNAVAILABLE');
    }
  };
  const query = new URLSearchParams({ 'filter[property_id]': m.propertyId, 'pagination[page]': '1', 'pagination[limit]': String(LIMIT) });
  const listPath = `/channels?${query}`;
  try {
    const first = collection.parse(await read(listPath));
    let current: z.infer<typeof channel> | null = null;
    let rateVerified = false;
    // Never follow a channel ID supplied by a caller: it must occur in the exact
    // property-filtered collection. No queries to other properties or OTAs.
    if (first.data.length === 1 && first.data[0].attributes.properties.includes(m.propertyId)
      && first.data[0].relationships.properties.data.some(p => p.id === m.propertyId)) {
      current = detail.parse(await read(`/channels/${first.data[0].id}`)).data;
      if (canonical([current]) !== canonical(first.data)) throw new ChannelAuditError('CHANGED_DURING_CHECK');
      if (current.attributes.rate_plans.some(r => r.rate_plan_id === m.ratePlanId)) {
        rateVerified = rate.safeParse(await read(`/rate_plans/${m.ratePlanId}`)).success;
      }
      const again = detail.parse(await read(`/channels/${current.id}`)).data;
      if (canonical([current]) !== canonical([again])) throw new ChannelAuditError('CHANGED_DURING_CHECK');
    }
    const last = collection.parse(await read(listPath));
    if (canonical(first.data) !== canonical(last.data)) throw new ChannelAuditError('CHANGED_DURING_CHECK');
    const a = current?.attributes;
    const mapping = a?.rate_plans.length === 1 ? a.rate_plans[0] : null;
    const exactScope = a?.properties.length === 1 && a.properties[0] === m.propertyId
      && current?.relationships.properties.data.length === 1 && current.relationships.properties.data[0].id === m.propertyId;
    const checks: ChannelAuditCheck[] = [
      { key: 'connection', label: 'One connection, scoped only to Calderwood', passed: !!exactScope },
      { key: 'review', label: 'Connection identity matches the reviewed setup', passed: !!review && current?.id === review.channelId },
      { key: 'airbnb', label: 'Airbnb adapter', passed: a?.channel === 'ABB' },
      { key: 'listing', label: 'One reviewed Airbnb listing and rate mapping', passed: !!review && !!mapping && !!a
        && listingId.safeParse(mapping.settings.listing_id).success && mapping.settings.listing_id === review.listingId
        && mapping.rate_plan_id === m.ratePlanId && mapping.settings.parent_listing_id == null
        && (mapping.settings.los_enabled === undefined || mapping.settings.los_enabled === false)
        && a.settings.parent_listing_id == null && (a.settings.los_enabled === undefined || a.settings.los_enabled === false) },
      { key: 'rate', label: 'Mapped USD rate belongs to Calderwood’s whole-home room', passed: rateVerified && (a?.currency === 'USD' || a?.currency === null) },
      { key: 'minimum-stay', label: 'Minimum-stay mode matches the reviewed setup', passed: !!review && a?.settings.min_stay_type === review.minStayType },
      { key: 'overrides', label: 'No channel or mapping price/restriction overrides', passed: !!a && !!mapping
        && noOverrides(a.settings.derived_option) && noOverrides(mapping.settings.derived_option) },
      { key: 'active', label: 'Connection active with no scheduled removal', passed: a?.is_active === true && a.expected_removal_date === null },
    ];
    const mappingVerified = checks.every(c => c.passed);
    const checkedAt = clock();
    if (!Number.isSafeInteger(checkedAt) || checkedAt < start || checkedAt - start >= DEADLINE_MS) throw new ChannelAuditError('PROVIDER_UNAVAILABLE');
    return { checkedAt, channelCount: first.data.length, activeChannels: first.data.filter(c => c.attributes.is_active).length,
      mappedRates: first.data.reduce((n,c) => n + c.attributes.rate_plans.length,0),
      status: !first.data.length ? 'not-connected' : mappingVerified ? 'mapping-verified' : 'needs-review',
      checks, mappingVerified, providerWrites: 0, readyForCutover: false, priceLabsDeliveryVerified: false };
  } catch (error) {
    if (error instanceof ChannelAuditError) throw error;
    throw new ChannelAuditError('INVALID_RESPONSE');
  }
}
/** Same production-only, inspection-mode boundary as the existing runtime.
 * Preview builds cannot use production credentials. A missing reviewed identity
 * remains explicitly unverified; it is never learned/approved automatically. */
export async function auditProductionChannelEnvironment(env: Record<string, string | undefined>, fetcher: typeof fetch = fetch, clock = Date.now) {
  try { requireProductionInspectionEnvironment(env); }
  catch { throw new ChannelAuditError('CONFIGURATION_REQUIRED'); }
  let review: ChannelReview | null = null;
  if (env.CHANNEX_CALDERWOOD_CHANNEL_REVIEW !== undefined) {
    try { review = channelReviewSchema.parse(JSON.parse(env.CHANNEX_CALDERWOOD_CHANNEL_REVIEW)); }
    catch { throw new ChannelAuditError('CONFIGURATION_REQUIRED'); }
  }
  return auditCalderwoodChannels(env.CHANNEX_PRODUCTION_API_KEY!, review, fetcher, clock);
}
