import test from 'node:test';
import assert from 'node:assert/strict';
import { matchCancellationPayout, type CancelledCandidate } from '../cancellation-payout-match.ts';

const dixon: CancelledCandidate = {
  code: 'HMSRJ5FRBT', guest_name: 'Catherine Dixon', check_in: '2026-10-14', check_out: '2026-10-18',
  host_payout: 775.29, recognized_on: null,
};
const dep = (amount: number, over: Partial<{ source: string; deposit_date: string }> = {}) =>
  ({ amount, source: 'airbnb', deposit_date: '2026-10-15', ...over });

test('Catherine Dixon: the October Airbnb deposit of $775.29 is recognized as her cancellation payout', () => {
  const m = matchCancellationPayout(dep(775.29), [dixon]);
  assert.ok(m);
  assert.equal(m.code, 'HMSRJ5FRBT');
  assert.equal(m.amount, 775.29);
  assert.equal(m.already_recognized_on, null);
  assert.match(m.label, /^Cancellation payout, retained under the Airbnb policy: Catherine Dixon/);
  assert.ok(m.label.length <= 80, 'the attribute route caps labels at 80 characters');
});

test('to the cent: a deposit a cent off is not her payout', () => {
  assert.equal(matchCancellationPayout(dep(775.28), [dixon]), null);
  assert.equal(matchCancellationPayout(dep(775.30), [dixon]), null);
  assert.ok(matchCancellationPayout(dep(775.294), [dixon]));
});

test('Airbnb deposits only: a Stripe or unknown deposit never matches a cancelled Airbnb stay', () => {
  assert.equal(matchCancellationPayout(dep(775.29, { source: 'stripe' }), [dixon]), null);
  assert.equal(matchCancellationPayout(dep(775.29, { source: 'other' }), [dixon]), null);
  assert.equal(matchCancellationPayout(dep(775.29, { source: null as unknown as string }), [dixon]), null);
});

test('two cancelled stays retaining the same amount is ambiguity, not a match', () => {
  const twin = { ...dixon, code: 'HMOTHER', guest_name: 'Someone Else', check_in: '2026-09-02', check_out: '2026-09-05' };
  assert.equal(matchCancellationPayout(dep(775.29), [dixon, twin]), null);
});

test('a candidate with no payout, or a payout that does not match, is ignored', () => {
  const none = { ...dixon, code: 'X', host_payout: null };
  const other = { ...dixon, code: 'Y', host_payout: 500 };
  assert.equal(matchCancellationPayout(dep(775.29), [none, other]), null);
  assert.ok(matchCancellationPayout(dep(775.29), [none, other, dixon]));
});

test('a stay from years away is not the same money', () => {
  const ancient = { ...dixon, check_in: '2024-01-01', check_out: '2024-01-05' };
  assert.equal(matchCancellationPayout(dep(775.29), [ancient]), null);
});

test('already on a statement: the label says do NOT attribute again, and the code is still suggested', () => {
  const carried = { ...dixon, recognized_on: '2026-08' };
  const m = matchCancellationPayout(dep(775.29), [carried]);
  assert.ok(m);
  assert.equal(m.already_recognized_on, '2026-08');
  assert.match(m.label, /^ALREADY on 2026-08 statement/);
  assert.match(m.label, /do not attribute/);
  assert.ok(m.label.length <= 80);
});

test('a zero or negative deposit never matches', () => {
  assert.equal(matchCancellationPayout(dep(0), [{ ...dixon, host_payout: 0 }]), null);
  assert.equal(matchCancellationPayout(dep(-775.29), [dixon]), null);
});

test('a very long guest name truncates the name, never the instruction', () => {
  const longName = { ...dixon, guest_name: 'Maximiliana Wilhelmina Featherstonehaugh-Cholmondeley of Gloucester', recognized_on: '2026-08' };
  const m = matchCancellationPayout(dep(775.29), [longName])!;
  assert.ok(m.label.length <= 80);
  assert.match(m.label, /^ALREADY on 2026-08 statement, do not attribute: /);
});

test('an amount that a recognized stay on the property already carries is never suggested: it is that row\'s own money', () => {
  // Live data 2026-09-06: three cancelled Airbnb bookings retained exactly
  // what a recognized stay on the same property earned, and each was the
  // same stay (same code, guest, dates) carried in full on a sent
  // statement. That deposit is the row's own payout; suggesting the
  // cancelled booking would pay it twice.
  assert.equal(matchCancellationPayout(dep(775.29), [dixon], [1250, 775.29, 900]), null);
  assert.ok(matchCancellationPayout(dep(775.29), [dixon], [1250, 775.31, 900]), 'a cent apart is a different stay');
  assert.ok(matchCancellationPayout(dep(775.29), [dixon], []), 'no recognized amounts, no exclusion');
});
