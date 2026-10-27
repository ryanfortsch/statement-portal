/** Pure date-window validation, shared by the reader and the isolated worker. */
export function localDate(v: unknown): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) throw Error('Invalid calendar date');
  return v;
}
export function calendarDates(window: { from: string; to: string }, maxDays: 366 | 500 = 366) {
  const from = localDate(window.from), to = localDate(window.to);
  if (from >= to || Date.parse(to) - Date.parse(from) > maxDays * 86400000) throw Error('Invalid calendar window');
  return Array.from({ length: (Date.parse(to) - Date.parse(from)) / 86400000 }, (_, i) => new Date(Date.parse(from) + i * 86400000).toISOString().slice(0, 10));
}
