import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paydayFor, paydayWords, PAYDAY_RULE } from '../field-payday.ts';

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

// Oct 2026: Mon 19, Tue 20, Wed 21, Thu 22, Fri 23, Sat 24, Sun 25.
test('approved by the end of Wednesday, Cape Ann time: paid that Friday', () => {
  assert.equal(paydayFor('2026-10-19T14:00:00Z'), '2026-10-23'); // Monday
  assert.equal(paydayFor('2026-10-21T15:00:00Z'), '2026-10-23'); // Wednesday
  assert.equal(paydayFor('2026-10-22T03:30:00Z'), '2026-10-23'); // Wednesday 11:30 PM ET
  assert.equal(paydayFor('2026-10-18T16:00:00Z'), '2026-10-23'); // Sunday
});

test('approved Thursday through Saturday: paid the Friday after', () => {
  assert.equal(paydayFor('2026-10-22T05:00:00Z'), '2026-10-30'); // Thursday 1 AM ET
  assert.equal(paydayFor('2026-10-23T15:00:00Z'), '2026-10-30'); // Friday
  assert.equal(paydayFor('2026-10-24T15:00:00Z'), '2026-10-30'); // Saturday
});

test('words, and a bad timestamp says nothing', () => {
  assert.equal(paydayWords('2026-10-23'), 'Friday, Oct 23');
  assert.equal(paydayFor('not a date'), null);
  assert.ok(!PAYDAY_RULE.includes('—'));
});

test('the portal states the payday where the money is', () => {
  const profile = read('src/app/field/profile/page.tsx');
  assert.ok(profile.includes('PAYDAY_RULE'), 'the profile states the rule under Approved, unpaid');
  const packet = read('src/app/field/packet/[packetId]/page.tsx');
  assert.ok(packet.includes('paydayFor(packet.approved_at)'), 'an approved trip names its Friday');
});
