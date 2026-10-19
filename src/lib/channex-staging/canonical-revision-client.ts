import { CALDERWOOD_STAGING, readCalderwoodChannex } from '../calderwood-readonly/channex.ts';
import { record } from './core.ts';
import { normalizeCanonicalRevision, parseCanonicalRevision, type CanonicalRevision, type CanonicalRevisionClient } from './canonical-revisions.ts';

const BASE = 'https://staging.channex.io/api/v1';
export function createCanonicalRevisionClient(key: string, fetcher: typeof fetch = fetch): CanonicalRevisionClient {
  if (typeof window !== 'undefined' || !key.trim() || /[\r\n]/.test(key)) throw Error('Explicit server staging credential required');
  async function request(path: string, method = 'GET') {
    try {
      const response = await fetcher(BASE + path, { method, redirect: 'error', cache: 'no-store',
        signal: AbortSignal.timeout(20000), headers: { 'user-api-key': key.trim(), Accept: 'application/json' } });
      if (!response.ok) throw Error('HTTP');
      const body = record(await response.json());
      if (body.errors || (body.meta && record(body.meta).warnings !== undefined &&
          (!Array.isArray(record(body.meta).warnings) || (record(body.meta).warnings as unknown[]).length))) throw Error('Envelope');
      return body;
    } catch { throw Error('Channex staging revision request incomplete; response withheld'); }
  }
  function id(value: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw Error('Invalid revision ID');
    return value;
  }
  const revision = async (value: string) => {
    const r = normalizeCanonicalRevision((await request('/booking_revisions/' + id(value))).data);
    if (r.id !== value) throw Error('Revision response identity mismatch');
    return r;
  };
  return {
    async inspect() {
      // Reuse the established exact property/room/rate and zero-channel checks.
      // This one-day read grants ingestion only; it cannot publish availability.
      await readCalderwoodChannex(key, { from: '2027-01-01', to: '2027-01-02' }, fetcher);
    },
    async feed() {
      const params = new URLSearchParams({ 'filter[property_id]': CALDERWOOD_STAGING.propertyId,
        'pagination[page]': '1', 'pagination[limit]': '100', 'order[inserted_at]': 'asc' });
      const body = await request('/booking_revisions/feed?' + params), meta = record(body.meta);
      if (!Array.isArray(body.data) || body.data.length > 100 || meta.page !== 1 ||
          !Number.isInteger(meta.total) || (meta.total as number) < body.data.length ||
          !Number.isInteger(meta.limit) || (meta.limit as number) < 1 || (meta.limit as number) > 100 ||
          body.data.length !== Math.min(meta.total as number, meta.limit as number)) throw Error('Invalid revision page');
      // Drain only the first page. ACK removes rows; paginating after ACK would skip work.
      return body.data.map(normalizeCanonicalRevision);
    },
    revision,
    async acknowledge(raw: CanonicalRevision) {
      const expected = parseCanonicalRevision(raw), remote = await revision(expected.id);
      if (JSON.stringify(remote) !== JSON.stringify(expected)) throw Error('Revision changed before ACK');
      const body = await request('/booking_revisions/' + id(expected.id) + '/ack', 'POST');
      if (!body.meta || record(body.meta).message !== 'Success') throw Error('Revision ACK unconfirmed; retry is safe');
    },
  };
}
