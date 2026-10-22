/** Explicit-token, GET-only snapshot. Never imports production auth, database or writers. */
import { normalizeCalderwoodTiming } from './message-timing.ts';
export const CALDERWOOD = Object.freeze({ guestyListingId: '66797ba7f51d72001388bc29', airbnbListingId: '895455360892927934', channexMapping: null });

const readFailures = {
  response: 'Invalid Guesty response',
  local_date: 'Invalid local date',
  classification: 'Missing reservation classification',
  identity: 'Invalid reservation identity',
  multi_stay: 'Multi-segment reservation requires review',
  scope: 'Reservation outside Calderwood',
  dates: 'Inconsistent reservation dates',
  credentials: 'Explicit server-side Guesty token required',
  window: 'Invalid comparison window',
  request: 'Guesty snapshot request failed; details withheld',
  http: 'Guesty rejected the reservation read',
  json: 'Invalid Guesty JSON response',
  pagination: 'Invalid Guesty pagination',
  changed: 'Guesty collection changed during pagination',
  incomplete: 'Incomplete Guesty page',
  limit: 'Guesty snapshot exceeds review limit',
} as const;
export class GuestySnapshotReadError extends Error {
  readonly code: keyof typeof readFailures;
  readonly httpStatus: number | null;
  constructor(code: keyof typeof readFailures, status?: number) {
    super(readFailures[code]);
    this.name = 'GuestySnapshotReadError'; this.code = code;
    this.httpStatus = Number.isInteger(status) && status! >= 400 && status! <= 599 ? status! : null;
  }
}
/** Rebuild from a closed code list. Never forward message/cause/provider payload. */
export function guestySnapshotReadExplanation(error: unknown): string | null {
  if (!(error instanceof GuestySnapshotReadError) || !Object.hasOwn(readFailures, error.code)) return null;
  const status = error.code === 'http' && Number.isInteger(error.httpStatus) && error.httpStatus! >= 400 && error.httpStatus! <= 599 ? ` (HTTP ${error.httpStatus})` : '';
  return readFailures[error.code] + status;
}

type Row = Record<string, unknown>;
type Fetcher = (input: string, init: RequestInit) => Promise<Response>;
function record(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GuestySnapshotReadError('response');
  return value as Row;
}
function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new GuestySnapshotReadError('local_date');
  const ms = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) throw new GuestySnapshotReadError('local_date');
  return value;
}
function label(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 80 || /[\r\n]/.test(value)) throw new GuestySnapshotReadError('classification');
  return value;
}
function normalize(value: unknown) {
  const r = record(value);
  if (typeof r.reservationId !== 'string' || !/^[a-f0-9]{24}$/i.test(r.reservationId)) throw new GuestySnapshotReadError('identity');
  if (!Array.isArray(r.stay) || r.stay.length !== 1) throw new GuestySnapshotReadError('multi_stay');
  const stay = record(r.stay[0]);
  if (stay.listingId !== CALDERWOOD.guestyListingId || stay.parentListingId) throw new GuestySnapshotReadError('scope');
  const start = date(stay.checkInDateLocalized), end = date(stay.checkOutDateLocalized);
  if (start >= end || date(r.checkInDateLocalized) !== start || date(r.checkOutDateLocalized) !== end) throw new GuestySnapshotReadError('dates');
  return { id: r.reservationId, listingId: CALDERWOOD.guestyListingId, start, end, status: label(r.status), source: label(r.source),
    timing: normalizeCalderwoodTiming({ arrival: r.checkIn, departure: r.checkOut, stayArrival: stay.checkIn, stayDeparture: stay.checkOut, start, end }),
  };
}
export async function readCalderwoodGuesty(token: string, window: { from: string; to: string }, fetcher: Fetcher = fetch) {
  if (typeof globalThis.window !== 'undefined' || !token.trim() || /[\r\n]/.test(token)) throw new GuestySnapshotReadError('credentials');
  const from = date(window.from), to = date(window.to);
  if (from >= to || Date.parse(to) - Date.parse(from) > 366 * 86400000) throw new GuestySnapshotReadError('window');
  const rows: ReturnType<typeof normalize>[] = [], seen = new Set<string>();
  for (let page = 0; page < 20; page++) {
    const skip = page * 100;
    const query = new URLSearchParams({ 'filter[listingId]': CALDERWOOD.guestyListingId,
      'filter[checkOut][gte]': from, 'filter[checkIn][lt]': to, sort: '_id', skip: String(skip), limit: '100' });
    let response: Response;
    try {
      response = await fetcher(`https://open-api.guesty.com/v1/reservations-v3/search?${query}`, {
        method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${token.trim()}`, Accept: 'application/json' },
      });
    } catch { throw new GuestySnapshotReadError('request'); }
    if (!response.ok) throw new GuestySnapshotReadError('http', response.status);
    let payload: Row;
    try { payload = record(await response.json()); } catch { throw new GuestySnapshotReadError('json'); }
    const pagination = record(payload.pagination);
    if (!Array.isArray(payload.results) || payload.results.length > 100 || pagination.skip !== skip || pagination.limit !== 100 || typeof pagination.hasMore !== 'boolean') throw new GuestySnapshotReadError('pagination');
    for (const raw of payload.results) {
      const row = normalize(raw);
      if (seen.has(row.id)) throw new GuestySnapshotReadError('changed');
      seen.add(row.id);
      // A stay checking out on the first day does not occupy a night in this window.
      if (row.start < to && row.end > from) rows.push(row);
    }
    if (!pagination.hasMore) return {
      mode: 'read-only-snapshot' as const, executable: false as const, inventoryAuthority: false as const,
      paginationComplete: true as const, baselineComplete: false as const,
      missingEvidence: ['independent-blocks', 'authoritative-revisions', 'channex-mapping', 'cross-provider-comparison'] as const,
      window: { from, to }, reservations: rows,
    };
    if (payload.results.length !== 100) throw new GuestySnapshotReadError('incomplete');
  }
  throw new GuestySnapshotReadError('limit');
}
