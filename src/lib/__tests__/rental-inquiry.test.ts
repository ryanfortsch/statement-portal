import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inquiryAvailability, inquiryQuoteHref, type RentalInquiry } from '../rental-inquiry.ts';
const inquiry: RentalInquiry = { check_in: '2090-07-06', check_out: '2090-08-14', guests: 4, flexible: true, history_checked: true, checked_at: '', needs: ['Approve long-stay quote'], homes: [] };
test('unreleased and failed checks never appear available', () => {
  assert.equal(inquiryAvailability('prerelease'), 'Pre-release · confirmation needed');
  assert.equal(inquiryAvailability('unknown'), 'Availability not verified');
});
test('each quote action preserves its home, requested dates, party and source', () => {
  const url = new URL(inquiryQuoteHref(inquiry, 'test_home_b', { first: 'Alex & Sam', email: 'test@example.com', source: 'sca_email:source' }), 'https://example.test');
  assert.equal(url.pathname, '/guests/quotes/new');
  assert.equal(url.searchParams.get('property'), 'test_home_b');
  assert.equal(url.searchParams.get('check_in'), '2090-07-06');
  assert.equal(url.searchParams.get('check_out'), '2090-08-14');
  assert.equal(url.searchParams.get('guests'), '4');
  assert.equal(url.searchParams.get('first'), 'Alex & Sam');
  assert.equal(url.searchParams.get('source_ref'), 'sca_email:source');
});
