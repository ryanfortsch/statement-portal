import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { headerGuestCode } from '../masthead-guest-code.ts';
import type { LockCode } from '../guest-locks.ts';

const code = (name: string | null, pin: string | null, source: LockCode['source'] = 'helm'): LockCode => ({
  access_code_id: `${name}-${pin}`,
  name,
  code: pin,
  starts_at: null,
  ends_at: null,
  source,
  lock_name: 'Front door',
});

test('a contractor, cleaner, maintenance, creative, master or test code is never the guest code', () => {
  const lock = [
    code('Field · Delaney Jordan', '4678'),
    code('Cleaner', '2222'),
    code('Maintenance', '3333'),
    code('Creative', '5555'),
    code('Master inspection', '9999'),
    code('Helm test · ryan', '1357'),
    code('Rising Tide', '2468'),
    code('Kittredge owner code', '1111', 'external'),
  ];
  assert.equal(headerGuestCode(lock, 'Delilah Rivas'), null);
  assert.equal(headerGuestCode(lock, null), null);
});

test('the 21 Horton case: the Field PIN is passed over for the guest code on the lock', () => {
  const lock = [code('Field · Delaney Jordan', '4678'), code('Delilah Rivas', '8080', 'external')];
  assert.equal(headerGuestCode(lock, 'Delilah Rivas')?.code, '8080');
});

test('a generic guest code qualifies for anyone', () => {
  assert.equal(headerGuestCode([code('September Guest Code', '7070', 'external')], 'Brian Mullins')?.code, '7070');
  assert.equal(headerGuestCode([code('Guest · stay', '6060')], null)?.code, '6060');
});

test('a code named for a different guest is never shown as this guest\'s', () => {
  const lock = [code('Guest · Brian Mullins', '5151')];
  assert.equal(headerGuestCode(lock, 'Delilah Rivas'), null);
  assert.equal(headerGuestCode(lock, 'Brian Mullins')?.code, '5151');
});

test('a Helm-managed guest code wins a tie, and a code with no digits never shows', () => {
  const lock = [code('Guest Code', '1212', 'external'), code('Guest · Delilah Rivas', '3434'), code('Guest Code', null)];
  assert.equal(headerGuestCode(lock, 'Delilah Rivas')?.code, '3434');
});

test('the property header reads the guest code through this rule, not the first Helm code', () => {
  const src = readFileSync(new URL('../../app/properties/[id]/PropertyMasthead.tsx', import.meta.url), 'utf8');
  assert.ok(src.includes('headerGuestCode('), 'PropertyMasthead picks its fallback with headerGuestCode');
  assert.ok(!/lockCodes\.find\(\(c\) => c\.code && c\.source === 'helm'\)/.test(src), 'the first-Helm-code fallback is gone');
});
