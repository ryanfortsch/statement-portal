import { calendarDates, type normalizeCalendar } from './calendar.ts';
export const CALDERWOOD_STAGING = Object.freeze({ propertyId: '30584a9a-8784-4eb1-a387-e26bd43aec1c', roomTypeId: 'f795ae2c-f47d-4751-86ff-e883b6d30800', ratePlanId: '7f95b731-ff05-4c41-99c9-f39b3e772fec' });
type Row = Record<string, unknown>;
const obj = (v: unknown): Row => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('Invalid staging response'); return v as Row; };
const rel = (row: Row, key: string) => obj(obj(obj(row.relationships)[key]).data).id;
const bool = (v: unknown) => typeof v === 'boolean' ? v : null;
const integer = (v: unknown, min = 0) => typeof v === 'number' && Number.isInteger(v) && v >= min ? v : null;
function rate(v: unknown) { if (typeof v !== 'number' && (typeof v !== 'string' || !/^\d+(\.\d{1,2})?$/.test(v))) return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; }
export async function readCalderwoodChannex(key: string, window: { from: string; to: string }, fetcher: (url: string, init: RequestInit) => Promise<Response> = fetch) {
  const dates = calendarDates(window), m = CALDERWOOD_STAGING;
  if (typeof globalThis.window !== 'undefined' || !key.trim() || /[\r\n]/.test(key)) throw Error('Server staging key required');
  const request = async (path: string) => {
    try {
      const response = await fetcher(`https://staging.channex.io/api/v1${path}`, { method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000), headers: { 'user-api-key': key.trim(), Accept: 'application/json' } });
      if (!response.ok) throw Error('HTTP error');
      const payload = obj(await response.json());
      if (payload.errors) throw Error('Error envelope');
      if (payload.meta) { const warnings = obj(payload.meta).warnings; if (warnings !== undefined && (!Array.isArray(warnings) || warnings.length)) throw Error('Warnings'); }
      return payload;
    } catch { throw Error('Channex staging read unavailable; details withheld'); }
  };
  const startedAt = new Date().toISOString();
  const property = obj((await request(`/properties/${m.propertyId}`)).data), pa = obj(property.attributes);
  if (property.id !== m.propertyId || pa.title !== '65 Calderwood - Isolated Staging' || pa.currency !== 'USD' || pa.timezone !== 'America/New_York') throw Error('Staging property configuration changed');
  const room = obj((await request(`/room_types/${m.roomTypeId}`)).data), ra = obj(room.attributes);
  if (room.id !== m.roomTypeId || rel(room, 'property') !== m.propertyId || ra.count_of_rooms !== 1 || ra.occ_adults !== 6 || ra.occ_children !== 0 || ra.occ_infants !== 0) throw Error('Staging room mapping changed');
  const plan = obj((await request(`/rate_plans/${m.ratePlanId}`)).data), a = obj(plan.attributes);
  if (plan.id !== m.ratePlanId || rel(plan, 'property') !== m.propertyId || rel(plan, 'room_type') !== m.roomTypeId || a.currency !== 'USD' || a.sell_mode !== 'per_room' || a.title !== 'TEST ONLY - Calderwood - CLOSED - $100 placeholder' || !Array.isArray(a.stop_sell) || a.stop_sell.length !== 7 || !a.stop_sell.every(v => v === true)) throw Error('Staging rate mapping or stopped defaults changed');
  const channelQuery = new URLSearchParams({ 'filter[property_id]': m.propertyId, 'pagination[page]': '1', 'pagination[limit]': '100' });
  const channels = await request(`/channels?${channelQuery}`), meta = obj(channels.meta);
  if (!Array.isArray(channels.data) || channels.data.length || meta.total !== 0 || meta.page !== 1) throw Error('Staging isolation unverified: channels present or incomplete response');
  const query = new URLSearchParams({ 'filter[property_id]': m.propertyId, 'filter[date][gte]': dates[0], 'filter[date][lte]': dates.at(-1)! });
  const availability = obj((await request(`/availability?${query}`)).data);
  query.set('filter[restrictions]', 'rate,min_stay_arrival,min_stay_through,closed_to_arrival,closed_to_departure,stop_sell,max_stay');
  const restrictions = obj((await request(`/restrictions?${query}`)).data);
  if (Object.keys(availability).some(id => id !== m.roomTypeId) || Object.keys(restrictions).some(id => id !== m.ratePlanId)) throw Error('Unexpected staging inventory mapping');
  const counts = availability[m.roomTypeId] == null ? {} : obj(availability[m.roomTypeId]);
  const rates = restrictions[m.ratePlanId] == null ? {} : obj(restrictions[m.ratePlanId]);
  const expected = new Set(dates);
  if ([...Object.keys(counts), ...Object.keys(rates)].some(d => !expected.has(d))) throw Error('Unexpected staging calendar date');
  const days = dates.map(date => {
    const d = rates[date] == null ? {} : obj(rates[date]);
    return { date, inventory: counts[date] === 0 || counts[date] === 1 ? counts[date] as number : null, price: rate(d.rate), minArrival: integer(d.min_stay_arrival, 1), minThrough: integer(d.min_stay_through, 1), maxStay: integer(d.max_stay), cta: bool(d.closed_to_arrival), ctd: bool(d.closed_to_departure), stopSell: bool(d.stop_sell) };
  });
  return { mapping: m, currency: 'USD' as const, days, startedAt, finishedAt: new Date().toISOString(), executable: false as const };
}
export function compareProviders(guesty: ReturnType<typeof normalizeCalendar>, staging: Awaited<ReturnType<typeof readCalderwoodChannex>>) {
  const source = new Map(guesty.days.map(d => [d.date, d]));
  return staging.days.map(test => {
    const live = source.get(test.date), missing: string[] = [], differences: string[] = [];
    if (!live) missing.push('Guesty night missing');
    for (const [name, value] of Object.entries(test)) if (value === null) missing.push(`Channex ${name} missing`);
    if (live) {
      if (live.price === null || live.currency === null) missing.push('Guesty rate missing');
      else if (test.price !== null && (live.currency !== staging.currency || Math.round(live.price * 100) !== Math.round(test.price * 100))) differences.push('Posted rate');
      if (live.minNights === null) missing.push('Guesty minimum missing');
      else if (test.minArrival !== null && live.minNights !== test.minArrival) differences.push('Arrival minimum');
      for (const key of ['cta', 'ctd'] as const) { if (live[key] === null) missing.push(`Guesty ${key} missing`); else if (test[key] !== null && live[key] !== test[key]) differences.push(key === 'cta' ? 'Arrival restriction' : 'Departure restriction'); }
      if (live.status === 'unknown' || live.unknownBlock) missing.push('Guesty closure evidence unknown');
      else if (test.stopSell !== null && test.inventory !== null) {
        const guestyClosed = live.status !== 'available' || live.reasons.length > 0 || live.reservationIds.length > 0 || live.allotment === 0;
        const stagingClosed = test.stopSell || test.inventory === 0;
        if (guestyClosed !== stagingClosed) differences.push('Closed / open state');
      }
    }
    const safety = test.stopSell === true ? 'Stopped' : test.stopSell === false ? 'STOP-SELL OFF' : 'Stop-sell unknown';
    return { date: test.date, live: live ?? null, test, missing, differences, safety };
  });
}
