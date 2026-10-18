/**
 * Direct inquiries expire once their check-in has passed
 * (src/lib/inquiry-expiry.ts): the pending count is the open ones, expired
 * ones fold, and the nightly sweep closes only Helm's own. The guards at the
 * bottom read the source so the page, the loaders and the cron keep reading
 * the one rule.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EXPIRED_INQUIRY_REASON,
  expiredInquiriesOrFilter,
  expiredInquiryNote,
  isExpiredClosure,
  isInquiryExpired,
  isInquiryOpen,
  mayCloseInquiry,
} from '../inquiry-expiry.ts';

const read = (repoPath: string): string => readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const TODAY = '2026-10-18';

describe('open or expired, by check-in on the Eastern operating date', () => {
  test('a check-in yesterday is expired', () => {
    // Ciara, 73 Rocky Neck, 2026-10-17 -> 2026-10-19, still "pending" on 10-18
    const b = { status: 'inquiry', check_in: '2026-10-17' };
    assert.equal(isInquiryExpired(b, TODAY), true);
    assert.equal(isInquiryOpen(b, TODAY), false);
  });
  test('a check-in today is still open', () => {
    const b = { status: 'inquiry', check_in: TODAY };
    assert.equal(isInquiryExpired(b, TODAY), false);
    assert.equal(isInquiryOpen(b, TODAY), true);
  });
  test('a future check-in is open', () => {
    assert.equal(isInquiryOpen({ status: 'inquiry', check_in: '2027-07-31' }, TODAY), true);
  });
  test('only an inquiry can expire', () => {
    for (const status of ['confirmed', 'pending', 'cancelled', 'completed', 'block']) {
      assert.equal(isInquiryExpired({ status, check_in: '2026-01-01' }, TODAY), false, status);
      assert.equal(isInquiryOpen({ status, check_in: '2027-01-01' }, TODAY), false, status);
    }
  });
});

describe('who may close one', () => {
  test("Helm's own: the /book form and hand-entered", () => {
    assert.equal(mayCloseInquiry({ source: 'direct_booking' }), true);
    assert.equal(mayCloseInquiry({ source: 'manual' }), true);
  });
  test("a feed's inquiry is the feed's to close (the backfill would reopen it)", () => {
    for (const source of ['guesty_legacy', 'ical_import', 'email_parse']) {
      assert.equal(mayCloseInquiry({ source }), false, source);
    }
  });
  test('a closure is cancelled with reason expired', () => {
    assert.equal(isExpiredClosure({ status: 'cancelled', check_in: '2026-09-01', cancel_reason: EXPIRED_INQUIRY_REASON }), true);
    assert.equal(isExpiredClosure({ status: 'cancelled', check_in: '2026-09-01', cancel_reason: 'declined' }), false);
  });
});

describe('the fold', () => {
  test('one filter covers both kinds of expired row', () => {
    const f = expiredInquiriesOrFilter(TODAY);
    assert.ok(f.includes('and(status.eq.inquiry,check_in.lt.2026-10-18)'));
    assert.ok(f.includes('and(status.eq.cancelled,cancel_reason.eq.expired)'));
  });
  test('labels', () => {
    assert.equal(expiredInquiryNote({ status: 'inquiry', check_in: '2026-10-01' }), 'Check-in passed');
    assert.equal(expiredInquiryNote({ status: 'cancelled', check_in: '2026-10-01', cancel_reason: 'expired' }), 'Closed: check-in passed');
  });
});

describe('one rule everywhere it is counted', () => {
  test('the pending list reads only open inquiries', () => {
    const src = read('src/lib/channels.ts');
    const open = src.slice(src.indexOf('export async function listOpenInquiries'), src.indexOf('export type ExpiredInquiry'));
    assert.ok(open.includes(".eq('status', 'inquiry')") && open.includes(".gte('check_in', today)"));
    assert.ok(src.includes('.or(expiredInquiriesOrFilter(today))'), 'the fold and its count share the rule');
  });
  test('/channels counts the open list and folds the rest', () => {
    const src = read('src/app/channels/page.tsx');
    assert.ok(src.includes('listOpenInquiries(today)') && src.includes('listExpiredInquiries(today)'));
    assert.ok(src.includes('{inquiries.length} pending'));
    assert.ok(src.includes('Expired · {expired.total}'));
  });
  test('the nightly sweep closes through the locked writer, reason expired, after a re-read', () => {
    const cron = read('src/app/api/cron/expire-queues/route.ts');
    assert.ok(cron.includes('cancelBooking(id, { reason: EXPIRED_INQUIRY_REASON, actor: INQUIRY_EXPIRY_ACTOR })'));
    const lib = read('src/lib/inquiry-expiry.ts');
    const sweep = lib.slice(lib.indexOf('export async function expireStaleInquiries'));
    assert.ok(sweep.includes(".in('source', [...HELM_OWNED_INQUIRY_SOURCES])"));
    const reread = sweep.indexOf(".eq('id', row.id)");
    assert.ok(reread > 0 && reread < sweep.indexOf('await close(row.id)'), 'a Confirm that landed since the read is never cancelled');
  });
});
