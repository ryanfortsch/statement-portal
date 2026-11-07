import 'server-only';
import { CALDERWOOD_PRODUCTION as m } from '../channex-production-preflight.ts';
import { BookingAuditError, projectRemoteBooking, type RemoteBooking } from './reconciliation.ts';
import { record } from './primitives.ts';

/** Explicit credential, fixed production destination, GET-only, no ACK. All
 * statuses/all dates prevent a moved/cancelled stay disappearing by date filter. */
export function createProductionBookingCollectionReader(apiKey: string, fetcher: typeof fetch = fetch, clock = Date.now) {
  if (typeof window !== 'undefined' || !apiKey || apiKey.length > 4096 || /[\x00-\x20\x7f]/.test(apiKey)) {
    throw new BookingAuditError('PROVIDER_READ_FAILED');
  }
  return async (deadline: number): Promise<{ rows: RemoteBooking[]; pages: number }> => {
    const rows: RemoteBooking[] = [], ids = new Set<string>(), revisions = new Set<string>();
    let total: number | undefined, limit: number | undefined;
    for (let page = 1; page <= 50; page++) {
      const remaining = deadline - clock();
      if (!Number.isSafeInteger(deadline) || remaining <= 0 || remaining > 90_000) throw new BookingAuditError('AUDIT_LIMIT_REACHED');
      const params = new URLSearchParams({ 'filter[property_id]': m.propertyId, 'pagination[page]': String(page),
        'pagination[limit]': '100', 'order[id]': 'asc' });
      let body: Record<string, unknown>;
      try {
        const response = await fetcher('https://app.channex.io/api/v1/bookings?' + params, { method: 'GET',
          headers: { 'user-api-key': apiKey, Accept: 'application/json' }, cache: 'no-store', redirect: 'error',
          signal: AbortSignal.timeout(Math.min(20_000, remaining)) });
        if (response.status !== 200 || response.redirected) throw Error();
        const text = await response.text();
        if (text.length > 2_000_000) throw Error();
        body = record(JSON.parse(text));
      } catch { throw new BookingAuditError('PROVIDER_READ_FAILED'); }
      if (clock() >= deadline) throw new BookingAuditError('AUDIT_LIMIT_REACHED');
      try {
        const meta = record(body.meta);
        if (body.errors != null || (meta.warnings !== undefined && (!Array.isArray(meta.warnings) || meta.warnings.length))
          || meta.page !== page || !Number.isSafeInteger(meta.total) || (meta.total as number) < 0 || (meta.total as number) > 5000
          || !Number.isSafeInteger(meta.limit) || (meta.limit as number) < 1 || (meta.limit as number) > 100
          || !Array.isArray(body.data)) throw Error();
        if (total !== undefined && (total !== meta.total || limit !== meta.limit)) throw Error();
        total = meta.total as number; limit = meta.limit as number;
        if (body.data.length !== Math.min(limit, Math.max(0, total - (page - 1) * limit))) throw Error();
        for (const raw of body.data) {
          const row = projectRemoteBooking(raw);
          if (ids.has(row.id) || revisions.has(row.revisionId)) throw Error();
          ids.add(row.id); revisions.add(row.revisionId); rows.push(row);
        }
        if (rows.length === total) return { rows: rows.sort((a, b) => a.id.localeCompare(b.id)), pages: page };
      } catch { throw new BookingAuditError('INVALID_BOOKING_COLLECTION'); }
    }
    throw new BookingAuditError('AUDIT_LIMIT_REACHED');
  };
}
