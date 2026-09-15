import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePropertyIdFromSlug,
  resolvePropertyIdFromName,
  buildPaymentLinkSms,
  buildPaymentLinkNudgeSms,
  fillLinkPlaceholder,
  LINK_PLACEHOLDER,
  toE164,
  helmRequestKey,
  reservationIdFromRequestKey,
  paymentLinkStatus,
  money,
  stripeKeyFixUrl,
  explainPaidCheckError,
} from '../payment-links-text.ts';

const IDS = ['3_south_st', '21_horton', '53_rocky_neck', '53_rocky_neck_2', '17_beach_rd', '3_windward', '4_brier_neck'];

test('slug resolution: exact, alias, suffix-stripped stem, ambiguity', () => {
  assert.equal(resolvePropertyIdFromSlug('21_horton', IDS), '21_horton');
  assert.equal(resolvePropertyIdFromSlug('3_south_street', IDS), '3_south_st');
  assert.equal(resolvePropertyIdFromSlug('3_windward_pt', IDS), '3_windward');
  assert.equal(resolvePropertyIdFromSlug('17_beach_road', IDS), '17_beach_rd');
  // The sub-unit keeps its tag: never collapses onto the main house.
  assert.equal(resolvePropertyIdFromSlug('53_rocky_neck_2', IDS), '53_rocky_neck_2');
  assert.equal(resolvePropertyIdFromSlug('53_rocky_neck', IDS), '53_rocky_neck');
  assert.equal(resolvePropertyIdFromSlug('marina', IDS), null);
  assert.equal(resolvePropertyIdFromSlug('', IDS), null);
});

test('name fallback: the Send lens display name finds the property', () => {
  const props = [
    { id: '3_south_st', name: '3 South' },
    { id: '53_rocky_neck', name: '53 Rocky Neck' },
    { id: '53_rocky_neck_2', name: '53 Rocky Neck, Downstairs' },
  ];
  assert.equal(resolvePropertyIdFromName('3 South', props), '3_south_st');
  assert.equal(resolvePropertyIdFromName('3 south st', props), '3_south_st');
  assert.equal(resolvePropertyIdFromName('53 Rocky Neck', props), '53_rocky_neck');
  assert.equal(resolvePropertyIdFromName('53 Rocky Neck (DOWN)', props), null);
  assert.equal(resolvePropertyIdFromName('', props), null);
});

test('sms wording carries the tax split and the reply-here closer', () => {
  const body = buildPaymentLinkSms({
    guestFirst: 'Jimmy',
    label: 'late checkout',
    baseCents: 20000,
    taxCents: 2340,
    totalCents: 22340,
    propertyTitle: 'Stay at Rocky Neck',
    url: 'https://buy.stripe.com/abc',
  });
  assert.equal(
    body,
    "Hi Jimmy, it's Allie, your host from Stay at Rocky Neck. Here's the secure payment link for the late checkout ($223.40 - $200 plus $23.40 MA occupancy tax): https://buy.stripe.com/abc Thanks so much, and just reply here if you have any trouble with it!",
  );
  const untaxed = buildPaymentLinkSms({
    guestFirst: '',
    label: 'lost key',
    baseCents: 5000,
    taxCents: 0,
    totalCents: 5000,
    propertyTitle: '',
    url: 'U',
  });
  assert.ok(untaxed.startsWith("Hi there, it's Allie, your host. Here's the secure payment link for the lost key ($50): U"));
  const nudge = buildPaymentLinkNudgeSms({ guestFirst: 'Jimmy', label: 'late checkout', totalCents: 22340, propertyTitle: 'Stay at Rocky Neck', url: 'U' });
  assert.ok(nudge.includes('still open'));
  assert.ok(nudge.includes('$223.40'));
});

test('placeholder fill never drops the link', () => {
  assert.equal(fillLinkPlaceholder(`pay here ${LINK_PLACEHOLDER} thanks`, 'U'), 'pay here U thanks');
  assert.equal(fillLinkPlaceholder('pay here thanks', 'U'), 'pay here thanks U');
  assert.equal(fillLinkPlaceholder('already U in it', 'U'), 'already U in it');
  assert.equal(fillLinkPlaceholder('', 'U'), 'U');
});

test('phones', () => {
  assert.equal(toE164('(978) 555-1234'), '+19785551234');
  assert.equal(toE164('19785551234'), '+19785551234');
  assert.equal(toE164('+19785551234'), '+19785551234');
  assert.equal(toE164('12345'), '');
  assert.equal(toE164(''), '');
});

test('request keys: anchor, suffix, and the reservation id read back', () => {
  const key = helmRequestKey({ reservationId: 'abcdefabcdefabcdefabcdef', conversationId: 'c', propertyId: '3_south_st', label: 'Late checkout', amountCents: 20000 });
  assert.equal(key, 'helm:abcdefabcdefabcdefabcdef:late-checkout:20000');
  assert.equal(helmRequestKey({ reservationId: '', conversationId: 'conv1', propertyId: 'p', label: 'Pet fee', amountCents: 7500, suffix: 2 }), 'helm:conv1:pet-fee:7500:2');
  assert.equal(reservationIdFromRequestKey(key), 'abcdefabcdefabcdefabcdef');
  assert.equal(reservationIdFromRequestKey('addon:abcdefabcdefabcdefabcdef:tesla-charger:4500'), 'abcdefabcdefabcdefabcdef');
  // An approval uuid anchor is not a reservation.
  assert.equal(reservationIdFromRequestKey('addon:0f9f6f4e-1c2b-4c3d-9e8f-000000000000:pet:100'), '');
  assert.equal(reservationIdFromRequestKey('ffdeposit:x'), '');
});

test('status: paid wins, then cancelled, unsent only for helm links, overdue after a day', () => {
  const now = Date.parse('2026-09-14T12:00:00Z');
  const base = { source: 'helm', created_at: '2026-09-14T11:00:00Z', sent_at: null, sent_via: '', paid_at: null, deactivated_at: null };
  assert.equal(paymentLinkStatus({ ...base, paid_at: '2026-09-14T11:30:00Z', deactivated_at: '2026-09-14T11:40:00Z' }, now), 'paid');
  assert.equal(paymentLinkStatus({ ...base, deactivated_at: '2026-09-14T11:40:00Z' }, now), 'cancelled');
  assert.equal(paymentLinkStatus(base, now), 'unsent');
  assert.equal(paymentLinkStatus({ ...base, sent_via: 'sms', sent_at: '2026-09-14T11:05:00Z' }, now), 'waiting');
  assert.equal(paymentLinkStatus({ ...base, sent_via: 'sms', sent_at: '2026-09-13T11:00:00Z' }, now), 'overdue');
  // Concierge links are delivered by the concierge: never "unsent".
  assert.equal(paymentLinkStatus({ ...base, source: 'concierge' }, now), 'waiting');
  assert.equal(paymentLinkStatus({ ...base, source: 'concierge', created_at: '2026-09-12T11:00:00Z' }, now), 'overdue');
  // A link Stripe would not let us read is never called unpaid.
  assert.equal(
    paymentLinkStatus({ ...base, source: 'concierge', created_at: '2026-09-12T11:00:00Z', paid_check_error: '403 Permission denied' }, now),
    'unverified',
  );
  assert.equal(paymentLinkStatus({ ...base, paid_at: '2026-09-14T11:30:00Z', paid_check_error: 'stale' }, now), 'paid');
});

test('paid-check errors: the fix link and the plain-words reason', () => {
  const err = "403 Permission denied. The provided key 'rk_live_...SYT3' does not have the required permissions for this endpoint on account 'acct_1'. Enabling Checkout Sessions Read ('checkout_session_read') permissions on this key would allow this request to continue. You can edit permissions at https://dashboard.stripe.com/b/acct_1?destination=%2Fapikeys%2Fmk_1%2Fedit";
  assert.equal(stripeKeyFixUrl(err), 'https://dashboard.stripe.com/b/acct_1?destination=%2Fapikeys%2Fmk_1%2Fedit');
  assert.equal(stripeKeyFixUrl('nothing here'), '');
  assert.equal(explainPaidCheckError(err), "the property's Stripe key needs Checkout Sessions read");
  assert.equal(explainPaidCheckError('no Stripe key for this property'), 'Helm has no Stripe key for this property');
});

test('money', () => {
  assert.equal(money(20000), '$200');
  assert.equal(money(22340), '$223.40');
});
