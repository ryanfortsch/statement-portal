import { CALDERWOOD, readCalderwoodGuesty } from './guesty-reader.ts';
type Row = Record<string, unknown>;
const blockLabels: Record<string, string> = { m: 'Manual hold', r: 'Reserved', b: 'Reservation', bd: 'Blocked by default', sr: 'Calendar rule', abl: 'Annual limit', a: 'Allotment', bw: 'Booking window', o: 'Owner stay', pt: 'Preparation time', ic: 'Imported calendar', an: 'Advance notice' };
const object = (v: unknown): Row => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('Invalid calendar shape'); return v as Row; };
function localDate(v: unknown): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) throw Error('Invalid calendar date');
  return v;
}
const numeric = (v: unknown, integer = false) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && (!integer || Number.isInteger(v)) ? v : null;
const flag = (v: unknown) => typeof v === 'boolean' ? v : null;
const identity = (v: unknown): string | null => typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v) ? v : null;
export function calendarDates(window: { from: string; to: string }) {
  const from = localDate(window.from), to = localDate(window.to);
  if (from >= to || Date.parse(to) - Date.parse(from) > 366 * 86400000) throw Error('Invalid calendar window');
  return Array.from({ length: (Date.parse(to) - Date.parse(from)) / 86400000 }, (_, i) => new Date(Date.parse(from) + i * 86400000).toISOString().slice(0, 10));
}
/** Whitelist fields; never retain nested guests, money, notes or creator details. */
export function normalizeCalendar(payload: unknown, window: { from: string; to: string }) {
  const dates = calendarDates(window), expected = new Set(dates), root = object(payload);
  const raw = root.days ?? object(root.data).days;
  if (!Array.isArray(raw) || raw.length > dates.length) throw Error('Invalid calendar days');
  const seen = new Set<string>();
  const days = raw.map(value => {
    const d = object(value), date = localDate(d.date);
    if (d.listingId !== CALDERWOOD.guestyListingId || !expected.has(date) || seen.has(date)) throw Error('Calendar identity or coverage mismatch');
    seen.add(date);
    const blocks = d.blocks == null ? null : object(d.blocks);
    const reasons: string[] = [];
    let unknownBlock = blocks === null;
    if (blocks) for (const [key, enabled] of Object.entries(blocks)) {
      if (typeof enabled !== 'boolean') { unknownBlock = true; continue; }
      if (enabled) { reasons.push(blockLabels[key] ?? 'Unknown block'); if (!blockLabels[key]) unknownBlock = true; }
    }
    const refs = new Set<string>();
    if (d.reservationId != null) { const id = identity(d.reservationId); if (!id) throw Error('Invalid reservation reference'); refs.add(id); }
    if (d.blockRefs != null && !Array.isArray(d.blockRefs)) throw Error('Invalid calendar references');
    for (const value of (d.blockRefs ?? []) as unknown[]) {
      const ref = object(value);
      if (ref.listingId != null && ref.listingId !== CALDERWOOD.guestyListingId) throw Error('Block outside Calderwood');
      if (ref.reservationId != null) { const id = identity(ref.reservationId); if (!id) throw Error('Invalid reservation reference'); refs.add(id); }
      if (typeof ref.type === 'string') { const reason = blockLabels[ref.type] ?? 'Unknown block'; if (!reasons.includes(reason)) reasons.push(reason); if (!blockLabels[ref.type]) unknownBlock = true; }
      else unknownBlock = true;
    }
    return { date, status: ['available', 'unavailable', 'booked', 'reserved'].includes(String(d.status)) ? String(d.status) : 'unknown',
      price: numeric(d.price), currency: typeof d.currency === 'string' && /^[A-Z]{3}$/.test(d.currency) ? d.currency : null,
      minNights: numeric(d.minNights, true), cta: flag(d.cta), ctd: flag(d.ctd), requestToBook: flag(d.requestToBook),
      allotment: numeric(d.allotment, true), reasons, unknownBlock, reservationIds: [...refs] };
  }).sort((a, b) => a.date.localeCompare(b.date));
  return { days, missingDates: dates.filter(d => !seen.has(d)), coverageComplete: seen.size === dates.length, inventoryAuthority: false as const };
}
export async function readCalderwoodCalendar(token: string, window: { from: string; to: string }, fetcher: (url: string, init: RequestInit) => Promise<Response> = fetch) {
  const dates = calendarDates(window);
  if (typeof globalThis.window !== 'undefined' || !token.trim() || /[\r\n]/.test(token)) throw Error('Server token required');
  const query = new URLSearchParams({ startDate: dates[0], endDate: dates[dates.length - 1], includeAllotment: 'true' });
  try {
    const response = await fetcher(`https://open-api.guesty.com/v1/availability-pricing/api/calendar/listings/${CALDERWOOD.guestyListingId}?${query}`, {
      method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${token.trim()}`, Accept: 'application/json' },
    });
    if (!response.ok) throw Error('Calendar HTTP failure');
    return normalizeCalendar(await response.json(), window);
  } catch { throw Error('Guesty calendar read failed; details withheld'); }
}
/** Diagnostic only: snapshots are sequential, not atomic or proof of channel delivery. */
export function compareCalendar(calendar: ReturnType<typeof normalizeCalendar>, reservations: Awaited<ReturnType<typeof readCalderwoodGuesty>>['reservations']) {
  return calendar.days.map(day => {
    const covering = reservations.filter(r => r.start <= day.date && r.end > day.date);
    const confirmed = covering.filter(r => r.status === 'confirmed');
    const issues: string[] = [];
    if (day.unknownBlock || day.status === 'unknown') issues.push('Unknown calendar evidence');
    if (day.price === null || day.currency === null || day.minNights === null || day.cta === null || day.ctd === null || day.requestToBook === null) issues.push('Incomplete pricing or restrictions');
    if (confirmed.some(r => !day.reservationIds.includes(r.id))) issues.push('Confirmed stay missing calendar reference');
    if (day.reservationIds.some(id => !covering.some(r => r.id === id))) issues.push('Calendar reference missing matching stay dates');
    if (day.status === 'available' && (confirmed.length || day.reasons.length || day.reservationIds.length || day.allotment === 0)) issues.push('Available status conflicts with occupancy or blocks');
    if (day.status !== 'available' && !day.reasons.length && !day.reservationIds.length) issues.push('Unavailable date needs explanation');
    if (confirmed.length > 1) issues.push('Overlapping confirmed records need identity review');
    return { ...day, issues };
  });
}
