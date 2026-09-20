import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actionSummaryFor,
  gapKeysFromActionSummary,
  isLive,
  readinessGaps,
  readinessSlip,
  type ReadinessSource,
} from '../launch-readiness.ts';

const complete: ReadinessSource = {
  id: '4_middle',
  name: '4 Middle Road',
  title: 'Stay at Bearskin Neck',
  tax_cert_id: 'C0584601999',
  bank_last4: '1226',
  management_fee_pct: '25',
  owner_emails: ['alexrosen2835@gmail.com'],
  activated_at: '2026-08-27',
  created_at: '2026-06-29T12:34:59Z',
  is_active: true,
  is_rising_tide_owned: false,
};
const opts = { stripeKeyed: true, knownStart: false };

test('a fully configured home has no gaps', () => {
  assert.deepEqual(readinessGaps(complete, opts), []);
});

test('each missing money-critical field is named once, in a stable order', () => {
  const gaps = readinessGaps(
    { ...complete, title: null, tax_cert_id: '  ', bank_last4: null, management_fee_pct: null, owner_emails: [''], activated_at: null },
    { stripeKeyed: false, knownStart: false },
  );
  assert.deepEqual(
    gaps.map((g) => g.key),
    ['title', 'tax_cert', 'bank_last4', 'fee', 'owner_email', 'stripe_key', 'activated_at'],
  );
  const stripe = gaps.find((g) => g.key === 'stripe_key')!;
  assert.match(stripe.label, /STRIPE_KEY_4_MIDDLE/);
  assert.match(stripe.fix, /Prices Write/);
});

test('4 Middle as found on 2026-09-19: title, tax cert, activation date', () => {
  const gaps = readinessGaps({ ...complete, title: null, tax_cert_id: null, activated_at: null }, opts);
  assert.deepEqual(gaps.map((g) => g.key), ['title', 'tax_cert', 'activated_at']);
});

test('a null activation date only matters for registry-era homes the roster does not know', () => {
  const nullStart = { ...complete, activated_at: null };
  assert.deepEqual(readinessGaps({ ...nullStart, created_at: '2025-11-02T00:00:00Z' }, opts), []);
  assert.deepEqual(readinessGaps(nullStart, { stripeKeyed: true, knownStart: true }), []);
  assert.deepEqual(readinessGaps(nullStart, opts).map((g) => g.key), ['activated_at']);
  assert.deepEqual(readinessGaps({ ...nullStart, created_at: null }, opts), []);
});

test('fee must be a positive number, in either column type', () => {
  assert.equal(readinessGaps({ ...complete, management_fee_pct: 22 }, opts).length, 0);
  assert.equal(readinessGaps({ ...complete, management_fee_pct: '0' }, opts)[0]?.key, 'fee');
  assert.equal(readinessGaps({ ...complete, management_fee_pct: 'abc' }, opts)[0]?.key, 'fee');
});

test('live means active, not Rising Tide owned, and earning', () => {
  assert.equal(isLive(complete, { upcoming: 10, recent: 0 }), true);
  assert.equal(isLive(complete, { upcoming: 0, recent: 1 }), true);
  assert.equal(isLive(complete, { upcoming: 0, recent: 0 }), false);
  assert.equal(isLive({ ...complete, is_rising_tide_owned: true }, { upcoming: 5, recent: 5 }), false);
  assert.equal(isLive({ ...complete, is_active: false }, { upcoming: 5, recent: 5 }), false);
});

test('the slip carries the gap keys in its action summary, round-trippable', () => {
  const gaps = readinessGaps({ ...complete, title: null, tax_cert_id: null }, opts);
  const slip = readinessSlip({ ...complete, title: null, tax_cert_id: null }, gaps);
  assert.equal(slip.requestKey, 'readiness:4_middle');
  assert.equal(slip.title, '4 Middle Road: Launch readiness, 2 money-critical fields missing');
  assert.equal(slip.actionSummary, 'Missing: title, tax_cert');
  assert.deepEqual([...gapKeysFromActionSummary(slip.actionSummary)], ['title', 'tax_cert']);
  assert.deepEqual([...gapKeysFromActionSummary('Fill the blanks')], []);
  assert.equal(actionSummaryFor([]), 'Missing: ');
  assert.match(slip.description, /closes itself once everything is present/);
});
