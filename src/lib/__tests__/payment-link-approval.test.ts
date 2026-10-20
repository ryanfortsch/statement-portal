import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkoutApprovalText, paymentLinkApprovalParams } from '../payment-links-text.ts';

test('approval text names the exact amount, the item and the home', () => {
  const t = checkoutApprovalText({ label: 'Late checkout', propertyTitle: 'Stay at Rocky Neck', totalCents: 22340 });
  assert.match(t, /one-time charge of \$223\.40 for: Late checkout, Stay at Rocky Neck\./);
  assert.match(t, /Reply to the text/);
  assert.doesNotMatch(t, /refund/i);
  assert.ok(t.length <= 1200);
});

test('a saved-card deposit says the card is kept for the balance', () => {
  const t = checkoutApprovalText({ label: 'Deposit', propertyTitle: '', totalCents: 100000, saveCard: true });
  assert.match(t, /\$1000 for: Deposit\./);
  assert.match(t, /remaining balance/);
});

test('safeguards limit one payment and require an address; the checkbox is separate', () => {
  const p = paymentLinkApprovalParams({ label: 'Pet fee', propertyTitle: 'X', totalCents: 5000 });
  assert.equal(p.safeguards['restrictions[completed_sessions][limit]'], '1');
  assert.equal(p.safeguards['billing_address_collection'], 'required');
  assert.ok(!('consent_collection[terms_of_service]' in p.safeguards));
  assert.equal(p.consent['consent_collection[terms_of_service]'], 'required');
  // A PI description would change how stripe-sync labels the charge.
  assert.ok(!Object.keys({ ...p.safeguards, ...p.consent }).some(k => k.includes('description')));
});

test('mint steps down to the original params, so a link always mints', () => {
  const src = readFileSync(new URL('../payment-links.ts', import.meta.url), 'utf8');
  assert.match(src, /\{ \.\.\.linkParams, \.\.\.approval\.safeguards, \.\.\.approval\.consent \}/);
  assert.match(src, /\{ \.\.\.linkParams, \.\.\.approval\.safeguards \},\n\s+linkParams,\n\s+\];/);
  assert.match(src, /!link\.ok && link\.status === 400/);
});
