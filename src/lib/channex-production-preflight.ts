import 'server-only';

/** Configuration-only inspection. This module cannot publish ARI, ACK bookings,
 * send messages, attach channels, or change Helm's calendar authority. */
export const CALDERWOOD_PRODUCTION = Object.freeze({
  helmPropertyId: '65_calderwood',
  propertyId: '320c5cb5-91e0-46af-b9b3-a3fc20b4631e',
  propertyTitle: '65 Calderwood',
  roomTypeId: 'e8673d84-4bea-48b1-a160-214b016a8c05',
  roomTitle: '65 Calderwood - Whole Home',
  ratePlanId: 'ce53790a-7b7d-4cec-91a6-a128589f9dd2',
  rateTitle: 'Standard - PriceLabs',
  currency: 'USD',
  timezone: 'America/New_York',
  priceAuthority: 'pricelabs',
  minimumStayAuthority: 'pricelabs',
});

const API = 'https://app.channex.io/api/v1';
type ObjectValue = Record<string, unknown>;
type ReadFetch = (url: string, init: RequestInit) => Promise<Response>;
export type ProductionPreflightCode = 'CREDENTIAL_REQUIRED' | 'ACCESS_DENIED'
  | 'PROVIDER_UNAVAILABLE' | 'INVALID_RESPONSE' | 'MAPPING_MISMATCH'
  | 'RATE_NOT_CLOSED' | 'CHANNELS_PRESENT';

export class ProductionPreflightError extends Error {
  readonly code: ProductionPreflightCode;
  constructor(code: ProductionPreflightCode) {
    super(`Channex production preflight: ${code}`);
    this.name = 'ProductionPreflightError';
    this.code = code;
  }
}

function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProductionPreflightError('INVALID_RESPONSE');
  }
  return value as ObjectValue;
}
function relationship(row: ObjectValue, name: string): unknown {
  return object(object(object(row.relationships)[name]).data).id;
}
function matches(ok: boolean): void {
  if (!ok) throw new ProductionPreflightError('MAPPING_MISMATCH');
}

/** Fixed host and fixed IDs: no caller-supplied URL/path or staging-key fallback.
 * Success proves only that the configured, closed, unmapped target is readable.
 * It never proves key scope, per-date inventory, pricing, delivery, or cutover. */
export async function inspectCalderwoodProduction(apiKey: string, fetcher: ReadFetch = fetch) {
  if (typeof window !== 'undefined' || typeof apiKey !== 'string' || !apiKey
    || apiKey !== apiKey.trim() || apiKey.length > 4096 || /[\x00-\x20\x7f]/.test(apiKey)) {
    throw new ProductionPreflightError('CREDENTIAL_REQUIRED');
  }
  const read = async (path: string) => {
    let response: Response;
    try {
      response = await fetcher(`${API}${path}`, {
        method: 'GET', redirect: 'error', cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
        headers: { 'user-api-key': apiKey, Accept: 'application/json' },
      });
    } catch { throw new ProductionPreflightError('PROVIDER_UNAVAILABLE'); }
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      throw new ProductionPreflightError('ACCESS_DENIED');
    }
    if (!response.ok || response.redirected) throw new ProductionPreflightError('PROVIDER_UNAVAILABLE');
    let payload: ObjectValue;
    try { payload = object(await response.json()); }
    catch { throw new ProductionPreflightError('INVALID_RESPONSE'); }
    if (payload.errors != null) throw new ProductionPreflightError('INVALID_RESPONSE');
    if (payload.meta != null) {
      const warnings = object(payload.meta).warnings;
      if (warnings !== undefined && (!Array.isArray(warnings) || warnings.length !== 0)) {
        throw new ProductionPreflightError('INVALID_RESPONSE');
      }
    }
    return payload;
  };
  const m = CALDERWOOD_PRODUCTION;
  const property = object((await read(`/properties/${m.propertyId}`)).data);
  const pa = object(property.attributes);
  matches(property.id === m.propertyId && pa.title === m.propertyTitle
    && pa.currency === m.currency && pa.timezone === m.timezone && pa.property_type === 'holiday_home');
  const room = object((await read(`/room_types/${m.roomTypeId}`)).data);
  const ra = object(room.attributes);
  matches(room.id === m.roomTypeId && relationship(room, 'property') === m.propertyId
    && ra.title === m.roomTitle && ra.count_of_rooms === 1
    && ra.occ_adults === 6 && ra.occ_children === 0 && ra.occ_infants === 0);
  const rate = object((await read(`/rate_plans/${m.ratePlanId}`)).data);
  const rp = object(rate.attributes);
  matches(rate.id === m.ratePlanId && relationship(rate, 'property') === m.propertyId
    && relationship(rate, 'room_type') === m.roomTypeId && rp.title === m.rateTitle
    && rp.currency === m.currency && rp.sell_mode === 'per_room' && rp.rate_mode === 'manual');
  if (!Array.isArray(rp.stop_sell) || rp.stop_sell.length !== 7 || !rp.stop_sell.every(v => v === true)) {
    throw new ProductionPreflightError('RATE_NOT_CLOSED');
  }
  const query = new URLSearchParams({ 'filter[property_id]': m.propertyId,
    'pagination[page]': '1', 'pagination[limit]': '1' });
  const channels = await read(`/channels?${query}`);
  const meta = object(channels.meta);
  if (!Array.isArray(channels.data) || meta.page !== 1 || meta.total !== 0 || channels.data.length !== 0) {
    throw new ProductionPreflightError('CHANNELS_PRESENT');
  }
  return {
    checkedAt: new Date().toISOString(), environment: 'production' as const,
    helmPropertyId: m.helmPropertyId, propertyId: m.propertyId,
    roomTypeId: m.roomTypeId, ratePlanId: m.ratePlanId,
    mappingVerified: true, stoppedRateDefaultsVerified: true, channels: 0,
    priceAuthority: m.priceAuthority, minimumStayAuthority: m.minimumStayAuthority,
    calendarAuthorityChanged: false, writesPerformed: false, readyForCutover: false,
    remaining: ['Production booking ingestion', 'PriceLabs daily rate/restriction readback',
      'Guest and cleaner automatic delivery', 'Fresh booking/block reconciliation',
      'Reviewed Airbnb transition'],
  };
}
