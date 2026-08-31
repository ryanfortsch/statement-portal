/**
 * Guesty reservation upsert dedupe - pure, no database, no network.
 *
 * Postgres rejects an INSERT .. ON CONFLICT DO UPDATE whose batch touches the
 * same conflict target twice, and it rejects the ENTIRE statement. The Guesty
 * list feed paginates with skip/limit over an unstable ordering, so the same
 * reservation can come back on two pages, and one such pair discards the whole
 * pull.
 *
 * That is not hypothetical: guesty-reservations failed 39 consecutive times
 * between 2026-08-25 and 2026-08-31 with "ON CONFLICT DO UPDATE command cannot
 * affect row a second time", freezing every booking-driven dashboard while
 * last_synced_at kept pointing at the last success.
 *
 * Run: node --experimental-strip-types scripts/guesty_reservation_dedupe_check.mjs
 */
import { dedupeByReservationId } from '../src/lib/guesty-reservation-dedupe.ts';

let failures = 0;
const fail = (m) => { failures++; console.log(`FAIL  ${m}`); };
const row = (id, extra = {}) => ({ guesty_reservation_id: id, property_id: 'p', ...extra });

// 1. The exact production shape: one reservation on two pages.
{
  const out = dedupeByReservationId([row('A'), row('B'), row('A', { total_paid: 900 })]);
  const ids = out.map((r) => r.guesty_reservation_id).sort();
  if (out.length !== 2) fail(`duplicate not collapsed: got ${out.length} rows, expected 2`);
  if (ids.join(',') !== 'A,B') fail(`wrong ids after dedupe: ${ids.join(',')}`);
  const a = out.find((r) => r.guesty_reservation_id === 'A');
  if (a?.total_paid !== 900) fail('last occurrence must win - the later page is the fresher read');
}

// 2. No duplicates: every row survives, and the batch is unchanged in size.
{
  const input = [row('A'), row('B'), row('C')];
  const out = dedupeByReservationId(input);
  if (out.length !== 3) fail(`clean batch changed size: ${out.length}`);
}

// 3. Rows with no conflict target cannot collide, so none may be dropped.
{
  const out = dedupeByReservationId([row(''), row(''), row('A')]);
  if (out.length !== 3) fail(`rows without an id must all survive: got ${out.length}, expected 3`);
}

// 4. Three copies of one reservation collapse to one.
{
  const out = dedupeByReservationId([row('X'), row('X'), row('X')]);
  if (out.length !== 1) fail(`three copies collapsed to ${out.length}, expected 1`);
}

// 5. Empty in, empty out.
if (dedupeByReservationId([]).length !== 0) fail('empty batch must stay empty');

// 6. The invariant the database actually enforces: no id appears twice.
{
  const out = dedupeByReservationId([row('A'), row('B'), row('A'), row('C'), row('B')]);
  const seen = out.map((r) => r.guesty_reservation_id).filter(Boolean);
  if (new Set(seen).size !== seen.length) fail('output still contains a duplicate conflict target');
}

console.log(failures === 0
  ? 'PASS - duplicate reservations collapse (last wins), clean batches are untouched, and no batch leaves with a repeated conflict target.'
  : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
