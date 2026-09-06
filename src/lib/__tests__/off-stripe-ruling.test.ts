import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOffStripeRulings,
  isRtStripeChannel,
  OFF_STRIPE_STATUS,
  type OffStripeRow,
} from '../off-stripe-ruling.ts';

const row = (over: Partial<OffStripeRow> = {}): OffStripeRow => ({
  confirmation_code: 'GY-2p8ZgNK8',
  platform: 'Manual',
  stripe_fee: 192.96,
  adjusted_revenue: 4107.04,
  bank_match_status: 'unmatched',
  ...over,
});

test('the ruling zeroes the fee and rolls it into revenue, on THIS run\'s numbers', () => {
  const r = row();
  const out = applyOffStripeRulings([r], new Set(['GY-2p8ZgNK8']));
  assert.equal(r.stripe_fee, 0);
  assert.equal(r.adjusted_revenue, 4300.00);
  assert.equal(r.bank_match_status, OFF_STRIPE_STATUS);
  assert.equal(out.reclaimed, 192.96);
  assert.deepEqual(out.applied, [{ code: 'GY-2p8ZgNK8', guest: 'Guest', reclaimed: 192.96 }]);
});

test('a corrected PDF still takes effect: the ruling rides the new figures, not the old ones', () => {
  // The stay re-ingests at a different gross. Restoring the absolute
  // values the operator saw would freeze the stay at that day's numbers.
  const r = row({ stripe_fee: 250.00, adjusted_revenue: 5750.00 });
  applyOffStripeRulings([r], new Set(['GY-2p8ZgNK8']));
  assert.equal(r.adjusted_revenue, 6000.00);
  assert.equal(r.stripe_fee, 0);
});

test('a row untouched by any ruling is left exactly as it was', () => {
  const r = row({ confirmation_code: 'GY-other' });
  const out = applyOffStripeRulings([r], new Set(['GY-2p8ZgNK8']));
  assert.equal(r.stripe_fee, 192.96);
  assert.equal(r.adjusted_revenue, 4107.04);
  assert.equal(r.bank_match_status, 'unmatched');
  assert.equal(out.reclaimed, 0);
});

test('a ruled row whose fee is already zero still gets the marker, so the ruling survives the NEXT rebuild', () => {
  const r = row({ stripe_fee: 0, adjusted_revenue: 4300.00 });
  const out = applyOffStripeRulings([r], new Set(['GY-2p8ZgNK8']));
  assert.equal(r.bank_match_status, OFF_STRIPE_STATUS);
  assert.equal(r.adjusted_revenue, 4300.00, 'nothing is double-credited');
  assert.equal(out.reclaimed, 0);
});

test('re-applying twice never double-credits', () => {
  const r = row();
  const ruled = new Set(['GY-2p8ZgNK8']);
  applyOffStripeRulings([r], ruled);
  const second = applyOffStripeRulings([r], ruled);
  assert.equal(r.adjusted_revenue, 4300.00);
  assert.equal(second.reclaimed, 0);
});

test('the ruling never applies to a channel that has no RT Stripe fee', () => {
  // Mirrors resolve-gap's own guard. An Airbnb payout is already net of
  // Airbnb's fees, so reclaiming one would invent revenue.
  for (const platform of ['Airbnb', 'Booking.com']) {
    const r = row({ platform, stripe_fee: 100, adjusted_revenue: 900 });
    const out = applyOffStripeRulings([r], new Set(['GY-2p8ZgNK8']));
    assert.equal(r.adjusted_revenue, 900, `${platform} revenue must not move`);
    assert.equal(r.stripe_fee, 100);
    assert.equal(r.bank_match_status, 'unmatched');
    assert.deepEqual(out.skippedNonStripe, ['GY-2p8ZgNK8']);
  }
});

test('the RT-Stripe channel test matches resolve-gap: HomeAway, VRBO and Manual only', () => {
  for (const p of ['HomeAway', 'HOMEAWAY.COM', 'VRBO', 'Manual', 'manual']) {
    assert.equal(isRtStripeChannel(p), true, p);
  }
  for (const p of ['Airbnb', 'Booking.com', '', null, undefined]) {
    assert.equal(isRtStripeChannel(p), false, String(p));
  }
});

test('reclaimed sums across rows so the caller can correct its running totals', () => {
  const a = row({ confirmation_code: 'A', stripe_fee: 192.96, adjusted_revenue: 4107.04 });
  const b = row({ confirmation_code: 'B', platform: 'HomeAway', stripe_fee: 520.78, adjusted_revenue: 10823.17 });
  const c = row({ confirmation_code: 'C', stripe_fee: 50, adjusted_revenue: 950 });
  const out = applyOffStripeRulings([a, b, c], new Set(['A', 'B']));
  assert.equal(out.reclaimed, 713.74);
  assert.equal(c.stripe_fee, 50, 'unruled row untouched');
});

test('an installment slice keeps the ruling: its prorated fee is zeroed too', () => {
  // A wired stay has no Stripe fee on ANY of its month slices.
  const slice = row({ stripe_fee: 64.32, adjusted_revenue: 1369.01, bank_match_status: 'installment_no_bank_event' });
  applyOffStripeRulings([slice], new Set(['GY-2p8ZgNK8']));
  assert.equal(slice.stripe_fee, 0);
  assert.equal(slice.adjusted_revenue, 1433.33);
  assert.equal(slice.bank_match_status, OFF_STRIPE_STATUS);
});

test('the outcome names each stay and what its ruling suppressed, so the operator can see it', () => {
  const a = row({ confirmation_code: 'A', guest_name: 'Barry Allen', stripe_fee: 192.96, adjusted_revenue: 4107.04 });
  const b = row({ confirmation_code: 'B', guest_name: 'Evan Friese', platform: 'HomeAway', stripe_fee: 0, adjusted_revenue: 11343.95 });
  const out = applyOffStripeRulings([a, b], new Set(['A', 'B']));
  assert.deepEqual(out.applied, [
    { code: 'A', guest: 'Barry Allen', reclaimed: 192.96 },
    { code: 'B', guest: 'Evan Friese', reclaimed: 0 },
  ]);
});
