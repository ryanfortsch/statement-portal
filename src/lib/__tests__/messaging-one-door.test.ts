/**
 * One door for "no reply" on the four messaging queues (2026-10-17).
 *
 * Reject read as "reject this wording" and meant the guest was never answered;
 * a 65 Calderwood lead went unanswered that way in September, and the same
 * decision had five names across the cluster (Reject, Dismiss, Skipped,
 * "no reply needed", Mark handled > Not worth a reply). Now Mark handled is
 * the one verb, its drawer carries the reasons, and the word that echoes the
 * decision back is Handled everywhere: the toast, the Decided recently ledger,
 * search and the thread chip.
 *
 * Each link is one line that deletes cleanly, so this reads the source.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { approvalSearchStatus } from '../inbox-search.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const QUEUES = [
  'src/app/messaging/MessagingQueue.tsx',
  'src/app/owner-messaging/OwnerMessagingQueue.tsx',
  'src/app/cleaner-messaging/CleanerMessagingQueue.tsx',
  'src/app/contractor-messaging/ContractorMessagingQueue.tsx',
];
const ACTIONS = [
  'src/app/messaging/actions.ts',
  'src/app/owner-messaging/actions.ts',
  'src/app/cleaner-messaging/actions.ts',
  'src/app/contractor-messaging/actions.ts',
];

describe('one door for no reply', () => {
  test('no queue offers a Reject verb, and no page action rejects', () => {
    for (const path of QUEUES) {
      const src = read(path);
      assert.ok(!/>\s*Reject\s*</.test(src) && !/'Reject'/.test(src), `${path} still offers Reject`);
      assert.ok(!/\breject[A-Z]\w*Draft\b/.test(src), `${path} still wires a reject action`);
      assert.ok(/Mark handled/.test(src), `${path} lost the one door`);
    }
    for (const path of ACTIONS) {
      assert.ok(!/export async function reject/.test(read(path)), `${path} still exports a reject action`);
    }
  });

  test('the owner card has no bare-key shortcuts; Cmd+Enter in the draft still sends', () => {
    const src = read('src/app/owner-messaging/OwnerMessagingQueue.tsx');
    assert.ok(!/k === '[achr]'/.test(src), 'a bare key must never fire a decision on an owner card');
    assert.ok(!/e\.key\.toLowerCase\(\)/.test(src), 'no single-key dispatch');
    assert.ok(src.includes("(e.metaKey || e.ctrlKey) && e.key === 'Enter'"), 'Cmd+Enter from the draft field still sends');
  });

  test('Handled is the one word: toast, ledger, search, thread, strips, notes', () => {
    assert.equal(approvalSearchStatus({ id: '1', status: 'rejected' }, false).status, 'Handled');
    assert.equal(approvalSearchStatus({ id: '1', status: 'manual_sent' }, false).status, 'Handled');
    assert.ok(read('src/app/messaging/UndoToast.tsx').includes("const LABEL = 'Handled'"), 'the toast says Handled');
    const ledger = read('src/app/messaging/RecentDecisions.tsx');
    assert.ok(/rejected: 'Handled'/.test(ledger) && /manual_sent: 'Handled'/.test(ledger), 'Decided recently says Handled');
    const thread = read('src/app/messaging/Thread.tsx');
    assert.ok(/case 'manual_sent':\s*case 'rejected':\s*return 'handled'/.test(thread), 'the thread chip says handled');
    assert.ok(/rejected: 'Handled'/.test(read('src/app/messaging/RecentStrip.tsx')), 'the activity strip calls a legacy reject something else');
    const notes = read('src/lib/message-outcomes.ts');
    assert.ok(/rejected: 'Handled'/.test(notes) && /manual_sent: 'Handled'/.test(notes), 'a note readout says Handled');
  });

  test('the guest handled drawer carries the reasons Reject folded into, and Skip', () => {
    const src = read('src/app/messaging/MessagingQueue.tsx');
    assert.ok(src.includes("['Already answered', 'Guest said thanks', 'Not worth a reply']"), 'the reasons are the fixed set the rollup reads back');
    assert.ok(/Skip\s*<\/button>/.test(src), 'Skip clears without a reason');
    assert.ok(src.includes("NO_REPLY_REASONS.filter((r) => r !== 'Guest said thanks')"), 'a proactive card drops the reason that needs a guest message');
  });
});
