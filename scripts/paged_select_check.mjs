#!/usr/bin/env node
/**
 * selectAllPaged boundary check.
 *
 * Exercises the REAL shipped helper (src/lib/paged-select.ts) via Node's
 * native TypeScript stripping. No database, no bundler, no network.
 *
 * This guards the fix in dedupeAllBookings (src/lib/ical-sync.ts): that
 * function used a bare .select(), which PostgREST silently caps at 1000 rows,
 * and it is destructive on a short read -- a row whose cluster twin fell
 * outside the slice looked like a singleton and had its correct duplicate_of
 * cleared. The paging loop is now the thing standing between a correct dedupe
 * and silent data loss, so its edge cases are worth pinning down.
 *
 * The cases that matter are the page boundaries: an exact multiple of the page
 * size must not terminate early or loop forever, and a table one row over a
 * boundary must not drop that row.
 *
 * Run: node --no-warnings=MODULE_TYPELESS_PACKAGE_JSON scripts/paged_select_check.mjs
 *
 * (The flag only silences Node's note that package.json has no "type": "module".
 * Plain `node scripts/paged_select_check.mjs` works and passes just the same.)
 */

import { selectAllPaged } from '../src/lib/paged-select.ts';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}: got ${actual}, expected ${expected}`);
};

/** A fake PostgREST table that honours .range() and caps every page at pageSize. */
function fakeTable(rowCount, pageSize = 1000) {
  const rows = Array.from({ length: rowCount }, (_, i) => ({ id: i }));
  let requests = 0;
  const page = (from, to) => {
    requests++;
    // PostgREST returns at most pageSize even if the range asks for more.
    const slice = rows.slice(from, Math.min(to + 1, from + pageSize));
    return Promise.resolve({ data: slice, error: null });
  };
  return { page, requests: () => requests };
}

console.log('\n=== row counts around the 1000-row page boundary ===\n');
for (const n of [0, 1, 999, 1000, 1001, 1999, 2000, 2001, 5000]) {
  const t = fakeTable(n);
  const got = await selectAllPaged(t.page);
  check(`${String(n).padStart(4)} rows`, got.length, n);
  // Every id must be present exactly once and in order.
  const intact = got.every((r, i) => r.id === i);
  if (!intact) { failures++; console.log(`  FAIL  ${n} rows: ordering or contents corrupted`); }
}

console.log('\n=== a page-size multiple costs one extra empty request, and terminates ===\n');
{
  const t = fakeTable(2000);
  const got = await selectAllPaged(t.page);
  check('2000 rows length', got.length, 2000);
  check('2000 rows requests', t.requests(), 3); // 1000, 1000, then an empty page
}
{
  const t = fakeTable(1500);
  const got = await selectAllPaged(t.page);
  check('1500 rows length', got.length, 1500);
  check('1500 rows requests', t.requests(), 2); // second page is short, stop
}

console.log('\n=== custom page size ===\n');
{
  const t = fakeTable(250, 100);
  const got = await selectAllPaged(t.page, { pageSize: 100 });
  check('250 rows @ pageSize 100', got.length, 250);
}

console.log('\n=== errors propagate with the label, they do not return partial data ===\n');
{
  let threw = null;
  try {
    await selectAllPaged(
      (from) =>
        Promise.resolve(
          from === 0
            ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null }
            : { data: null, error: { message: 'connection reset' } },
        ),
      { label: 'dedupe load' },
    );
  } catch (e) { threw = e.message; }
  check('throws on a mid-read error', threw, 'dedupe load: connection reset');
}

console.log('\n=== an unstable sort cannot spin forever ===\n');
{
  // A page function that always returns a full page: without the maxRows
  // backstop this loops until the process dies.
  let threw = null;
  try {
    await selectAllPaged(
      () => Promise.resolve({ data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null }),
      { label: 'runaway', maxRows: 5000 },
    );
  } catch (e) { threw = e.message; }
  check(
    'throws rather than looping',
    threw !== null && threw.startsWith('runaway: exceeded 5000 rows'),
    true,
  );
}

console.log(`\n${'='.repeat(58)}`);
if (failures === 0) {
  console.log('ALL PAGING CHECKS PASS. No row is dropped at any page boundary.');
  process.exit(0);
} else {
  console.log(`${failures} CHECK(S) FAILED.`);
  process.exit(1);
}
