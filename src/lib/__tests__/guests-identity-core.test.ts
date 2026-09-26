/**
 * The identity rules behind the Helm-native guest record: which of a
 * booking's fields identify a person, in what order, and how a found
 * record absorbs a new booking without losing or inventing anything.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeEmail,
  toE164Phone,
  pickMatchStrategy,
  splitName,
  mergeGuestFields,
  newGuestFields,
  type GuestRecordFields,
} from '../guests-identity-core.ts';
import { isProxyEmail } from '../guests-types.ts';

const onFile = (over: Partial<GuestRecordFields> = {}): GuestRecordFields => ({
  first_name: null,
  last_name: null,
  full_name: null,
  email: null,
  phone: null,
  phone_e164: null,
  ...over,
});

describe('normalizeEmail', () => {
  test('lowercases and trims, refuses non-addresses', () => {
    assert.equal(normalizeEmail('  Jane.Doe@Example.COM '), 'jane.doe@example.com');
    assert.equal(normalizeEmail(''), null);
    assert.equal(normalizeEmail(null), null);
    assert.equal(normalizeEmail('jane'), null);
    assert.equal(normalizeEmail('@x.com'), null);
    assert.equal(normalizeEmail('jane@'), null);
    assert.equal(normalizeEmail('a@b@c.com'), null);
    assert.equal(normalizeEmail('jane doe@x.com'), null);
  });
});

describe('toE164Phone', () => {
  test('US ten digits become +1', () => {
    assert.equal(toE164Phone('(978) 555-1234'), '+19785551234');
    assert.equal(toE164Phone('978.555.1234'), '+19785551234');
    assert.equal(toE164Phone('1 978 555 1234'), '+19785551234');
    assert.equal(toE164Phone('+1 978 555 1234'), '+19785551234');
  });

  test('an explicit country code is kept', () => {
    assert.equal(toE164Phone('+44 20 7946 0958'), '+442079460958');
    assert.equal(toE164Phone('+353 1 234 5678'), '+35312345678');
  });

  test('not a phone yields null, never a fragment', () => {
    assert.equal(toE164Phone('555-1234'), null);
    assert.equal(toE164Phone(''), null);
    assert.equal(toE164Phone(null), null);
    assert.equal(toE164Phone('call me'), null);
  });
});

describe('pickMatchStrategy', () => {
  test('email first, then phone', () => {
    assert.deepEqual(
      pickMatchStrategy({ guest_email: 'Jane@X.com', guest_phone: '(978) 555-1234' }),
      [{ kind: 'email', email: 'jane@x.com' }, { kind: 'phone', phone: '+19785551234' }],
    );
  });

  test('a proxy email is demoted below the phone', () => {
    const s = pickMatchStrategy(
      { guest_email: 'abc123@guest.airbnb.com', guest_phone: '978-555-1234' },
      { isProxyEmail },
    );
    assert.deepEqual(s, [
      { kind: 'phone', phone: '+19785551234' },
      { kind: 'email', email: 'abc123@guest.airbnb.com' },
    ]);
  });

  test('a proxy email alone is still an identity', () => {
    assert.deepEqual(
      pickMatchStrategy({ guest_email: 'abc@mchat.booking.com' }, { isProxyEmail }),
      [{ kind: 'email', email: 'abc@mchat.booking.com' }],
    );
  });

  test('no identity means no strategy, so no record is invented', () => {
    assert.deepEqual(pickMatchStrategy({ guest_name: 'Reserved' }), []);
    assert.deepEqual(pickMatchStrategy({ guest_email: 'nope', guest_phone: '12' }), []);
    assert.deepEqual(pickMatchStrategy({}), []);
  });
});

describe('splitName', () => {
  test('last word is the surname, the rest the given names', () => {
    assert.deepEqual(splitName('Jane Doe'), { first_name: 'Jane', last_name: 'Doe' });
    assert.deepEqual(splitName('  Mary  van der Berg '), { first_name: 'Mary van der', last_name: 'Berg' });
    assert.deepEqual(splitName('Cher'), { first_name: 'Cher', last_name: null });
    assert.deepEqual(splitName(''), { first_name: null, last_name: null });
    assert.deepEqual(splitName(null), { first_name: null, last_name: null });
  });
});

describe('mergeGuestFields', () => {
  test('fills blanks and never overwrites a real value', () => {
    const existing = onFile({ full_name: 'Jane Doe', first_name: 'Jane', last_name: 'Doe', email: 'jane@x.com' });
    const r = mergeGuestFields(existing, { guest_name: 'J. Doe', guest_email: 'other@y.com', guest_phone: '(978) 555-1234' });
    assert.equal(r.changed, true);
    assert.deepEqual(r.patch, { phone_e164: '+19785551234', phone: '(978) 555-1234' });
  });

  test('a proxy email on file yields to a real one, never the reverse', () => {
    const proxyOnFile = onFile({ email: 'abc@guest.airbnb.com', phone_e164: '+19785551234' });
    const up = mergeGuestFields(proxyOnFile, { guest_email: 'Jane@X.com' }, { isProxyEmail });
    assert.deepEqual(up.patch, { email: 'jane@x.com' });

    const realOnFile = onFile({ email: 'jane@x.com', phone_e164: '+19785551234' });
    const down = mergeGuestFields(realOnFile, { guest_email: 'abc@guest.airbnb.com' }, { isProxyEmail });
    assert.equal(down.changed, false);
  });

  test('a blank email on file is filled, an empty incoming email is not invented', () => {
    const r1 = mergeGuestFields(onFile({ phone_e164: '+19785551234' }), { guest_email: 'jane@x.com' });
    assert.deepEqual(r1.patch, { email: 'jane@x.com' });
    const r2 = mergeGuestFields(onFile({ phone_e164: '+19785551234' }), { guest_email: '', guest_phone: '' });
    assert.equal(r2.changed, false);
    assert.ok(!('email' in r2.patch));
  });

  test('a name fills first/last when only the full name was known', () => {
    const r = mergeGuestFields(onFile({ full_name: 'Jane Doe', email: 'jane@x.com' }), { guest_name: 'Jane Doe' });
    assert.deepEqual(r.patch, { first_name: 'Jane', last_name: 'Doe' });
  });

  test('a fully populated record absorbs a repeat booking with no write', () => {
    const existing = onFile({
      full_name: 'Jane Doe', first_name: 'Jane', last_name: 'Doe',
      email: 'jane@x.com', phone: '(978) 555-1234', phone_e164: '+19785551234',
    });
    const r = mergeGuestFields(existing, { guest_name: 'Jane Doe', guest_email: 'JANE@x.com', guest_phone: '+1 978 555 1234' });
    assert.equal(r.changed, false);
    assert.deepEqual(r.patch, {});
  });
});

describe('newGuestFields', () => {
  test('builds the insert from what the booking carries, nulls elsewhere', () => {
    assert.deepEqual(newGuestFields({ guest_name: 'Jane Doe', guest_phone: '978-555-1234' }), {
      first_name: 'Jane',
      last_name: 'Doe',
      full_name: 'Jane Doe',
      email: null,
      phone: '978-555-1234',
      phone_e164: '+19785551234',
    });
  });

  test('never manufactures an email', () => {
    const g = newGuestFields({ guest_name: 'Phone Only', guest_phone: '978-555-1234' });
    assert.equal(g.email, null);
  });
});
