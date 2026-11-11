import 'server-only';
import { z } from 'zod';
import { record } from './primitives.ts';
import { airbnbMappingSchema, normalizeAirbnbBookingRevision, parseAirbnbBookingRevision,
  type AirbnbBookingMapping } from './revision.ts';
import type { AirbnbRevisionReader } from './ingestion.ts';
import { compareAirbnbRevisionObservation } from './acknowledgment-match.ts';
const bases = { staging: 'https://staging.channex.io/api/v1', production: 'https://app.channex.io/api/v1' } as const;
const relation = (row: Record<string, unknown>, key: string) => record(record(record(row.relationships)[key]).data).id;
/** No environment lookup or scheduler activation. ACK is separately opt-in.
 * Resource checks establish mapping, NOT channel authorization or send authority.
 */
export function createAirbnbRevisionReader(config: { mapping: AirbnbBookingMapping; apiKey: string; acknowledgeEnabled?: boolean }, fetcher: typeof fetch = fetch): AirbnbRevisionReader {
  if (typeof window !== 'undefined' || !config.apiKey?.trim() || /[\r\n]/.test(config.apiKey)) throw Error('Explicit server Channex credential required');
  const mapping = Object.freeze(airbnbMappingSchema.parse(config.mapping)), key = config.apiKey.trim(), ackEnabled = config.acknowledgeEnabled === true;
  async function request(path: string, method = 'GET') {
    try {
      const response = await fetcher(bases[mapping.environment] + path, { method, redirect: 'error', cache: 'no-store',
        signal: AbortSignal.timeout(20000), headers: { 'user-api-key': key, Accept: 'application/json' } });
      if (!response.ok || response.redirected) throw Error();
      const body = record(await response.json()), warnings = body.meta === undefined ? undefined : record(body.meta).warnings;
      if (body.errors || (warnings !== undefined && (!Array.isArray(warnings) || warnings.length))) throw Error();
      return body;
    } catch { throw Error('Channex booking request incomplete; details withheld'); }
  }
  function validated(raw: unknown) {
    if (record(raw).type !== 'booking_revision') throw Error('Revision resource required');
    normalizeAirbnbBookingRevision(raw, mapping);
    return raw;
  }
  const revision = async (value: string) => {
    const id = z.string().uuid().parse(value);
    const raw = validated((await request('/booking_revisions/' + id)).data);
    if (record(raw).id !== id) throw Error('Revision identity mismatch');
    return raw;
  };
  const inspect = async (expected: AirbnbBookingMapping) => {
    if (JSON.stringify(airbnbMappingSchema.parse(expected)) !== JSON.stringify(mapping)) throw Error('Booking mapping changed');
    const property = record((await request('/properties/' + mapping.propertyId)).data);
    const room = record((await request('/room_types/' + mapping.roomTypeId)).data);
    const plan = record((await request('/rate_plans/' + mapping.ratePlanId)).data);
    if (property.id !== mapping.propertyId || room.id !== mapping.roomTypeId || relation(room, 'property') !== mapping.propertyId ||
        plan.id !== mapping.ratePlanId || relation(plan, 'property') !== mapping.propertyId || relation(plan, 'room_type') !== mapping.roomTypeId) throw Error('Provider booking mapping mismatch');
  };
  return {
    inspect, revision,
    async feed() {
      // One feed for this credential, per Channex's November 2026 guidance.
      // Keep validating every row against the sole reviewed mapping: a broader
      // key or foreign row must stop the batch, never cause an out-of-scope ACK.
      const params = new URLSearchParams({ 'pagination[page]': '1', 'pagination[limit]': '100', 'order[inserted_at]': 'asc' });
      const body = await request('/booking_revisions/feed?' + params), meta = record(body.meta);
      if (!Array.isArray(body.data) || meta.page !== 1 || !Number.isSafeInteger(meta.total) || (meta.total as number) < 0 ||
          !Number.isSafeInteger(meta.limit) || (meta.limit as number) < 1 || (meta.limit as number) > 100 ||
          body.data.length !== Math.min(meta.total as number, meta.limit as number)) throw Error('Incomplete booking revision page');
      // ACK removes feed rows. Repeatedly drain page one; never paginate after ACK.
      const rows = body.data.map(validated);
      if (new Set(rows.map(r => record(r).id)).size !== rows.length) throw Error('Duplicate revision page');
      return rows;
    },
    async acknowledge(input) {
      if (!ackEnabled) throw Error('Booking acknowledgement disabled');
      const expected = parseAirbnbBookingRevision(input);
      await inspect(mapping);
      // Read raw here: a prior successful ACK can mask populated fields. Null
      // fields remain null, so lack of masks must not trigger a duplicate POST.
      // This only compares the caller's already committed/read-back revision;
      // it never persists the masked provider response or retries an ACK.
      const raw = (await request('/booking_revisions/' + expected.revisionId)).data;
      if (compareAirbnbRevisionObservation(raw, expected, mapping)) return;
      const body = await request('/booking_revisions/' + expected.revisionId + '/ack', 'POST');
      if (record(body.meta).message !== 'Success') throw Error('Booking acknowledgement unconfirmed');
    },
  };
}
