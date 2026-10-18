/**
 * Balance charges is a Payments page.
 *
 * It charged a guest's saved card from /statements/balance-charges with no
 * registry entry, no section strip and its own rounded styling, reachable
 * only by a URL in a concierge work slip. It now lives under /payments, in
 * the atlas, with the Financials strip; the old URL redirects, and the
 * one-line charge confirm from #1908 stays on both buttons
 * (irreversible-confirms.test.ts).
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { HELM_MODULES } from '../helm-modules.ts';
import { pathRequiresOwner } from '../helm-access.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

test('the page moved, and the old URL redirects to it', () => {
  assert.ok(existsSync(new URL('../../../src/app/payments/balance-charges/page.tsx', import.meta.url)));
  assert.ok(!existsSync(new URL('../../../src/app/statements/balance-charges', import.meta.url)), 'a second copy is left under /statements');
  assert.match(read('next.config.ts'), /source: '\/statements\/balance-charges',\s*destination: '\/payments\/balance-charges',\s*permanent: true,/);
  assert.ok(!read('src/app/payments/balance-charges/actions.ts').includes("'/statements/balance-charges"), 'the charge action redirects to the old URL');
});

test('it is registered, owner-only, and wears the Financials strip', () => {
  const entry = HELM_MODULES.find(m => m.href === '/payments/balance-charges');
  assert.ok(entry, 'balance charges is missing from the atlas');
  assert.equal(entry.access, 'owner');
  assert.equal(pathRequiresOwner('/payments/balance-charges'), true);
  const page = read('src/app/payments/balance-charges/page.tsx');
  assert.match(page, /<FinancialsTabs current="payments" \/>/);
  assert.ok(!/borderRadius/.test(page), 'the rounded card styling is back');
  assert.match(read('src/app/payments/page.tsx'), /href="\/payments\/balance-charges"/);
});
