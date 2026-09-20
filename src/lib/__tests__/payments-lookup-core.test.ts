import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dayEndEpoch,
  dayStartEpoch,
  matchesFilters,
  normalizeCharge,
  resolveWindow,
  type PaymentRow,
} from '../payments-lookup-core.ts';

const charge = (over: Record<string, unknown> = {}) => ({
  id: 'ch_1',
  payment_intent: 'pi_1',
  amount: 250000,
  amount_refunded: 0,
  currency: 'usd',
  status: 'succeeded',
  paid: true,
  created: 1789000000,
  description: 'Stay at Example Beach - 2027-07-01 to 2027-07-15',
  receipt_email: null,
  receipt_url: 'https://receipt',
  billing_details: { email: 'guest@example.com', name: 'Test Guest' },
  payment_method_details: { card: { last4: '4242' } },
  ...over,
});

test('normalizeCharge reports dollars, payer and settlement', () => {
  const r = normalizeCharge('84_thatcher', charge());
  assert.equal(r.property_id, '84_thatcher');
  assert.equal(r.amount, 2500);
  assert.equal(r.refunded, 0);
  assert.equal(r.paid, true);
  assert.equal(r.email, 'guest@example.com');
  assert.equal(r.name, 'Test Guest');
  assert.equal(r.last4, '4242');
  assert.equal(r.currency, 'USD');
  assert.match(r.created, /^2026-/);
});

test('a fully refunded charge is not money we hold', () => {
  const r = normalizeCharge('84_thatcher', charge({ amount_refunded: 250000 }));
  assert.equal(r.paid, false, 'a full refund must not read as paid');
  assert.equal(r.refunded, 2500);
});

test('a partial refund is still a payment', () => {
  const r = normalizeCharge('84_thatcher', charge({ amount_refunded: 100000 }));
  assert.equal(r.paid, true);
  assert.equal(r.refunded, 1000);
});

test('an unsettled charge is never paid', () => {
  assert.equal(normalizeCharge('x', charge({ status: 'failed', paid: false })).paid, false);
  assert.equal(normalizeCharge('x', charge({ paid: false })).paid, false);
});

test('receipt_email is used when billing_details has none', () => {
  const r = normalizeCharge('x', charge({ billing_details: {}, receipt_email: 'a@b.com' }));
  assert.equal(r.email, 'a@b.com');
});

test('a charge missing every optional field does not throw', () => {
  const r = normalizeCharge('x', { id: 'ch_2' });
  assert.equal(r.amount, 0);
  assert.equal(r.email, '');
  assert.equal(r.last4, '');
  assert.equal(r.receipt_url, null);
  assert.equal(r.paid, false);
});

const row = (over: Partial<PaymentRow> = {}): PaymentRow => ({
  ...normalizeCharge('84_thatcher', charge()),
  ...over,
});

test('unsuccessful charges are hidden unless asked for', () => {
  const failed = row({ paid: false });
  assert.equal(matchesFilters(failed, {}), false);
  assert.equal(matchesFilters(failed, { includeUnsuccessful: true }), true);
});

test('email match is exact and case-insensitive', () => {
  assert.equal(matchesFilters(row(), { email: 'GUEST@EXAMPLE.COM' }), true);
  assert.equal(matchesFilters(row(), { email: 'guest@example.com ' }), true);
  // Substring must NOT match: a near-miss address is a different guest.
  assert.equal(matchesFilters(row(), { email: 'uest@example.com' }), false);
});

test('text search spans description, name and email', () => {
  assert.equal(matchesFilters(row(), { text: 'example beach' }), true);
  assert.equal(matchesFilters(row(), { text: 'Test Guest' }), true);
  assert.equal(matchesFilters(row(), { text: 'example.com' }), true);
  assert.equal(matchesFilters(row(), { text: 'windward' }), false);
});

test('filters combine', () => {
  assert.equal(matchesFilters(row(), { email: 'guest@example.com', text: 'windward' }), false);
});

test('resolveWindow defaults to 400 days back from today', () => {
  assert.deepEqual(resolveWindow(undefined, undefined, '2026-09-20'), {
    from: '2025-08-16',
    to: '2026-09-20',
  });
});

test('resolveWindow honours an explicit window', () => {
  assert.deepEqual(resolveWindow('2026-01-01', '2026-06-30', '2026-09-20'), {
    from: '2026-01-01',
    to: '2026-06-30',
  });
});

test('resolveWindow ignores a malformed or inverted range instead of narrowing silently', () => {
  assert.equal(resolveWindow('nonsense', undefined, '2026-09-20').from, '2025-08-16');
  // from after to would return nothing; fall back to the default span.
  assert.equal(resolveWindow('2026-09-19', '2026-01-01', '2026-09-20').from, '2024-11-27');
});

test('day bounds run on Cape Ann time, not UTC', () => {
  // Bounding in UTC dropped every payment after 8pm Eastern on the last day
  // of a range, and printed evening payments under tomorrow's date.
  assert.equal(dayStartEpoch('2026-09-20'), Date.parse('2026-09-20T04:00:00Z') / 1000, 'EDT is UTC-4');
  assert.equal(dayEndEpoch('2026-09-20'), Date.parse('2026-09-21T03:59:59Z') / 1000);
  assert.equal(dayEndEpoch('2026-09-20') - dayStartEpoch('2026-09-20'), 86399);
});

test('day bounds follow daylight saving', () => {
  // January is EST (UTC-5), July is EDT (UTC-4).
  assert.equal(dayStartEpoch('2027-01-15'), Date.parse('2027-01-15T05:00:00Z') / 1000);
  assert.equal(dayStartEpoch('2027-07-15'), Date.parse('2027-07-15T04:00:00Z') / 1000);
});

test('an 8:30pm Eastern payment is inside its own day', () => {
  const paidAt = Date.parse('2026-09-21T00:30:00Z') / 1000; // 8:30pm ET on the 20th
  assert.ok(paidAt <= dayEndEpoch('2026-09-20'), 'must fall inside Sep 20, not spill into Sep 21');
  assert.ok(paidAt >= dayStartEpoch('2026-09-20'));
});

test('an authorization hold is not money we hold', () => {
  const r = normalizeCharge('x', charge({ captured: false }));
  assert.equal(r.paid, false);
  assert.equal(r.captured, false);
  assert.match(r.not_paid_reason, /never captured/);
});

test('a charged-back payment is not money we hold', () => {
  const r = normalizeCharge('x', charge({ disputed: true }));
  assert.equal(r.paid, false);
  assert.equal(r.disputed, true);
  assert.match(r.not_paid_reason, /charged back/);
});

test('a settled, captured, undisputed charge is paid and gives no reason', () => {
  const r = normalizeCharge('x', charge({ captured: true }));
  assert.equal(r.paid, true);
  assert.equal(r.not_paid_reason, '');
});

test('a charge shape with no captured field still counts as captured', () => {
  // Older charge objects omit it; only an explicit false means uncaptured.
  const r = normalizeCharge('x', charge());
  assert.equal(r.captured, true);
  assert.equal(r.paid, true);
});

test('a full refund names itself', () => {
  assert.match(normalizeCharge('x', charge({ amount_refunded: 250000 })).not_paid_reason, /refunded in full/);
});
