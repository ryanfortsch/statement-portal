/**
 * A waiting card says why it waits only when someone has to act (2026-10-18,
 * cut back 2026-10-19). Pure rule, plus the wiring that hands it each queue's
 * payload.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sendErrorWords, waitReason } from '../card-wait-reason.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

describe('why a card waits, only when someone has to act', () => {
  test('a queued send that is retrying says nothing, unless no retry can fix it', () => {
    assert.equal(waitReason({ status: 'scheduled', lastSendError: 'rate_limited' }), null);
    assert.equal(waitReason({ status: 'scheduled', lastSendError: 'quo_error: 500' }), null);
    assert.deepEqual(waitReason({ status: 'scheduled', lastSendError: 'quo_error: 402 Payment Required' }), {
      tone: 'failed',
      text: 'Not sent: the texting account is out of credit.',
      detail: 'quo_error: 402 Payment Required',
    });
  });

  test('a send that gave up is back with you, in one short line', () => {
    const r = waitReason({ status: 'pending', lastSendError: 'Quo refused the number.' });
    assert.equal(r?.tone, 'failed');
    assert.equal(r?.text, 'Not sent: quo refused the number.');
    assert.equal(waitReason({ status: 'pending', lastSendError: 'interrupted' })?.text, 'May have sent. Check the thread first.');
    assert.equal(waitReason({ status: 'pending', lastSendError: 'newer_activity' })?.text, 'They wrote again. Check the reply still fits.');
  });

  test('an old draft says nothing: its age is already on the card', () => {
    assert.equal(waitReason({ status: 'pending' }), null);
    assert.equal(waitReason({ status: 'scheduled' }), null);
    assert.ok(!/check whether it was already answered|Retrying|try \d of/.test(read('src/lib/card-wait-reason.ts')), 'no stale or retry sentence comes back');
  });

  test('no draft says so in a few words', () => {
    assert.equal(waitReason({ status: 'pending', noDraft: true, aiPaused: { reason: 'Anthropic credit balance is empty.' } })?.text, 'No draft: drafting is paused.');
    assert.equal(waitReason({ status: 'pending', noDraft: true, unverifiedHomes: 2 })?.text, 'No draft: check availability first.');
    assert.equal(waitReason({ status: 'pending', noDraft: false, aiPaused: {} }), null, 'a card with a draft is not waiting on the AI');
  });

  test('error words: codes become sentences, a sentence stays one', () => {
    assert.equal(sendErrorWords('channel_not_supported:email'), 'this channel cannot send from Helm');
    assert.equal(sendErrorWords('The field assignment changed or could not be verified.'), 'the field assignment changed or could not be verified');
    assert.ok(sendErrorWords('x'.repeat(200)).endsWith('…'));
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
