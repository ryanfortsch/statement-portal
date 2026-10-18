'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { booksFilterQuery, type BooksFilter } from '@/lib/books-review-filter';

/**
 * The review table's filter: unreviewed only (on by default), a quarter
 * and a description search. Each lives in the link, so the server renders
 * the matching rows and the batch buttons act on exactly those.
 */
export function BooksFilterBar({
  filter,
  quarters,
  matching,
}: {
  filter: BooksFilter;
  /** Quarters on file, newest first. */
  quarters: string[];
  /** Rows matching the filter. */
  matching: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(filter.q);

  function go(next: BooksFilter) {
    router.replace(`${pathname}${booksFilterQuery(next)}`, { scroll: false });
  }

  return (
    <div className="flex items-center flex-wrap" style={{ gap: '10px 18px', marginBottom: 12, fontSize: 12, color: 'var(--ink-2)' }}>
      <label className="flex items-center" style={{ gap: 6, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={filter.unreviewedOnly}
          onChange={(e) => go({ ...filter, unreviewedOnly: e.target.checked })}
        />
        Unreviewed only
      </label>
      <label className="flex items-center" style={{ gap: 6 }}>
        Quarter
        <select
          value={filter.quarter ?? ''}
          onChange={(e) => go({ ...filter, quarter: e.target.value || null })}
          style={{ background: 'transparent', border: '1px solid var(--rule)', fontSize: 12, padding: '3px 6px', color: 'var(--ink)' }}
        >
          <option value="">All dates</option>
          {filter.quarter && !quarters.includes(filter.quarter) && <option value={filter.quarter}>{filter.quarter}</option>}
          {quarters.map((qq) => (
            <option key={qq} value={qq}>{qq}</option>
          ))}
        </select>
      </label>
      <form
        role="search"
        className="flex items-center"
        style={{ gap: 6, flex: '1 1 220px', maxWidth: 360 }}
        onSubmit={(e) => {
          e.preventDefault();
          go({ ...filter, q: q.trim() });
        }}
      >
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search descriptions"
          aria-label="Search descriptions"
          style={{ flex: 1, minWidth: 0, background: 'transparent', border: '1px solid var(--rule)', fontSize: 12, padding: '4px 8px', color: 'var(--ink)' }}
        />
        <button type="submit" style={{ background: 'transparent', border: '1px solid var(--ink)', fontSize: 11, padding: '4px 10px', cursor: 'pointer', color: 'var(--ink)' }}>
          Search
        </button>
        {filter.q && (
          <button
            type="button"
            onClick={() => { setQ(''); go({ ...filter, q: '' }); }}
            style={{ background: 'transparent', border: 'none', fontSize: 11, color: 'var(--ink-3)', cursor: 'pointer', textDecoration: 'underline' }}
          >
            Clear
          </button>
        )}
      </form>
      <span style={{ marginLeft: 'auto', color: 'var(--ink-4)' }}>{matching} matching</span>
    </div>
  );
}
