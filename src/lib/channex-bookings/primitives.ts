/** Provider date boundaries, independent of any staging fixture. */
function dateMs(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid calendar date');
  const value = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) throw new Error('Invalid calendar date');
  return value;
}
export function nights(start: string, end: string): string[] {
  const from = dateMs(start), to = dateMs(end);
  if (to <= from || to - from > 500 * 86400000) throw new Error('Invalid or oversized date range');
  return Array.from({ length: (to - from) / 86400000 }, (_, i) => new Date(from + i * 86400000).toISOString().slice(0, 10));
}
export function revisionTime(value: string): string {
  // Channex timestamps may omit the UTC suffix. Preserve microseconds for ordering.
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z?$/.exec(value);
  if (!match) throw new Error('Invalid revision timestamp');
  dateMs(match[1]);
  const parts = match[2].split(':').map(Number);
  if (parts[0] > 23 || parts[1] > 59 || parts[2] > 59) throw new Error('Invalid revision timestamp');
  return `${match[1]}T${match[2]}.${(match[3] ?? '').padEnd(6, '0')}Z`;
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Unexpected Channex response shape');
  return value as Record<string, unknown>;
}
