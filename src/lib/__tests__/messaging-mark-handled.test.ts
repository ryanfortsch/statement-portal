/**
 * Mark handled is on the card, and quick (2026-10-18, Dotti: "a streamlined
 * flow of marking handled"). Guests: one tap opens a row of reasons, one tap
 * on a reason clears the card with Undo; pasting what she sent is an option,
 * not the headline. Owners, cleaners, contractors: no More actions menu; the
 * button asks once ("Sure? Mark handled"), since those queues have no undo.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

describe('Mark handled, streamlined', () => {
  test('no queue hides its exits in a More actions menu', () => {
    const card = read('src/components/messaging/card/ApprovalCard.tsx');
    assert.ok(card.includes('className="rt-message-quiet"'), 'the one card lost its quiet exits');
    for (const q of ['src/app/messaging/MessagingQueue.tsx', 'src/app/owner-messaging/OwnerMessagingQueue.tsx', 'src/app/cleaner-messaging/CleanerMessagingQueue.tsx', 'src/app/contractor-messaging/ContractorMessagingQueue.tsx']) {
      const src = read(q);
      assert.ok(!src.includes('<summary>More actions</summary>'), `${q} still hides Mark handled in a menu`);
      assert.ok(src.includes('className="rt-message-quiet"') || src.includes('<ApprovalCard'), `${q} lost the quiet exits on the card`);
    }
  });

  test('guests: one tap per reason, Undo after, paste optional and still a reason', () => {
    const src = read('src/app/messaging/MessagingQueue.tsx');
    assert.ok(src.includes('onClick={() => handleMarkHandled({ reason })}'));
    assert.ok(src.includes("handleMarkHandled({ sent_text: sentText, reason: 'Already answered' })"), 'a pasted reply records its reason too');
    assert.ok(src.includes("{showPaste ? 'Hide' : 'Paste what you sent'}"), 'paste is behind its own link');
    assert.ok(src.includes('onDecided({ id: approval.id, guest: guestLabel, property: propertyLabel });'), 'the undo toast still follows');
    assert.ok(!/>\s*Skip\s*</.test(src), 'no Skip: the three reasons cover it');
  });

  test('owners, cleaners, contractors: one tap with Undo on the one card, else the button asks once', () => {
    // Since 2026-10-18 the concierge keeps an undo for every audience (#88),
    // so a queue on the one card gets the guest flow: a reason in one tap,
    // then the toast. A queue not yet moved keeps the two-tap button.
    const confirm = read('src/components/HandledConfirm.tsx');
    assert.ok(confirm.includes("armed ? 'Sure? Mark handled' : 'Mark handled'"));
    for (const q of ['src/app/owner-messaging/OwnerMessagingQueue.tsx', 'src/app/cleaner-messaging/CleanerMessagingQueue.tsx', 'src/app/contractor-messaging/ContractorMessagingQueue.tsx']) {
      const src = read(q);
      if (src.includes('<ApprovalCard')) {
        assert.ok(src.includes('handledReasons='), `${q} renders the card without its reasons`);
        assert.ok(/undo=\{undo\w+Decision\}/.test(src), `${q} renders the queue without its undo`);
      } else {
        assert.ok(src.includes('<HandledConfirm'), `${q} does not use the two-tap button`);
      }
    }
    const card = read('src/components/messaging/card/ApprovalCard.tsx');
    assert.ok(card.includes('onClick={() => markHandled({ reason })}'), 'a reason is one tap on the card');
    assert.ok(card.includes('onDecided({ id, name, property });'), 'the undo toast follows a Mark handled');
  });
});
