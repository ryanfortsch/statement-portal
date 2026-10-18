/**
 * One approval card for every messaging queue (Phase 3, 2026-10-18).
 *
 * Four queues used to hand-build four cards for the same decision, and they
 * drifted: Edit on two, Redraft and Undo on one, hidden single-key shortcuts
 * on another. Now each queue wraps components/messaging/card/ApprovalCard
 * with its own blocks and its own server actions, and the verbs, drawers and
 * safety rails live in one place. These checks read the source, because each
 * link is one line that deletes cleanly.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const CARD = 'src/components/messaging/card/ApprovalCard.tsx';

/** Queues on the one card, with their actions file and page. */
const MIGRATED: { queue: string; actions: string; page: string; undo: string }[] = [
  {
    queue: 'src/app/contractor-messaging/ContractorMessagingQueue.tsx',
    actions: 'src/app/contractor-messaging/actions.ts',
    page: 'src/app/contractor-messaging/page.tsx',
    undo: 'undoContractorDecision',
  },
  {
    queue: 'src/app/cleaner-messaging/CleanerMessagingQueue.tsx',
    actions: 'src/app/cleaner-messaging/actions.ts',
    page: 'src/app/cleaner-messaging/page.tsx',
    undo: 'undoCleanerDecision',
  },
  {
    queue: 'src/app/owner-messaging/OwnerMessagingQueue.tsx',
    actions: 'src/app/owner-messaging/actions.ts',
    page: 'src/app/owner-messaging/page.tsx',
    undo: 'undoOwnerDecision',
  },
];

describe('the one approval card', () => {
  test('offers every verb: send with Send later, Edit, Coach, Redraft, Mark handled', () => {
    const card = read(CARD);
    assert.ok(card.includes("approveLabel || 'Approve & send'"), 'Approve & send');
    assert.ok(card.includes('<SplitSendButton'), 'the send control carries the Send later chevron');
    assert.ok(read('src/components/ScheduleSend.tsx').includes('aria-label="Send later"'));
    assert.ok(card.includes("{editing ? 'Cancel edit' : 'Edit'}"), 'Edit toggles like Coach');
    assert.ok(card.includes("{showCoach ? 'Cancel coaching' : 'Coach the AI'}"));
    assert.ok(/>\s*Redraft\s*</.test(card), 'Redraft');
    assert.ok(card.includes("{showHandled ? 'Cancel' : 'Mark handled'}"), 'Mark handled opens the reasons');
  });

  test('the Edit and Coach contract is printed in both drawers, as text', () => {
    const card = read(CARD);
    assert.ok(card.includes('Edit changes this reply only.') && card.includes('Coach rewrites it and teaches the AI.'));
    assert.equal((card.match(/<EditCoachContract \/>/g) ?? []).length, 2);
    assert.ok(!/placeholder="[^"]*learn[^"]*"/.test(card), 'the difference is never only in a placeholder');
  });

  test('what an open, changed editor holds is what sends', () => {
    const card = read(CARD);
    assert.ok(card.includes("label={editDirty ? 'Save & send'"), 'the send button says it saves first');
    assert.ok(/const saved = await persistEdit\(text\);\s*return saved\.ok \? send\(\) : saved;/.test(card), 'approve saves the edit, then sends');
    assert.ok(/const saved = await persistEdit\(text\);\s*return saved\.ok \? queue\(sendAtIso\) : saved;/.test(card), 'Send later saves the edit, then queues');
    assert.ok(card.includes("(e.metaKey || e.ctrlKey) && e.key === 'Enter'"), 'Cmd+Enter in the editor sends');
  });

  test('the undo toast survives the queue emptying', () => {
    const queue = read('src/components/messaging/card/ApprovalQueue.tsx');
    assert.ok(queue.indexOf('</Section>') < queue.indexOf('<UndoToast'), 'the toast renders outside the Section, which hides its children when empty');
  });

  test('the cleaner card edits the Portuguese and shows the English beside it', () => {
    const q = read('src/app/cleaner-messaging/CleanerMessagingQueue.tsx');
    assert.ok(q.includes('saveEdit: (text) => editCleanerDraft(id, text)'), 'Edit on the Portuguese');
    assert.ok(q.includes('<EnglishLine text={approval.draft_english} translating={approval.draft_translating} />'), 'the English follows an edit');
    assert.ok(!/placeholder="[^"]*Portuguese/.test(q), 'the language note is printed text, not a placeholder');
  });

  test('the owner card reads in order and its edit is explicit', () => {
    const q = read('src/app/owner-messaging/OwnerMessagingQueue.tsx');
    assert.ok(q.includes('layout="stacked"') && q.includes('between={<Envelope envelope={approval.envelope} />}'), 'owner said, then where it goes, then the reply');
    assert.ok(!q.includes('<textarea'), 'no always-editable reply: a stray keystroke no longer changes what sends');
    assert.ok(q.includes('proposedActionItems(proposedActions, fileActions, setFileActions)'), 'follow-up work is Also on approve');
  });

  test('a line of Also on approve that needs an answer opens by itself', () => {
    const also = read('src/components/messaging/card/AlsoOnApprove.tsx');
    assert.ok(also.includes('const showBodies = open || needsAnswer;'));
  });

  for (const q of MIGRATED) {
    test(`${q.queue.split('/').pop()} is on the one card, with every rail`, () => {
      const queue = read(q.queue);
      assert.ok(queue.includes('<ApprovalCard'), 'renders the one card');
      assert.ok(queue.includes('<ApprovalQueue'), 'renders the one queue');
      assert.ok(!queue.includes('rt-message-actions'), 'no hand-built footer');
      assert.ok(queue.includes('saveEdit:') && queue.includes('redraft:') && queue.includes('coach:'), 'wires Edit, Redraft and Coach');
      assert.ok(queue.includes(`undo={${q.undo}}`), 'wires Undo');
      const actions = read(q.actions);
      for (const verb of [q.undo, 'edit', 'redraft']) {
        assert.ok(new RegExp(`export async function ${verb === q.undo ? verb : `${verb}\\w*Draft`}\\b`).test(actions), `${q.actions} exports ${verb}`);
      }
      assert.ok(read(q.page).includes(`<DecidedRecently items={items} undo={${q.undo}} />`), 'the page keeps a Decided recently ledger');
    });
  }
});
