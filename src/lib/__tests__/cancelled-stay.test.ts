import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCancelledStay, cancelledStayGap } from '../cancelled-stay.ts';

const AIR = 'Airbnb';
const c = (over: Partial<Parameters<typeof classifyCancelledStay>[0]>) =>
  classifyCancelledStay({ statementAmount: 775.29, retained: 775.29, platform: AIR, bankMatched: true, ...over });

test('a live $0 is a phantom on EVERY channel: remove it', () => {
  for (const platform of [AIR, 'Booking.com', 'HomeAway', 'Manual', 'Unknown']) {
    const v = c({ retained: 0, platform });
    assert.equal(v.kind, 'never_paid', platform);
    const g = cancelledStayGap(v, 'Sarah Strickland', 'HMX')!;
    assert.equal(g.gap_type, 'cancelled_reservation');
    assert.equal(g.severity, 'critical');
    assert.match(g.description, /reports \$0\.00 retained/);
    assert.equal(g.expected_data, 'reservation:HMX', 'the Remove button reads the bare code');
  }
});

test('Catherine Dixon, payout received: statement carries the retained amount and the bank has it, so nothing is filed', () => {
  const v = c({ bankMatched: true });
  assert.equal(v.kind, 'retained_matches');
  assert.equal(cancelledStayGap(v, 'Catherine Dixon', 'HMSRJ5FRBT'), null);
});

test('Catherine Dixon, payout NOT received: retained is not received, so it is loud', () => {
  // On Sept 6 Airbnb showed "you earn $775.29" and the bank had nothing:
  // Airbnb releases a cancellation payout after the original check-in.
  const v = c({ bankMatched: false });
  assert.equal(v.kind, 'retained_unreceived');
  const g = cancelledStayGap(v, 'Catherine Dixon', 'HMSRJ5FRBT')!;
  assert.equal(g.gap_type, 'cancelled_reservation_retained');
  assert.equal(g.severity, 'warning');
  assert.match(g.description, /NOT reached the bank/);
  assert.match(g.description, /paid again/);
});

test('retained but the statement carries a different amount: correct the amount, never remove', () => {
  const v = c({ statementAmount: 1550.57 });
  assert.equal(v.kind, 'retained_differs');
  if (v.kind === 'retained_differs') assert.equal(v.delta, 775.28);
  const g = cancelledStayGap(v, 'Catherine Dixon', 'HMSRJ5FRBT')!;
  assert.equal(g.severity, 'warning');
  assert.match(g.description, /do NOT remove/);
});

test('no live figure is UNKNOWN and loud, whatever the cache said', () => {
  for (const retained of [null, undefined, NaN]) {
    const v = c({ retained });
    assert.equal(v.kind, 'retained_unknown');
    if (v.kind === 'retained_unknown') assert.equal(v.reason, 'no_live_figure');
    const g = cancelledStayGap(v, 'Gagnon', 'HMG')!;
    assert.equal(g.severity, 'critical');
    assert.match(g.description, /could not read what the cancellation policy retained/);
    assert.equal(g.expected_data, 'reservation:HMG', 'bare code, so Remove can find the row after a re-probe');
  }
});

test('a POSITIVE non-Airbnb figure is unknown by basis and names the channel', () => {
  const v = c({ statementAmount: 500, retained: 558.5, platform: 'Booking.com' });
  assert.equal(v.kind, 'retained_unknown');
  if (v.kind === 'retained_unknown') { assert.equal(v.reason, 'channel_basis'); assert.equal(v.platform, 'Booking.com'); }
  const g = cancelledStayGap(v, 'B', 'BC-1')!;
  assert.match(g.description, /on Booking\.com that figure includes tax/);
  assert.match(g.description, /check the folio/);
  assert.equal(g.expected_data, 'reservation:BC-1');
});

test('the match is to the cent', () => {
  assert.equal(c({ retained: 775.294 }).kind, 'retained_matches');
  assert.equal(c({ retained: 775.30 }).kind, 'retained_differs');
});

test('the bank-match caveat rides along on every filed verdict that has a row to remove', () => {
  const note = ' It carries a matched bank match.';
  for (const v of [c({ retained: 0 }), c({ statementAmount: 1 }), c({ retained: null })]) {
    assert.match(cancelledStayGap(v, 'G', 'C', note)!.description, /matched bank match\.$/);
  }
});
