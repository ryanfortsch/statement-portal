import test from 'node:test';
import assert from 'node:assert/strict';
import { proactiveBadge, proactiveKind, sendsTo } from '../../app/messaging/format.ts';

test('a payment reminder card reads as proactive, in the add-on plum', () => {
  const id = 'quo_sms:payremind:addon:6a99a610bb2a4b1726c26fc9:pet-fee-for-both-dogs:30000:1';
  assert.equal(proactiveKind(id, 'payment_reminder'), 'payment');
  assert.equal(proactiveKind(id, ''), 'payment');
  assert.deepEqual(proactiveBadge('payment'), { label: 'Payment reminder', tone: '#6b4f7a' });
  // An ordinary guest text is still a guest reply, not a proactive card.
  assert.equal(proactiveKind('quo_sms:abc123', 'general'), null);
});

/**
 * Two card kinds do not reply up the platform thread, and both were approved
 * blind. The concierge has sent `sms_to` since 2026-09-25 for exactly this
 * reason, in its own words: "An SMS card carried no destination at all, so
 * the operator approved a text without seeing the number." Helm's Approval
 * type did not even have the field, so the fix was only half shipped.
 *
 * A relay card is the sharper case: approving it emails an access code to
 * somebody who is not on the reservation.
 */
test('a card that leaves the platform thread says where it sends', () => {
  // A guest-SMS card texts the number, in house format.
  assert.equal(
    sendsTo({ topic: 'general', sms_to: '+19786093894' }),
    'texts (978) 609-3894',
  );
  // A relay card emails the third party the booker named.
  assert.equal(
    sendsTo({ topic: 'guest_relay_request', guest_email: 'joellancaster0@googlemail.com' }),
    'emails joellancaster0@googlemail.com',
  );
  // The phone wins when a card somehow carries both: that is the send path.
  assert.equal(
    sendsTo({ topic: 'guest_relay_request', sms_to: '9786093894', guest_email: 'x@y.com' }),
    'texts (978) 609-3894',
  );
});

test('an ordinary card claims no destination', () => {
  // An OTA reply goes back up the thread it came from and needs no label.
  assert.equal(sendsTo({ topic: 'door_code' }), '');
  assert.equal(sendsTo({ topic: 'door_code', sms_to: '', guest_email: '' }), '');
  assert.equal(sendsTo({ topic: 'door_code', sms_to: null, guest_email: null }), '');
  // An SCA or 2027 card also carries an email, but its send path is not
  // Helm's to describe and a confident wrong "sends to" is worse than none.
  assert.equal(sendsTo({ topic: 'prerelease_request', guest_email: 'abha@example.com' }), '');
  assert.equal(sendsTo({ topic: 'sca_inquiry', guest_email: 'abha@example.com' }), '');
  // A relay card with no address on file says nothing rather than guessing.
  assert.equal(sendsTo({ topic: 'guest_relay_request', guest_email: '' }), '');
  assert.equal(sendsTo({}), '');
});
