/**
 * Checkout proposals expire once their stay has ended
 * (src/lib/schedule-proposal-expiry.ts). The rule is pure; the guards at the
 * bottom read the source so the page, the cron and the restore keep calling
 * it the same way.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  expiredProposalNote,
  isProposalExpired,
  proposalStayEnd,
  shortDay,
} from '../schedule-proposal-expiry.ts';

const read = (repoPath: string): string => readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const TODAY = '2026-10-18';

describe('proposalStayEnd', () => {
  test('a time-only proposal ends on the booked checkout', () => {
    assert.equal(proposalStayEnd({ original_check_out: '2026-09-13', adjusted_check_out: null }), '2026-09-13');
  });
  test('an extension ends on the date it proposes', () => {
    assert.equal(proposalStayEnd({ original_check_out: '2026-09-13', adjusted_check_out: '2026-09-14' }), '2026-09-14');
  });
  test('an early departure never ends the stay before its booked checkout', () => {
    assert.equal(proposalStayEnd({ original_check_out: '2026-09-13', adjusted_check_out: '2026-09-11' }), '2026-09-13');
  });
  test('a booking Guesty has since extended keeps the later checkout', () => {
    assert.equal(proposalStayEnd({ original_check_out: '2026-10-15', adjusted_check_out: null }, '2026-10-20'), '2026-10-20');
  });
});

describe('isProposalExpired (Eastern operating date)', () => {
  test('checkout day itself is still a live question', () => {
    // 20 Hammond, 2026-10-18: "hopeful to leave by 7 tomorrow"
    assert.equal(isProposalExpired({ original_check_out: TODAY, adjusted_check_out: null }, TODAY), false);
  });
  test('the day after checkout it is over', () => {
    assert.equal(isProposalExpired({ original_check_out: '2026-10-17', adjusted_check_out: null }, TODAY), true);
  });
  test('the August and September residue the audit found expires', () => {
    for (const p of [
      { original_check_out: '2026-08-29', adjusted_check_out: '2026-08-30' },
      { original_check_out: '2026-09-13', adjusted_check_out: '2026-09-14' },
      { original_check_out: '2026-10-04', adjusted_check_out: '2026-10-07' },
    ]) {
      assert.equal(isProposalExpired(p, TODAY), true, JSON.stringify(p));
    }
  });
  test('a future stay never expires', () => {
    assert.equal(isProposalExpired({ original_check_out: '2026-11-28', adjusted_check_out: '2026-11-29' }, TODAY), false);
  });
  test('an extension still running keeps the proposal', () => {
    assert.equal(isProposalExpired({ original_check_out: '2026-10-16', adjusted_check_out: '2026-10-19' }, TODAY), false);
  });
  test('a live booking that runs past today keeps the proposal', () => {
    assert.equal(isProposalExpired({ original_check_out: '2026-10-16', adjusted_check_out: null }, TODAY, '2026-10-18'), false);
  });
});

describe('the note', () => {
  test('names the day the stay ended', () => {
    assert.equal(expiredProposalNote('2026-09-14', TODAY), 'Expired: stay ended Sep 14');
  });
  test('carries the year only when it is not this year', () => {
    assert.equal(shortDay('2025-12-30', TODAY), 'Dec 30, 2025');
  });
  test('no em dashes', () => {
    assert.ok(!expiredProposalNote('2026-09-14', TODAY).includes('—'));
  });
});

describe('one rule, two callers, and restore is final', () => {
  test('the schedule page runs the sweep before it reads the list', () => {
    const src = read('src/app/turnovers/schedule/page.tsx');
    const sweep = src.indexOf('await expireStaleProposals(supabase, operatingDate())');
    const read_ = src.indexOf(".eq('status', 'proposed')");
    assert.ok(sweep > 0 && read_ > sweep, 'sweep, then read');
    assert.ok(src.includes(".not('dismissed_at', 'is', null)"), 'the fold reads only dismissed proposals');
    assert.ok(src.includes('restoreProposalAction'), 'the fold offers Restore');
  });
  test('the nightly cron runs the same sweep and is scheduled', () => {
    const src = read('src/app/api/cron/expire-queues/route.ts');
    assert.ok(src.includes('authorizeCron(request)'));
    assert.ok(src.includes('expireStaleProposals(supabase, today)'));
    const crons = (JSON.parse(read('vercel.json')).crons as Array<{ path: string }>).map((c) => c.path);
    assert.ok(crons.includes('/api/cron/expire-queues'));
  });
  test('the sweep never touches a restored row, and restore stamps it', () => {
    const lib = read('src/lib/schedule-proposal-expiry.ts');
    assert.equal(lib.split(".is('restored_at', null)").length - 1, 2, 'both the read and the write skip restored rows');
    const actions = read('src/app/turnovers/schedule/actions.ts');
    const restore = actions.slice(actions.indexOf('export async function restoreProposalAction'));
    assert.ok(restore.includes('restored_at: now'));
    assert.ok(restore.includes(".eq('status', 'dismissed')"));
  });
  test('a human dismissal lands in the fold too', () => {
    const actions = read('src/app/turnovers/schedule/actions.ts');
    const dismiss = actions.slice(actions.indexOf('export async function dismissProposalAction'), actions.indexOf('export async function restoreProposalAction'));
    assert.ok(dismiss.includes('dismissed_at: now'));
  });
});
