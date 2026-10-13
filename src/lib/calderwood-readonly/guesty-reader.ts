/** Explicit-token, GET-only snapshot. Never imports production auth, database or writers. */
export const CALDERWOOD = Object.freeze({ guestyListingId: '66797ba7f51d72001388bc29', airbnbListingId: '895455360892927934', channexMapping: null });
type Row = Record<string, unknown>;
type Fetcher = (input: string, init: RequestInit) => Promise<Response>;
function record(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid Guesty response');
  return value as Row;
}
function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('Invalid local date');
  const ms = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) throw Error('Invalid local date');
  return value;
}
function label(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 80 || /[\r\n]/.test(value)) throw Error('Missing reservation classification');
  return value;
}
function normalize(value: unknown) {
  const r = record(value);
  if (typeof r.reservationId !== 'string' || !/^[a-f0-9]{24}$/i.test(r.reservationId)) throw Error('Invalid reservation identity');
  if (!Array.isArray(r.stay) || r.stay.length !== 1) throw Error('Multi-segment reservation requires review');
  const stay = record(r.stay[0]);
  if (stay.listingId !== CALDERWOOD.guestyListingId || stay.parentListingId) throw Error('Reservation outside Calderwood');
  const start = date(stay.checkInDateLocalized), end = date(stay.checkOutDateLocalized);
  if (start >= end || date(r.checkInDateLocalized) !== start || date(r.checkOutDateLocalized) !== end) throw Error('Inconsistent reservation dates');
  return { id: r.reservationId, listingId: CALDERWOOD.guestyListingId, start, end, status: label(r.status), source: label(r.source) };
}
export async function readCalderwoodGuesty(token: string, window: { from: string; to: string }, fetcher: Fetcher = fetch) {
  if (typeof globalThis.window !== 'undefined' || !token.trim() || /[\r\n]/.test(token)) throw Error('Explicit server-side Guesty token required');
  const from = date(window.from), to = date(window.to);
  if (from >= to || Date.parse(to) - Date.parse(from) > 366 * 86400000) throw Error('Invalid comparison window');
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
    } catch { throw Error('Guesty snapshot request failed; details withheld'); }
    if (!response.ok) throw Error(`Guesty snapshot HTTP ${response.status}; response withheld`);
    let payload: Row;
    try { payload = record(await response.json()); } catch { throw Error('Invalid Guesty JSON response'); }
    const pagination = record(payload.pagination);
    if (!Array.isArray(payload.results) || payload.results.length > 100 || pagination.skip !== skip || pagination.limit !== 100 || typeof pagination.hasMore !== 'boolean') throw Error('Invalid Guesty pagination');
    for (const raw of payload.results) {
      const row = normalize(raw);
      if (seen.has(row.id)) throw Error('Guesty collection changed during pagination');
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
    if (payload.results.length !== 100) throw Error('Incomplete Guesty page');
  }
  throw Error('Guesty snapshot exceeds review limit');
}
