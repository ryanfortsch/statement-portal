/** Narrow read-only bridge to Helm's existing Guesty calendar mirror. */
import { nights, record, TEST_START, TEST_END } from './core.ts';

export const PARENT_PROPERTY = '17_beach_rd';
export const PARENT_LISTING = '695d5c8afb0a0500153d5d1c';
export const PARENT_MAX_AGE_MS = 2 * 60 * 60 * 1000;
export type ParentNight = { date: string; status: 'available' | 'unavailable' | 'booked'; syncedAt: string; hold: boolean };
export type ParentCalendar = { nights: ParentNight[] };
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function normalizeParentCalendar(property: unknown, mappings: unknown, rows: unknown): ParentCalendar {
  const p = record(property);
  if (p.id !== PARENT_PROPERTY || p.calendar_authority !== 'guesty') throw new Error('Parent calendar authority does not match');
  // The mirror can combine multiple listings. Never call that a whole-house-only source.
  if (!Array.isArray(mappings) || mappings.length !== 1 || record(mappings[0]).property_id !== PARENT_PROPERTY || record(mappings[0]).listing_id !== PARENT_LISTING) throw new Error('Whole-house listing mapping is ambiguous');
  if (!Array.isArray(rows)) throw new Error('Parent calendar response is invalid');
  const expected = new Set(nights(TEST_START, TEST_END)), seen = new Set<string>();
  const result: ParentNight[] = rows.map((item) => {
    const row = record(item);
    if (row.property_id !== PARENT_PROPERTY || typeof row.date !== 'string' || !expected.has(row.date) || seen.has(row.date)) throw new Error('Parent calendar contains an unexpected date or property');
    if (!['available', 'unavailable', 'booked'].includes(String(row.status)) || typeof row.synced_at !== 'string' || !Number.isFinite(Date.parse(row.synced_at))) throw new Error('Parent calendar status or timestamp is invalid');
    seen.add(row.date);
    return { date: row.date, status: row.status as ParentNight['status'], syncedAt: row.synced_at, hold: row.block_type != null };
  });
  return { nights: result.sort((a, b) => a.date.localeCompare(b.date)) };
}

export async function readParentCalendar(config: { url: string; key: string }, fetcher: Fetcher = fetch): Promise<ParentCalendar> {
  const base = new URL(config.url);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || !config.key) throw new Error('Parent calendar configuration is invalid');
  async function read(table: string, params: Record<string, string>) {
    const url = new URL(`/rest/v1/${table}`, base);
    url.search = new URLSearchParams(params).toString();
    let response: Response;
    try { response = await fetcher(url, { method: 'GET', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, Accept: 'application/json' } }); }
    catch { throw new Error('Whole-house calendar read failed'); }
    if (!response.ok) throw new Error('Whole-house calendar read failed');
    try { return await response.json() as unknown; } catch { throw new Error('Whole-house calendar response is invalid'); }
  }
  const properties = await read('properties', { select: 'id,calendar_authority', id: `eq.${PARENT_PROPERTY}`, limit: '2' });
  if (!Array.isArray(properties) || properties.length !== 1) throw new Error('Whole-house property is unavailable');
  const mappings = await read('guesty_listings', { select: 'listing_id,property_id', property_id: `eq.${PARENT_PROPERTY}`, order: 'listing_id.asc', limit: '100' });
  const rows = await read('property_calendar_days', { select: 'property_id,date,status,block_type,synced_at', property_id: `eq.${PARENT_PROPERTY}`, and: `(date.gte.${TEST_START},date.lt.${TEST_END})`, order: 'date.asc', limit: '240' });
  // A bounded 120-night window needs no multi-page read. Every missing date remains unknown.
  return normalizeParentCalendar(properties[0], mappings, rows);
}

export function parentNightCurrent(night: ParentNight | undefined, now: number): boolean {
  if (!night) return false;
  const age = now - Date.parse(night.syncedAt);
  return Number.isFinite(age) && age >= 0 && age <= PARENT_MAX_AGE_MS;
}
