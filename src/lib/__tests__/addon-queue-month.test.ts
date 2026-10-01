import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addonQueueMonth } from '../addon-queue-month.ts';

test('prepaid add-on moves to the stay checkout month', () => {
  assert.equal(addonQueueMonth('2026-09', '2026-11-20'), '2026-11');
  assert.equal(addonQueueMonth('2026-08', '2026-09-03'), '2026-09');
});

test('same-month or post-checkout add-on stays in the charge month', () => {
  assert.equal(addonQueueMonth('2026-09', '2026-09-28'), '2026-09');
  assert.equal(addonQueueMonth('2026-09', '2026-08-31'), '2026-09');
});

test('unknown checkout keeps the charge month', () => {
  assert.equal(addonQueueMonth('2026-09', null), '2026-09');
  assert.equal(addonQueueMonth('2026-09', ''), '2026-09');
});

test('stripe-sync routes add-on queue rows through addonQueueMonth', () => {
  const src = readFileSync(new URL('../stripe-sync.ts', import.meta.url), 'utf8');
  assert.match(src, /addonQueueMonth\(month, /);
});
