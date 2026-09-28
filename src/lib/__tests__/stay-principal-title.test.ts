import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isStayPrincipalTitle } from '../extras-markers.ts';

test('both SCA title forms read as stay principal', () => {
  assert.equal(isStayPrincipalTitle('Stay at Rocky Neck - 2026-09-02 to 2026-09-06'), true);
  assert.equal(isStayPrincipalTitle('Stay in Central Gloucester - 2026-09-02 to 2026-09-06'), true);
  assert.equal(isStayPrincipalTitle('  stay IN Central Gloucester'), true);
});

test('add-ons and other words do not', () => {
  assert.equal(isStayPrincipalTitle('Boat docking fee - Eva Madruga - Stay at Rocky Neck'), false);
  assert.equal(isStayPrincipalTitle('Stayed late fee'), false);
  assert.equal(isStayPrincipalTitle('Stay extension'), false);
  assert.equal(isStayPrincipalTitle(''), false);
  assert.equal(isStayPrincipalTitle(null), false);
});

test('both call sites use the shared test, not a bare "stay at" regex', () => {
  for (const f of ['src/lib/stripe-sync.ts', 'src/lib/payment-links.ts']) {
    const src = readFileSync(f, 'utf8');
    assert.ok(src.includes('isStayPrincipalTitle('), `${f} must call isStayPrincipalTitle`);
    assert.ok(!/\/\^stay at\\b\/i/.test(src), `${f} still has a bare /^stay at\\b/i`);
  }
});
