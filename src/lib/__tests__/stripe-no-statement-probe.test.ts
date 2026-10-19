import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { checkoutWindow, countPaidBookingsCheckingOut } from '../stripe-no-statement-probe.ts';

type Row = {
  property_id: string;
  status: string;
  check_out: string;
  total_paid: number | null;
  host_payout: number | null;
  owner_net_revenue_guesty: number | null;
};

/**
 * A head-count query builder that EVALUATES the filters it is given over
 * in-memory rows, so the test checks what the probe counts, not which
 * methods it happened to call. Supports exactly the PostgREST forms the
 * probe uses: eq, gte, lt, and an or() of `col.gt.N` / `col.is.null`.
 */
function fakeClient(rows: Row[], failWith?: string): SupabaseClient {
  const preds: Array<(r: Row) => boolean> = [];
  const val = (r: Row, col: string) => (r as Record<string, unknown>)[col];
  const builder = {
    select: () => builder,
    eq: (col: string, v: unknown) => { preds.push(r => val(r, col) === v); return builder; },
    gte: (col: string, v: string) => { preds.push(r => String(val(r, col)) >= v); return builder; },
    lt: (col: string, v: string) => { preds.push(r => String(val(r, col)) < v); return builder; },
    or: (expr: string) => {
      const terms = expr.split(',').map(t => {
        const [col, op, arg] = t.split('.');
        if (op === 'gt') return (r: Row) => val(r, col) != null && Number(val(r, col)) > Number(arg);
        if (op === 'is' && arg === 'null') return (r: Row) => val(r, col) == null;
        throw new Error(`fake does not support ${t}`);
      });
      preds.push(r => terms.some(f => f(r)));
      return builder;
    },
    then: (resolve: (v: { count: number | null; error: { message: string } | null }) => void) =>
      resolve(failWith
        ? { count: null, error: { message: failWith } }
        : { count: rows.filter(r => preds.every(p => p(r))).length, error: null }),
  };
  return { from: () => builder } as unknown as SupabaseClient;
}

const row = (over: Partial<Row>): Row => ({
  property_id: '4_brier_neck',
  status: 'confirmed',
  check_out: '2026-09-10',
  total_paid: null,
  host_payout: null,
  owner_net_revenue_guesty: null,
  ...over,
});

test('an offboarded home holding only an inquiry and a declined request has no paid bookings', async () => {
  // 4 Brier Neck, September 2026: the exact shape that kept the stripe feed
  // red for three weeks. Guesty quoted a price on both, so host_payout is
  // set, and total_paid is NULL on both because nobody ever paid.
  const rows = [
    row({ status: 'inquiry', host_payout: 3200 }),
    row({ status: 'declined', check_out: '2026-09-20', host_payout: 2900 }),
  ];
  const probe = await countPaidBookingsCheckingOut(fakeClient(rows), '4_brier_neck', '2026-09');
  assert.deepEqual(probe, { known: true, count: 0 });
});

test('a confirmed direct stay with total_paid NULL still counts as paid', async () => {
  // A staycapeann.com booking: Guesty never saw the money, so the gross sits
  // in host_payout. Missing its statement is a real missed ingest.
  const rows = [row({ property_id: '84_thatcher', host_payout: 4100 })];
  const probe = await countPaidBookingsCheckingOut(fakeClient(rows), '84_thatcher', '2026-09');
  assert.deepEqual(probe, { known: true, count: 1 });
});

test('a confirmed stay with a Guesty-collected total counts', async () => {
  const rows = [row({ total_paid: 5000 })];
  const probe = await countPaidBookingsCheckingOut(fakeClient(rows), '4_brier_neck', '2026-09');
  assert.deepEqual(probe, { known: true, count: 1 });
});

test('a homeowner stay (confirmed, zero in all three columns) is not a paid booking', async () => {
  const rows = [row({ total_paid: 0, host_payout: 0, owner_net_revenue_guesty: 0 })];
  const probe = await countPaidBookingsCheckingOut(fakeClient(rows), '4_brier_neck', '2026-09');
  assert.deepEqual(probe, { known: true, count: 0 });
});

test('only checkouts inside the month, at this property, are counted', async () => {
  const rows = [
    row({ total_paid: 1, check_out: '2026-08-31' }),
    row({ total_paid: 1, check_out: '2026-10-01' }),
    row({ total_paid: 1, property_id: '3_windward' }),
    row({ total_paid: 1, check_out: '2026-09-30' }),
  ];
  const probe = await countPaidBookingsCheckingOut(fakeClient(rows), '4_brier_neck', '2026-09');
  assert.deepEqual(probe, { known: true, count: 1 });
});

test('a failed read is unknown, never a confident zero', async () => {
  const probe = await countPaidBookingsCheckingOut(fakeClient([], 'connection reset'), '4_brier_neck', '2026-09');
  assert.deepEqual(probe, { known: false, error: 'connection reset' });
});

test('the checkout window rolls over December', () => {
  assert.deepEqual(checkoutWindow('2026-12'), { start: '2026-12-01', endExclusive: '2027-01-01' });
  assert.deepEqual(checkoutWindow('2026-09'), { start: '2026-09-01', endExclusive: '2026-10-01' });
});

test('/api/sync-stripe asks the probe, not its own NULL-counting query', () => {
  const src = readFileSync(new URL('../../app/api/sync-stripe/route.ts', import.meta.url), 'utf8');
  assert.match(src, /countPaidBookingsCheckingOut\(/);
  assert.doesNotMatch(src, /total_paid\.is\.null/, 'the status-blind NULL-counting predicate is back');
  assert.doesNotMatch(src, /from\('guesty_reservations'\)/, 'a second copy of the paid-booking question');
});
