import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCancelledStay, cancelledStayGap } from '../cancelled-stay.ts';

test('nothing retained: the row is a phantom and the flag says remove it', () => {
  const v = classifyCancelledStay({ statementAmount: 775.29, retained: 0 });
  assert.equal(v.kind, 'never_paid');
  const g = cancelledStayGap(v, 'Sarah Strickland', 'HMX')!;
  assert.equal(g.gap_type, 'cancelled_reservation');
  assert.equal(g.severity, 'critical');
  assert.match(g.description, /Remove it/);
  assert.equal(g.expected_data, 'reservation:HMX');
});

test('Catherine Dixon: the policy retained $775.29 and the statement carries it, so nothing is removed', () => {
  const v = classifyCancelledStay({ statementAmount: 775.29, retained: 775.29 });
  assert.equal(v.kind, 'retained_matches');
  // Nothing to do, so no flag at all: a standing "correct" notice would be
  // re-filed by every ingest and, offering no action, would block the close.
  assert.equal(cancelledStayGap(v, 'Catherine Dixon', 'HMSRJ5FRBT'), null);
});

test('retained but the statement carries a different amount: correct the amount, never remove', () => {
  const v = classifyCancelledStay({ statementAmount: 1550.57, retained: 775.29 });
  assert.equal(v.kind, 'retained_differs');
  if (v.kind === 'retained_differs') assert.equal(v.delta, 775.28);
  const g = cancelledStayGap(v, 'Catherine Dixon', 'HMSRJ5FRBT')!;
  assert.equal(g.severity, 'warning');
  assert.match(g.description, /Do NOT remove/);
  assert.match(g.description, /\$775\.29/);
  assert.match(g.description, /\$1550\.57/);
});

test('a null or unknown retained figure is treated as nothing retained, which flags rather than hides', () => {
  assert.equal(classifyCancelledStay({ statementAmount: 500, retained: null }).kind, 'never_paid');
  assert.equal(classifyCancelledStay({ statementAmount: 500, retained: undefined }).kind, 'never_paid');
});

test('the match is to the cent', () => {
  assert.equal(classifyCancelledStay({ statementAmount: 775.29, retained: 775.294 }).kind, 'retained_matches');
  assert.equal(classifyCancelledStay({ statementAmount: 775.29, retained: 775.30 }).kind, 'retained_differs');
});

test('the bank-match caveat rides along on every verdict', () => {
  const note = ' It carries a matched bank match.';
  for (const v of [
    classifyCancelledStay({ statementAmount: 1, retained: 0 }),
    classifyCancelledStay({ statementAmount: 1, retained: 2 }),
  ]) assert.match(cancelledStayGap(v, 'G', 'C', note)!.description, /matched bank match\.$/);
});
