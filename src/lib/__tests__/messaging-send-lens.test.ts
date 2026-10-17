/**
 * The Send lens has two tabs, Message and Charge (2026-10-17): the payment
 * panel is a tab with its ledger under it, not a disclosure under the
 * composer. The Proactive explainer is gone, the three unstyled controls
 * wear the house quiet button, no error string names an env var or a Stripe
 * key permission, and the "signed Allie" claim matches the template.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPaymentLinkSms } from '../payment-links-text.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

describe('the Send lens', () => {
  test('Message and Charge are tabs in the URL, and the ledger sits under Charge', () => {
    const page = read('src/app/messaging/send/page.tsx');
    assert.ok(page.includes("first(sp.tab) === 'charge' ? 'charge' : 'message'"), 'the tab rides in the URL');
    assert.ok(/tab === 'charge' \? \([\s\S]*<PaymentLinksLedger \/>/.test(page), 'the ledger renders on the Charge tab only');
    const panel = read('src/app/messaging/send/SendPanel.tsx');
    assert.ok(panel.includes("{t === 'message' ? 'Message' : 'Charge'}"), 'the two tabs');
    assert.ok(panel.includes('&stay=${encodeURIComponent(picked.conversation_id)}'), 'the picked stay survives a tab switch');
    assert.ok(!read('src/app/messaging/send/PaymentLinkPanel.tsx').includes("'Payment link ▾'"), 'no disclosure toggle');
    for (const file of ['src/components/ForMeFeed.tsx', 'src/lib/concierge-alerts.ts']) {
      assert.ok(!read(file).includes('/messaging/send#payment-links'), `${file} still links the old anchor`);
      assert.ok(read(file).includes('/messaging/send?tab=charge#payment-links'), `${file} must land on the Charge tab`);
    }
  });

  test('no explainer, house buttons', () => {
    for (const file of ['src/app/messaging/RemindersSection.tsx', 'src/components/ProactiveRemindersPanel.tsx']) {
      const src = read(file);
      assert.ok(!src.includes('Click <b>Show</b> to set one up'), `${file} keeps the explainer`);
      assert.ok(!/<button type="button" onClick=\{loadRecurring\}/.test(src), `${file}: Refresh is unstyled`);
      assert.ok(!/<button type="button" onClick=\{recipients\.load\}/.test(src), `${file}: Retry is unstyled`);
      assert.ok(!/<button type="button" disabled=\{isPending \|\| polishing\} onClick/.test(src), `${file}: Discard draft is unstyled`);
      assert.equal((src.match(/className="rt-quiet-btn"/g) ?? []).length, 3, `${file}: the three controls wear the quiet button`);
    }
  });

  test('no error string names an env var or a Stripe key permission', () => {
    // payment-links-text.ts describes Stripe keys in its comments by design;
    // its two rendered sentences are pinned in payment-links-text.test.ts.
    for (const file of ['src/app/messaging/send/payment-link-actions.ts', 'src/app/messaging/MessagingQueue.tsx', 'src/app/messaging/send/PaymentLinkPanel.tsx']) {
      const src = read(file);
      assert.ok(!/STRIPE_KEY|restricted key|needs Checkout Sessions read|Stripe key is read-only|no Stripe key (in Helm|for this property')/.test(src), `${file} still talks to an engineer`);
      assert.ok(src.includes('not set up for'), `${file} lost the plain sentence`);
    }
    assert.ok(read('src/app/messaging/send/payment-link-actions.ts').includes("return 'Payment links are not set up for this home. Ask Ryan.';"));
  });

  test('the text really signs as Allie, and the panel says so in the template\'s words', () => {
    const sms = buildPaymentLinkSms({ guestFirst: 'Jane', label: 'late checkout', baseCents: 20000, taxCents: 2940, totalCents: 22940, propertyTitle: 'Stay at Rocky Neck', url: 'https://x' });
    assert.ok(sms.startsWith("Hi Jane, it's Allie, your host"), 'the template signs as Allie');
    assert.ok(read('src/app/messaging/send/PaymentLinkPanel.tsx').includes('from the Guests line, signed Allie like every guest text'));
  });
});
