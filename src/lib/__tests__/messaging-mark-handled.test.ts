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
    for (const q of ['src/app/messaging/MessagingQueue.tsx', 'src/app/owner-messaging/OwnerMessagingQueue.tsx', 'src/app/cleaner-messaging/CleanerCard.tsx', 'src/app/contractor-messaging/ContractorCard.tsx']) {
      const src = read(q);
      assert.ok(!src.includes('<summary>More actions</summary>'), `${q} still hides Mark handled in a menu`);
      assert.ok(src.includes('className="rt-message-quiet"') || src.includes('<ApprovalCard'), `${q} lost the quiet exits on the card`);
    }
  });

  test('guests: one tap per reason, Undo after, paste optional and still a reason', () => {
    // The drawer is the one card's since 2026-10-18; the guest card hands it
    // its reasons and its undo.
    const src = read('src/components/messaging/card/ApprovalCard.tsx');
    assert.ok(src.includes('onClick={() => markHandled({ reason })}'));
    assert.ok(src.includes("markHandled({ sent_text: sentText, reason: 'Already answered' })"), 'a pasted reply records its reason too');
    assert.ok(src.includes("{showPaste ? 'Hide' : 'Paste what you sent'}"), 'paste is behind its own link');
    assert.ok(src.includes('onDecided({ id, name, property });'), 'the undo toast still follows');
    assert.ok(!/>\s*Skip\s*</.test(src), 'no Skip: the three reasons cover it');
    const guest = read('src/app/messaging/MessagingQueue.tsx');
    assert.ok(guest.includes('handledReasons={noReplyReasons}') && guest.includes('undo={undoDecision}'), 'the guest card wires its reasons and its undo');
  });

  test('owners, cleaners, contractors: one tap with Undo, like guests', () => {
    // Since 2026-10-18 the concierge keeps an undo for every audience (#88),
    // so every queue gets the guest flow on the one card: a reason in one
    // tap, then the toast. The two-tap "Sure? Mark handled" button, which
    // stood in for a missing undo, is gone.
    for (const q of ['src/app/owner-messaging/OwnerMessagingQueue.tsx', 'src/app/cleaner-messaging/CleanerCard.tsx', 'src/app/contractor-messaging/ContractorCard.tsx']) {
      const src = read(q);
      assert.ok(src.includes('<ApprovalCard'), `${q} is not on the one card`);
      assert.ok(src.includes('handledReasons='), `${q} renders the card without its reasons`);
      assert.ok(!src.includes('<HandledConfirm'), `${q} still asks twice`);
    }
    assert.ok(/undo=\{undoOwnerDecision\}/.test(read('src/app/owner-messaging/OwnerMessagingQueue.tsx')), 'the owner queue lost its undo');
    const team = read('src/app/messaging/team/TeamInboxQueue.tsx');
    assert.ok(team.includes("undo={(id, kind) => (kind === 'contractor' ? undoContractorDecision(id) : undoCleanerDecision(id))}"), 'the Team inbox undoes each card with its own audience');
    const card = read('src/components/messaging/card/ApprovalCard.tsx');
    assert.ok(card.includes('onClick={() => markHandled({ reason })}'), 'a reason is one tap on the card');
    assert.ok(card.includes('onDecided({ id, name, property });'), 'the undo toast follows a Mark handled');
  });
});
