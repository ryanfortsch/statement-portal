import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCancelledStay, cancelledStayGap } from '../cancelled-stay.ts';

const AIR = 'Airbnb';

test('nothing retained (a live $0): the row is a phantom and the flag says remove it', () => {
  const v = classifyCancelledStay({ statementAmount: 775.29, retained: 0, platform: AIR });
  assert.equal(v.kind, 'never_paid');
  const g = cancelledStayGap(v, 'Sarah Strickland', 'HMX')!;
  assert.equal(g.gap_type, 'cancelled_reservation');
  assert.equal(g.severity, 'critical');
  assert.match(g.description, /reports \$0\.00 retained/);
  assert.match(g.description, /Remove it/);
  assert.equal(g.expected_data, 'reservation:HMX');
});

test('Catherine Dixon: the policy retained $775.29 and the statement carries it, so nothing is filed', () => {
  const v = classifyCancelledStay({ statementAmount: 775.29, retained: 775.29, platform: AIR });
  assert.equal(v.kind, 'retained_matches');
  assert.equal(cancelledStayGap(v, 'Catherine Dixon', 'HMSRJ5FRBT'), null);
});

test('retained but the statement carries a different amount: correct the amount, never remove', () => {
  const v = classifyCancelledStay({ statementAmount: 1550.57, retained: 775.29, platform: AIR });
  assert.equal(v.kind, 'retained_differs');
  if (v.kind === 'retained_differs') assert.equal(v.delta, 775.28);
  const g = cancelledStayGap(v, 'Catherine Dixon', 'HMSRJ5FRBT')!;
  assert.equal(g.severity, 'warning');
  assert.match(g.description, /do NOT remove/);
  assert.match(g.description, /\$775\.29/);
  assert.match(g.description, /\$1550\.57/);
});

test('no live figure is UNKNOWN and loud: a stale cache must never turn a phantom into "retained, matches"', () => {
  // The leak the guard exists for: cancelled after the nightly sync, the
  // cached payout is the pre-cancel figure and equals the statement line.
  // Fed that, a classifier would go quiet on a full-refund cancel.
  for (const retained of [null, undefined, NaN]) {
    const v = classifyCancelledStay({ statementAmount: 795.14, retained, platform: AIR });
    assert.equal(v.kind, 'retained_unknown');
    const g = cancelledStayGap(v, 'Gagnon', 'HMG')!;
    assert.equal(g.severity, 'critical');
    assert.match(g.description, /could not read what the cancellation policy retained/);
    assert.match(g.description, /Do NOT remove/);
    assert.equal(g.expected_data, 'reservation:HMG retained:unknown');
  }
});

test('Booking.com is unknown by basis: its payout figure is tax-inclusive and does not compare to the PDF line', () => {
  const v = classifyCancelledStay({ statementAmount: 500, retained: 558.5, platform: 'Booking.com' });
  assert.equal(v.kind, 'retained_unknown');
  if (v.kind === 'retained_unknown') assert.equal(v.reason, 'channel_basis');
  const g = cancelledStayGap(v, 'B', 'BC-1')!;
  assert.equal(g.severity, 'critical');
  assert.match(g.description, /Booking\.com/);
  assert.match(g.description, /check the folio/);
});

test('the match is to the cent', () => {
  assert.equal(classifyCancelledStay({ statementAmount: 775.29, retained: 775.294, platform: AIR }).kind, 'retained_matches');
  assert.equal(classifyCancelledStay({ statementAmount: 775.29, retained: 775.30, platform: AIR }).kind, 'retained_differs');
});

test('the bank-match caveat rides along on every filed verdict', () => {
  const note = ' It carries a matched bank match.';
  for (const v of [
    classifyCancelledStay({ statementAmount: 1, retained: 0, platform: AIR }),
    classifyCancelledStay({ statementAmount: 1, retained: 2, platform: AIR }),
    classifyCancelledStay({ statementAmount: 1, retained: null, platform: AIR }),
  ]) assert.match(cancelledStayGap(v, 'G', 'C', note)!.description, /matched bank match\.$/);
});
