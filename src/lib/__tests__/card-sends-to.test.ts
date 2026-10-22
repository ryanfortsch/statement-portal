import test from 'node:test';
import assert from 'node:assert/strict';
import { sendsTo } from '../card-sends-to.ts';

// Two card kinds do not reply up the platform thread, and both were approved
// blind: a guest-SMS card texts a number the guest gave us, and a relay card
// emails an access code to somebody who is not on the reservation.

test('a guest-SMS card says the number it texts, in house format', () => {
  assert.equal(
    sendsTo({ guesty_message_id: 'quo_sms:abc123', sms_to: '+19785550134' }),
    'Texts (978) 555-0134',
  );
  assert.equal(sendsTo({ guesty_message_id: 'quo_sms:abc123', sms_to: ' 9785550134 ' }), 'Texts (978) 555-0134');
});

test('a relay card says the address it emails', () => {
  assert.equal(
    sendsTo({
      guesty_message_id: 'relay_email:staycontact:abc:jane@example.com',
      guest_email: 'jane@example.com',
    }),
    'Emails jane@example.com',
  );
  // A relay card with no address on file says nothing rather than guessing.
  assert.equal(sendsTo({ guesty_message_id: 'relay_email:staycontact:abc:', guest_email: '' }), '');
});

test('an ordinary thread card claims no destination', () => {
  // An OTA reply goes back up the thread it came from.
  assert.equal(sendsTo({ guesty_message_id: '6a99a610bb2a4b1726c26fc9' }), '');
  assert.equal(sendsTo({ guesty_message_id: '6a99a610bb2a4b1726c26fc9', sms_to: null, guest_email: '' }), '');
  // A 2027 or Stay Cape Ann email card carries the guest's own email, but
  // that is the guest's thread, not a send somewhere else.
  assert.equal(sendsTo({ guesty_message_id: 'sca_email:18c2f', guest_email: 'guest@example.com' }), '');
  assert.equal(sendsTo({ guesty_message_id: 'prerelease:42', guest_email: 'guest@example.com' }), '');
  assert.equal(sendsTo({ guesty_message_id: '', guest_email: 'guest@example.com' }), '');
  assert.equal(sendsTo({}), '');
});
