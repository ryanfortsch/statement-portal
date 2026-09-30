/** Server/CLI-only staging adapter. Never used by production jobs. */
import { PILOTS, TEST_RATE_TITLE, TEST_START, TEST_END, nights, record, textField, normalizeRevision, applyRevision, type Unit, type Ledger, type Revision, type AvailabilityDay } from './core.ts';

const BASE = 'https://staging.channex.io/api/v1';
type Json = Record<string, unknown>;
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type StagingNight = { unit: Unit; date: string; inventory: 0 | 1 | null; stopSell: boolean | null; minStay: number | null };
export type StagingSnapshot = { mappings: PilotMapping[]; bookings: Revision[]; inventory: StagingNight[] };
export type PilotMapping = { unit: Unit; propertyId: string; roomTypeId: string; ratePlanId: string; capacity: number };
export class StagingApiError extends Error {
  readonly status: number;
  constructor(status: number) { super(`Channex staging request failed (HTTP ${status || 'network'}). No response body was logged.`); this.status = status; }
}
function relation(row: Json, name: string): unknown { return record(record(record(row.relationships)[name]).data).id; }
function uuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error('Invalid Channex resource ID');
  return value;
}
export class ChannexStagingClient {
  #key: string;
  #fetch: Fetcher;
  constructor(apiKey: string, fetcher: Fetcher = fetch) {
    if (typeof window !== 'undefined') throw new Error('Channex credentials must stay on the server');
    if (!apiKey.trim()) throw new Error('CHANNEX_STAGING_API_KEY is not configured');
    this.#key = apiKey.trim(); this.#fetch = fetcher;
  }
  async #request(path: string, method = 'GET', body?: unknown): Promise<Json> {
    let response: Response;
    try {
      response = await this.#fetch(`${BASE}${path}`, {
        method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000),
        headers: { 'user-api-key': this.#key, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw new StagingApiError(0); }
    if (!response.ok) throw new StagingApiError(response.status);
    let result: Json;
    try { result = record(await response.json()); } catch { throw new Error('Invalid Channex JSON response'); }
    if (result.errors) throw new Error('Channex returned an error envelope');
    if (result.meta) {
      const warnings = record(result.meta).warnings;
      if (warnings !== undefined && (!Array.isArray(warnings) || warnings.length)) throw new Error('Channex rejected part of the update; read-back reconciliation required');
    }
    return result;
  }
  async #list(path: string, unit: Unit): Promise<Json[]> {
    const rows: Json[] = [], ids = new Set<string>();
    for (let page = 1; page <= 20; page++) {
      const params = new URLSearchParams({ 'filter[property_id]': PILOTS[unit].propertyId, 'pagination[page]': String(page), 'pagination[limit]': '100' });
      const result = await this.#request(`${path}?${params}`);
      if (!Array.isArray(result.data)) throw new Error('Invalid Channex collection');
      const meta = record(result.meta);
      if (!Number.isInteger(meta.total) || (meta.total as number) < 0 || meta.page !== page || !Number.isInteger(meta.limit) || (meta.limit as number) < 1) throw new Error('Invalid Channex pagination');
      for (const item of result.data) {
        const row = record(item), id = textField(row.id);
        if (ids.has(id)) throw new Error('Collection changed during pagination; retry before writing');
        ids.add(id); rows.push(row);
      }
      if (rows.length === meta.total) return rows;
      if (!result.data.length || rows.length > (meta.total as number)) throw new Error('Incomplete Channex collection');
    }
    throw new Error('Channex collection exceeds pilot safety limit');
  }
  async inspect(): Promise<PilotMapping[]> {
    const mappings: PilotMapping[] = [];
    for (const unit of ['front', 'back'] as Unit[]) {
      const expected = PILOTS[unit];
      const property = record((await this.#request(`/properties/${expected.propertyId}`)).data);
      const attrs = record(property.attributes);
      if (property.id !== expected.propertyId || !String(attrs.title).endsWith('(Staging)') || attrs.currency !== 'USD' || attrs.timezone !== 'America/New_York') throw new Error('Pilot property identity or configuration changed');
      const room = record((await this.#request(`/room_types/${expected.roomTypeId}`)).data), roomAttrs = record(room.attributes);
      if (room.id !== expected.roomTypeId || relation(room, 'property') !== expected.propertyId || roomAttrs.count_of_rooms !== 1 || roomAttrs.occ_adults !== expected.capacity) throw new Error('Pilot room mapping or capacity changed');
      if ((await this.#list('/channels', unit)).length) throw new Error('A channel is attached to the pilot; sandbox writes are prohibited');
      const rates = await this.#list('/rate_plans', unit);
      if (rates.length !== 1) throw new Error('Expected exactly one isolated test rate plan');
      const rate = rates[0], rateAttrs = record(rate.attributes);
      if (relation(rate, 'property') !== expected.propertyId || relation(rate, 'room_type') !== expected.roomTypeId || rateAttrs.title !== TEST_RATE_TITLE || rateAttrs.currency !== 'USD') throw new Error('Pilot rate mapping changed');
      if (!Array.isArray(rateAttrs.stop_sell) || rateAttrs.stop_sell.length !== 7 || !rateAttrs.stop_sell.every((v) => v === true)) throw new Error('Pilot rate must remain stopped on all seven weekdays');
      mappings.push({ unit, propertyId: expected.propertyId, roomTypeId: expected.roomTypeId, ratePlanId: uuid(textField(rate.id)), capacity: expected.capacity });
    }
    return mappings;
  }
  /** Read current bookings without consuming or acknowledging the revision feed. */
  async readSnapshot(): Promise<StagingSnapshot> {
    const mappings = await this.inspect();
    const bookings: Revision[] = [], inventory: StagingNight[] = [];
    const dates = nights(TEST_START, TEST_END);
    for (const mapping of mappings) {
      const rows = await this.#list('/bookings', mapping.unit);
      for (const row of rows) {
        const attrs = record(row.attributes);
        const booking = normalizeRevision({ id: textField(attrs.revision_id), attributes: { ...attrs, booking_id: textField(row.id) } });
        if (booking.member !== mapping.unit) throw new Error('Booking is outside the requested pilot');
        bookings.push(booking);
      }
      const params = new URLSearchParams({ 'filter[property_id]': mapping.propertyId, 'filter[date][gte]': dates[0], 'filter[date][lte]': dates[dates.length - 1] });
      const actual = record(record((await this.#request(`/availability?${params}`)).data)[mapping.roomTypeId] ?? {});
      params.set('filter[restrictions]', 'min_stay_arrival,stop_sell');
      const restrictions = record(record((await this.#request(`/restrictions?${params}`)).data)[mapping.ratePlanId] ?? {});
      for (const date of dates) {
        const rate = record(restrictions[date] ?? {}), count = actual[date];
        inventory.push({ unit: mapping.unit, date, inventory: count === 0 || count === 1 ? count : null, stopSell: typeof rate.stop_sell === 'boolean' ? rate.stop_sell : null, minStay: typeof rate.min_stay_arrival === 'number' && Number.isInteger(rate.min_stay_arrival) && rate.min_stay_arrival > 0 ? rate.min_stay_arrival : null });
      }
    }
    return { mappings, bookings, inventory };
  }
  async readRevisions(): Promise<Revision[]> {
    const rows: Revision[] = [];
    for (const unit of ['front', 'back'] as Unit[]) {
      for (const item of await this.#list('/booking_revisions/feed', unit)) {
        const r = normalizeRevision(item);
        if (r.member !== unit) throw new Error('Channex ignored the property filter');
        rows.push(r);
      }
    }
    return rows;
  }
  async acknowledge(revision: Revision): Promise<void> {
    if (revision.member === 'whole') throw new Error('Whole-house simulation has no Channex destination');
    const remote = normalizeRevision(record((await this.#request(`/booking_revisions/${uuid(revision.id)}`)).data));
    if (JSON.stringify(remote) !== JSON.stringify(revision)) throw new Error('Revision changed before acknowledgement');
    const result = await this.#request(`/booking_revisions/${uuid(revision.id)}/ack`, 'POST');
    if (!result.data && record(result.meta).message !== 'Success') throw new Error('Unconfirmed revision acknowledgement');
  }
  async publishStoppedInventory(days: AvailabilityDay[]): Promise<{ verifiedNights: number }> {
    const units = days.filter((d) => d.member !== 'whole');
    if (!units.length || units.length > 240) throw new Error('Expected at most 120 nights per pilot unit');
    const keys = new Set<string>();
    for (const day of units) {
      if ((day.member !== 'front' && day.member !== 'back') || day.date < TEST_START || day.date >= TEST_END || ![0, 1].includes(day.availability)) throw new Error('Inventory is outside the staging pilot');
      nights(day.date, new Date(Date.parse(`${day.date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10));
      const key = `${day.member}:${day.date}`;
      if (keys.has(key)) throw new Error('Duplicate inventory day'); keys.add(key);
    }
    const dates = [...new Set(units.map((d) => d.date))].sort();
    if (units.length !== dates.length * 2) throw new Error('Both pilot units must be present for every date');
    const mappings = await this.inspect(); // Recheck absence of all channel mappings before every write.
    // Channex rejects mixed-property writes. Close BOTH before publishing either.
    for (const m of mappings) {
      await this.#request('/restrictions', 'POST', { values: dates.map((date) => ({ property_id: m.propertyId, rate_plan_id: m.ratePlanId, date, rate: '100.00', min_stay_arrival: 20, min_stay_through: 1, stop_sell: true })) });
    }
    for (const m of mappings) {
      await this.#request('/availability', 'POST', { values: units.filter((day) => day.member === m.unit).map((day) => ({ property_id: m.propertyId, room_type_id: m.roomTypeId, date: day.date, availability: day.availability })) });
    }
    // A 200 is only task acceptance. Require actual inventory values to match.
    for (let attempt = 0; attempt < 4; attempt++) {
      let matching = true;
      for (const m of mappings) {
        const params = new URLSearchParams({ 'filter[property_id]': m.propertyId, 'filter[date][gte]': dates[0], 'filter[date][lte]': dates[dates.length - 1] });
        const actual = record(record((await this.#request(`/availability?${params}`)).data)[m.roomTypeId] ?? {});
        params.set('filter[restrictions]', 'rate,min_stay_arrival,min_stay_through,stop_sell');
        const rates = record(record((await this.#request(`/restrictions?${params}`)).data)[m.ratePlanId] ?? {});
        for (const day of units.filter((d) => d.member === m.unit)) {
          const rate = record(rates[day.date] ?? {});
          if (actual[day.date] !== day.availability || rate.stop_sell !== true || rate.min_stay_arrival !== 20 || rate.min_stay_through !== 1 || Number(rate.rate) !== 100) matching = false;
        }
      }
      if (matching) return { verifiedNights: units.length };
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
    throw new Error('Inventory read-back did not match; stop-sell remains enabled');
  }
}
/** Caller holds a journal lock. Every revision is durable before any ACK. */
export async function importStagingRevisions(client: Pick<ChannexStagingClient, 'readRevisions' | 'acknowledge'>, ledger: Ledger, persist: (ledger: Ledger) => Promise<void>): Promise<{ ledger: Ledger; applied: number; duplicate: number; stale: number; acknowledged: number }> {
  const revisions = await client.readRevisions();
  const counts = { applied: 0, duplicate: 0, stale: 0, acknowledged: 0 };
  let next = ledger;
  for (const r of revisions) { const result = applyRevision(next, r); next = result.ledger; counts[result.outcome]++; }
  await persist(next);
  for (const r of revisions) { await client.acknowledge(r); counts.acknowledged++; }
  return { ledger: next, ...counts };
}
