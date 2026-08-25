/**
 * Read every row of a PostgREST select, not just the first page.
 *
 * A bare `.select()` against Supabase returns at most `max-rows` (1000 by
 * default) with no error and no signal that anything was left behind. Code
 * that treats the result as "the whole table" then works from a silently
 * truncated slice. That is a nuisance in a read path and a corruption bug in
 * a write path -- see dedupeAllBookings in ical-sync.ts, which cleared
 * correct duplicate_of marks for rows whose cluster twin fell outside the cap.
 *
 * Deliberately dependency-free so it can be exercised directly by
 * scripts/paged_select_check.mjs without a database or a bundler.
 *
 * The caller supplies a `page` function rather than a query builder, so this
 * stays agnostic about the client:
 *
 *   const rows = await selectAllPaged<Row>((from, to) =>
 *     sb.from('bookings').select('...').order('id', { ascending: true }).range(from, to),
 *   );
 *
 * ORDER BY is the caller's job and it is not optional: `range()` is an OFFSET
 * window, so without a stable sort the pages can overlap or skip rows as
 * concurrent writes reshuffle the heap.
 */

export type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

export type PagedSelectOptions = {
  /** Rows per request. Must match the server's max-rows to detect the last page. */
  pageSize?: number;
  /** Prefix for the thrown error message, e.g. 'dedupe load'. */
  label?: string;
  /**
   * Refuse to keep paging past this many rows. A guard against an unstable
   * sort turning the loop into an infinite read, not a real limit: exceeding
   * it throws rather than silently returning a partial set, because silently
   * partial is the exact failure this helper exists to remove.
   */
  maxRows?: number;
};

export async function selectAllPaged<T>(
  // PromiseLike, not Promise: a PostgREST query builder is a thenable that
  // only actually issues the request when awaited, and it lacks catch/finally.
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  opts: PagedSelectOptions = {},
): Promise<T[]> {
  const pageSize = opts.pageSize ?? 1000;
  const label = opts.label ?? 'paged select';
  const maxRows = opts.maxRows ?? 500_000;

  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) out.push(row);
    // A short page is the only reliable end-of-table signal PostgREST gives.
    if (data.length < pageSize) break;
    if (out.length >= maxRows) {
      throw new Error(
        `${label}: exceeded ${maxRows} rows without reaching the end; check the ORDER BY is stable`,
      );
    }
  }
  return out;
}
