import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeEmail,
  planRecipientChange,
  scopeProperties,
  splitName,
} from '../owner-recipients.ts';

const alex = { first_name: 'Alex', last_name: 'R', email: 'alex@example.com', phone: '', is_primary: true, role: 'owner', notes: '' };

test('adding a recipient puts them on the send list and makes them a watched contact', () => {
  const plan = planRecipientChange(
    { owner_emails: ['alex@example.com'], owners: [alex] },
    'add',
    'laura@example.com',
    { name: 'Laura Rosenstein', note: 'asked by Alex' },
  );
  assert.equal(plan.changed, true);
  assert.deepEqual(plan.owner_emails, ['alex@example.com', 'laura@example.com']);
  assert.equal(plan.owners.length, 2);
  assert.equal(plan.owners[1].email, 'laura@example.com');
  assert.equal(plan.owners[1].first_name, 'Laura');
  assert.equal(plan.owners[1].is_primary, false);
  // The primary card is untouched.
  assert.equal(plan.owners[0].is_primary, true);
});

test('adding someone already there changes nothing', () => {
  const plan = planRecipientChange(
    { owner_emails: ['Alex@example.com', 'laura@example.com'], owners: [alex, { email: 'laura@example.com' }] },
    'add',
    'laura@example.com',
  );
  assert.equal(plan.changed, false);
});

test('an address on the send list but not the contacts still gets its card', () => {
  const plan = planRecipientChange({ owner_emails: ['alex@example.com', 'laura@example.com'], owners: [alex] }, 'add', 'laura@example.com');
  assert.equal(plan.changed, true);
  assert.equal(plan.owner_emails.length, 2);
  assert.equal(plan.owners.length, 2);
});

test('removal never leaves a statement addressed to nobody', () => {
  const plan = planRecipientChange({ owner_emails: ['laura@example.com'], owners: [] }, 'remove', 'laura@example.com');
  assert.equal(plan.changed, false);
  assert.equal(plan.refused, 'last_recipient');
});

test('removal never deletes the primary contact', () => {
  const plan = planRecipientChange({ owner_emails: ['alex@example.com', 'x@example.com'], owners: [alex] }, 'remove', 'alex@example.com');
  assert.equal(plan.refused, 'primary_contact');
  assert.deepEqual(plan.owner_emails, ['alex@example.com', 'x@example.com']);
});

test('removal drops the address and its card', () => {
  const plan = planRecipientChange(
    { owner_emails: ['alex@example.com', 'laura@example.com'], owners: [alex, { email: 'laura@example.com' }] },
    'remove',
    'LAURA@example.com'.toLowerCase(),
  );
  assert.equal(plan.changed, true);
  assert.deepEqual(plan.owner_emails, ['alex@example.com']);
  assert.equal(plan.owners.length, 1);
});

test('scope follows the requesting owner across properties, else the named one', () => {
  const rows = [
    { id: 'a', owner_emails: ['p@example.com'] },
    { id: 'b', owner_emails: ['P@example.com', 'q@example.com'] },
    { id: 'c', owner_emails: ['z@example.com'] },
  ];
  assert.deepEqual(scopeProperties(rows, 'c', 'p@example.com').map((r) => r.id), ['a', 'b']);
  assert.deepEqual(scopeProperties(rows, 'c', 'nobody@example.com').map((r) => r.id), ['c']);
  assert.deepEqual(scopeProperties(rows, 'c', null).map((r) => r.id), ['c']);
});

test('email and name parsing', () => {
  assert.equal(normalizeEmail(' LacBC5@Gmail.com '), 'lacbc5@gmail.com');
  assert.equal(normalizeEmail('not an email'), null);
  assert.equal(normalizeEmail('a@b'), null);
  assert.deepEqual(splitName('Laura'), { first_name: 'Laura', last_name: '' });
  assert.deepEqual(splitName(''), { first_name: '', last_name: '' });
});
