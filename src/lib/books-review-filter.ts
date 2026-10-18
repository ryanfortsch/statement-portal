/**
 * The review table's filter on /books/[entity_id], shared by the page and
 * the two batch routes so "Categorize" and "Accept high-confidence" act on
 * exactly the rows the operator is looking at.
 *
 *   ?all=1          show reviewed rows too (unreviewed only is the default)
 *   ?quarter=2026-Q3  rows dated in that quarter (books.ts quarterRange)
 *   ?q=amazon       description contains the text, case-insensitive
 *
 * Presentation and review only: nothing here writes a category.
 *
 * No imports, so the test runner can load it directly; the quarter math is
 * the same as books.ts quarterRange, which the test checks.
 */

export type BooksFilter = {
  unreviewedOnly: boolean;
  /** "2026-Q3", or null for every date. */
  quarter: string | null;
  /** Description search, trimmed; '' for none. */
  q: string;
};

export const DEFAULT_BOOKS_FILTER: BooksFilter = { unreviewedOnly: true, quarter: null, q: '' };

type RawParam = string | string[] | undefined;
const first = (v: RawParam) => (Array.isArray(v) ? v[0] : v);

export function parseBooksFilter(params: { all?: RawParam; quarter?: RawParam; q?: RawParam }): BooksFilter {
  const quarter = first(params.quarter) ?? '';
  return {
    unreviewedOnly: first(params.all) !== '1',
    quarter: /^\d{4}-Q[1-4]$/.test(quarter) ? quarter : null,
    q: (first(params.q) ?? '').trim().slice(0, 100),
  };
}

/** The query string for a filter: '' for the default view. */
export function booksFilterQuery(f: BooksFilter): string {
  const p = new URLSearchParams();
  if (!f.unreviewedOnly) p.set('all', '1');
  if (f.quarter) p.set('quarter', f.quarter);
  if (f.q) p.set('q', f.q);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** First day of the quarter and the first day after it, YYYY-MM-DD. */
export function quarterBounds(quarter: string): { start: string; endExclusive: string } | null {
  const m = quarter.match(/^(\d{4})-Q([1-4])$/);
  if (!m) return null;
  const y = Number(m[1]);
  const startMonth = (Number(m[2]) - 1) * 3;
  const iso = (yy: number, mm: number) => `${yy + Math.floor(mm / 12)}-${String((mm % 12) + 1).padStart(2, '0')}-01`;
  return { start: iso(y, startMonth), endExclusive: iso(y, startMonth + 3) };
}

/** The quarter a YYYY-MM-DD date falls in. */
export function quarterOf(date: string): string {
  const [y, m] = date.split('-').map(Number);
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}

/**
 * Every quarter from the oldest row to the newest, newest first, for the
 * picker. Empty when the entity has no rows.
 */
export function quarterOptions(range: { min: string; max: string } | null): string[] {
  if (!range) return [];
  const [y0, q0] = quarterOf(range.min).split('-Q').map(Number);
  const [y1, q1] = quarterOf(range.max).split('-Q').map(Number);
  const out: string[] = [];
  for (let y = y1, q = q1; y > y0 || (y === y0 && q >= q0); q === 1 ? (y -= 1, q = 4) : (q -= 1)) {
    out.push(`${y}-Q${q}`);
    if (out.length > 80) break;
  }
  return out;
}

/** A PostgREST ilike pattern that matches the text literally anywhere. */
export function containsPattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** The query-builder methods the filter needs; a Supabase select builder has them. */
type FilterChain = {
  eq(column: string, value: unknown): FilterChain;
  gte(column: string, value: unknown): FilterChain;
  lt(column: string, value: unknown): FilterChain;
  ilike(column: string, pattern: string): FilterChain;
};

/**
 * Narrow a ledger_transactions query to the filter. `reviewed: false`
 * applies only when unreviewedOnly is set; the batch routes, whose
 * candidates are unreviewed by definition, pass the same filter.
 *
 * Typed loosely on purpose: a structural constraint over Supabase's
 * builder generics sends tsc into "excessively deep" instantiation. The
 * builder's own methods return the builder, so the cast round-trips.
 */
export function applyBooksFilter<Q>(query: Q, f: BooksFilter): Q {
  let qb = query as unknown as FilterChain;
  if (f.unreviewedOnly) qb = qb.eq('reviewed', false);
  const bounds = f.quarter ? quarterBounds(f.quarter) : null;
  if (bounds) qb = qb.gte('txn_date', bounds.start).lt('txn_date', bounds.endExclusive);
  if (f.q) qb = qb.ilike('description', containsPattern(f.q));
  return qb as unknown as Q;
}
