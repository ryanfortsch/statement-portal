import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripeLookupHref } from '../stripe-lookup-link.ts';

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

test('the lookup link searches by email, through checkout, from the day before booking', () => {
  assert.equal(
    stripeLookupHref({ email: ' guest@example.com ', bookedAt: '2026-07-04T23:10:00Z', checkOut: '2026-10-12' }),
    '/payments?email=guest%40example.com&from=2026-07-03&to=2026-10-12',
  );
  assert.equal(stripeLookupHref({ email: 'guest@example.com', checkOut: '2026-10-12' }), '/payments?email=guest%40example.com&to=2026-10-12');
});

test('no email falls back to the name; with neither there is no link', () => {
  assert.equal(stripeLookupHref({ name: 'Jordan Synthetic', checkOut: '2026-10-12' }), '/payments?q=Jordan+Synthetic&to=2026-10-12');
  assert.equal(stripeLookupHref({ email: '', name: '  ' }), null);
  assert.equal(stripeLookupHref({ email: 'a@b.c', checkOut: 'soon' }), '/payments?email=a%40b.c');
});

test('the guest card and the booking record link to the lookup for every login', () => {
  // Open to staff, read-only, since 2026-10-19 (Dotti).
  const card = read('src/app/messaging/MessagingQueue.tsx');
  const at = card.indexOf('stripeLookupHref({');
  assert.ok(at > 0, 'the guest card builds the link');
  assert.ok(card.includes('const lookupHref = !inquiry'), 'for any login; an inquiry has no stay');
  const booking = read('src/app/channels/bookings/[id]/page.tsx');
  const bAt = booking.indexOf('stripeLookupHref({');
  assert.ok(bAt > 0, 'the booking record builds the link');
  assert.ok(booking.includes('const lookupHref = !isBlock'), 'for any login; a hold has no guest');
});

test('the page is named for what it does and shows progress while it searches', () => {
  const page = read('src/app/payments/page.tsx');
  assert.ok(page.includes('title="Stripe lookup"'), 'the hero says Stripe lookup');
  assert.ok(page.includes('<Suspense key={searchKey}'), 'the results stream behind a fallback that says it is searching');
  assert.ok(read('src/components/FinancialsTabs.tsx').includes("label: 'Stripe lookup'"), 'the Money strip says Stripe lookup');
  // The lookup is open to staff, read-only; charging a saved card is not.
  const access = read('src/lib/helm-access.ts');
  assert.ok(!access.includes("  '/payments',"), '/payments is staff-open');
  assert.ok(!access.includes("  '/api/payments',"), '/api/payments/lookup is staff-open');
  assert.ok(access.includes("  '/payments/balance-charges',"), 'balance charges stay owners only');
});
