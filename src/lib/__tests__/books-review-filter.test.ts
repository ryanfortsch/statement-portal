import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_BOOKS_FILTER,
  applyBooksFilter,
  booksFilterQuery,
  containsPattern,
  parseBooksFilter,
  quarterBounds,
  quarterOf,
  quarterOptions,
} from '../books-review-filter.ts';

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

test('the review table opens on unreviewed rows, every date, no search', () => {
  assert.deepEqual(parseBooksFilter({}), DEFAULT_BOOKS_FILTER);
  assert.equal(DEFAULT_BOOKS_FILTER.unreviewedOnly, true);
  assert.equal(booksFilterQuery(DEFAULT_BOOKS_FILTER), '');
});

test('the filter round-trips through the link and ignores junk', () => {
  const f = parseBooksFilter({ all: '1', quarter: '2026-Q3', q: '  Amazon  ' });
  assert.deepEqual(f, { unreviewedOnly: false, quarter: '2026-Q3', q: 'Amazon' });
  assert.equal(booksFilterQuery(f), '?all=1&quarter=2026-Q3&q=Amazon');
  assert.deepEqual(parseBooksFilter({ quarter: '2026-Q5', all: 'yes' }), DEFAULT_BOOKS_FILTER);
});

test('quarter bounds match books.ts quarterRange', () => {
  assert.deepEqual(quarterBounds('2026-Q4'), { start: '2026-10-01', endExclusive: '2027-01-01' });
  assert.deepEqual(quarterBounds('2026-Q1'), { start: '2026-01-01', endExclusive: '2026-04-01' });
  assert.equal(quarterBounds('2026-13'), null);
  const books = read('src/lib/books.ts');
  assert.ok(books.includes('export function quarterRange(period: string)'), 'books.ts keeps the quarter rule this mirrors');
  assert.equal(quarterOf('2026-09-30'), '2026-Q3');
  assert.equal(quarterOf('2026-10-01'), '2026-Q4');
});

test('the picker lists every quarter on file, newest first', () => {
  assert.deepEqual(quarterOptions({ min: '2025-11-03', max: '2026-08-14' }), ['2026-Q3', '2026-Q2', '2026-Q1', '2025-Q4']);
  assert.deepEqual(quarterOptions({ min: '2026-02-01', max: '2026-03-01' }), ['2026-Q1']);
  assert.deepEqual(quarterOptions(null), []);
});

test('search matches the text literally, wildcards included', () => {
  assert.equal(containsPattern('amazon'), '%amazon%');
  assert.equal(containsPattern('50%_off\\'), '%50\\%\\_off\\\\%');
});

test('the filter narrows a query the same way for the page and the batch routes', () => {
  const calls: string[] = [];
  const qb = {
    eq(c: string, v: unknown) { calls.push(`eq ${c} ${v}`); return qb; },
    gte(c: string, v: unknown) { calls.push(`gte ${c} ${v}`); return qb; },
    lt(c: string, v: unknown) { calls.push(`lt ${c} ${v}`); return qb; },
    ilike(c: string, p: string) { calls.push(`ilike ${c} ${p}`); return qb; },
  };
  applyBooksFilter(qb, { unreviewedOnly: true, quarter: '2026-Q3', q: 'gusto' });
  assert.deepEqual(calls, ['eq reviewed false', 'gte txn_date 2026-07-01', 'lt txn_date 2026-10-01', 'ilike description %gusto%']);
  calls.length = 0;
  applyBooksFilter(qb, { unreviewedOnly: false, quarter: null, q: '' });
  assert.deepEqual(calls, []);

  const page = read('src/app/books/[entity_id]/page.tsx');
  const categorize = read('src/app/api/books/categorize/route.ts');
  const review = read('src/app/api/books/review/route.ts');
  for (const [name, src] of [['page', page], ['categorize', categorize], ['review', review]] as const) {
    assert.ok(src.includes('applyBooksFilter('), `${name} narrows by the shared filter`);
  }
});

test('Books never counts with a bare select, and accepting high confidence pages past 1000', () => {
  const page = read('src/app/books/[entity_id]/page.tsx');
  assert.ok(page.includes("count: 'exact', head: true"), 'counts are count queries');
  assert.ok(!/\.select\('reviewed, category_key, ai_category_key, ai_confidence, txn_date'\)/.test(page), 'the old row-dump summary is gone');
  const review = read('src/app/api/books/review/route.ts');
  assert.ok(review.includes('selectAllPaged'), 'accept_high_confidence reads every candidate');
  assert.ok(!review.includes('.limit(1000)'));
});

test('a row can be accepted as the AI proposed it, and undone', () => {
  const section = read('src/app/books/[entity_id]/BooksReviewSection.tsx');
  assert.ok(section.includes("JSON.stringify({ action: 'confirm', transaction_id: id })"), 'Confirm sends no key, so the API takes the AI pick');
  assert.ok(/>\s*Confirm\s*</.test(section), 'the button says Confirm');
  assert.ok(/>\s*Undo\s*</.test(section), 'and the undo control says Undo');
  assert.ok(!section.includes('✓ reviewed'), 'the undo control says Undo, not a status');
});
