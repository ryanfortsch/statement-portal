import { CALDERWOOD_STAGING as mapping } from '../calderwood-readonly/channex.ts';
import { createCanonicalRevisionClient } from './canonical-revision-client.ts';
import { normalizeSourceBooking, parseSourceBookings, type CanonicalSourceClient } from './canonical-source.ts';
import { record } from './core.ts';
/** Fixed, unfiltered all-status source. Partial pages and ignored filters fail closed. */
export function createCanonicalSourceClient(key: string, fetcher: typeof fetch = fetch): CanonicalSourceClient {
  const revisions = createCanonicalRevisionClient(key, fetcher);
  return {
    inspect: revisions.inspect,
    pending: async () => (await revisions.feed()).length !== 0,
    async bookings() {
      try {
        const params = new URLSearchParams({ 'filter[property_id]': mapping.propertyId, 'pagination[page]': '1', 'pagination[limit]': '100' });
        const response = await fetcher('https://staging.channex.io/api/v1/bookings?' + params, {
          method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000),
          headers: { 'user-api-key': key.trim(), Accept: 'application/json' },
        });
        if (!response.ok) throw Error('HTTP');
        const body = record(await response.json()), meta = record(body.meta);
        if (body.errors || !Array.isArray(body.data) || meta.page !== 1 || meta.limit !== 100 ||
            !Number.isInteger(meta.total) || meta.total !== body.data.length || body.data.length > 100 ||
            (meta.warnings !== undefined && (!Array.isArray(meta.warnings) || meta.warnings.length))) throw Error('Incomplete source');
        return parseSourceBookings(body.data.map(normalizeSourceBooking));
      } catch { throw Error('Complete Channex staging booking source unavailable; response withheld'); }
    },
  };
}
