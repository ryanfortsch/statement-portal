/**
 * Every waiting card says why it waits (2026-10-18). Pure rule, plus the
 * wiring that hands it each queue's payload.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { guestAnsweredWhere, sendErrorWords, waitReason } from '../card-wait-reason.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

describe('why a card waits', () => {
  test('a queued send that failed says why and that it retries', () => {
    assert.deepEqual(waitReason({ status: 'scheduled', ageMinutes: 30, sendAttempts: 2, lastSendError: 'quo_error: 402 Payment Required' }), {
      tone: 'retrying',
      text: 'Not sent: the texting account is out of credit. Retrying (try 2 of 5).',
      detail: 'quo_error: 402 Payment Required',
    });
    assert.equal(waitReason({ status: 'scheduled', ageMinutes: 30, lastSendError: 'rate_limited' })?.text, 'Not sent yet: Guesty asked us to wait. It retries on its own.');
  });

  test('a send that gave up is back with you, never silently', () => {
    const r = waitReason({ status: 'pending', ageMinutes: 5, sendAttempts: 5, lastSendError: 'Quo refused the number' });
    assert.equal(r?.tone, 'failed');
    assert.equal(r?.text, 'Failed after 5 tries: Quo refused the number. Send again or mark handled.');
    assert.equal(waitReason({ status: 'pending', ageMinutes: 5, lastSendError: 'interrupted' })?.text, 'Sending was interrupted. Check the thread for whether it went out before you send again.');
    assert.equal(waitReason({ status: 'pending', ageMinutes: 5, lastSendError: 'newer_activity' })?.tone, 'held');
  });

  test('a stale draft says where it was probably answered', () => {
    assert.equal(waitReason({ status: 'pending', ageMinutes: 5 * 60 + 12, answeredWhere: 'Guesty' })?.text, 'Drafted 5h ago; check whether it was already answered in Guesty.');
    assert.equal(waitReason({ status: 'pending', ageMinutes: 72 * 60, answeredWhere: 'by text' })?.text, 'Drafted 3 days ago; check whether it was already answered by text.');
    assert.equal(waitReason({ status: 'pending', ageMinutes: 3 * 60, answeredWhere: 'Guesty' }), null, 'under four hours is not stale');
    assert.equal(waitReason({ status: 'scheduled', ageMinutes: 9 * 60 }), null, 'a queued card is waiting on its clock');
  });

  test('no draft says whether drafting is paused or the calendar did not answer', () => {
    assert.equal(waitReason({ status: 'pending', ageMinutes: 1, noDraft: true, aiPaused: { reason: 'Anthropic credit balance is empty.' } })?.text,
      'No draft: drafting is paused (Anthropic credit balance is empty). Write the reply yourself or wait for it to come back.');
    assert.equal(waitReason({ status: 'pending', ageMinutes: 1, noDraft: true, unverifiedHomes: 2 })?.text,
      'No draft: the calendar could not confirm 2 homes. Check availability before you price it.');
    assert.equal(waitReason({ status: 'pending', ageMinutes: 1, noDraft: false, aiPaused: {} }), null, 'a card with a draft is not waiting on the AI');
  });

  test('error words: codes become sentences, a sentence stays one', () => {
    assert.equal(sendErrorWords('channel_not_supported:email'), 'this channel cannot send from Helm');
    assert.equal(sendErrorWords('The field assignment changed or could not be verified.'), 'the field assignment changed or could not be verified');
    assert.ok(sendErrorWords('x'.repeat(200)).endsWith('…'));
    assert.equal(guestAnsweredWhere('helm:+15550100', 'sms'), 'by text');
    assert.equal(guestAnsweredWhere('abc123', 'email'), 'by email');
    assert.equal(guestAnsweredWhere('abc123', 'airbnb2'), 'Guesty');
  });

  test('every queue hands its card the reason', () => {
    for (const file of [
      'src/app/messaging/MessagingQueue.tsx',
      'src/app/owner-messaging/OwnerMessagingQueue.tsx',
      'src/app/cleaner-messaging/CleanerCard.tsx',
      'src/app/contractor-messaging/ContractorCard.tsx',
    ]) {
      const src = read(file);
      assert.ok(src.includes('wait={waitReason({') || src.includes('wait: waitReason({'), `${file} does not say why its card waits`);
      assert.ok(src.includes('lastSendError: approval.last_send_error'), `${file} drops the send failure`);
    }
    assert.ok(read('src/components/messaging/card/ApprovalCard.tsx').includes('<WaitLine wait={wait} />'), 'the card prints it');
  });
});
