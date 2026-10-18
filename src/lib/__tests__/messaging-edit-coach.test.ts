/**
 * Edit and Coach are a pair on the guest card (2026-10-17): both change the
 * reply, one teaches. The difference is stated once, as text, in whichever
 * drawer is open. Before this it lived in a placeholder that vanished on the
 * first keystroke, and Edit was a 10px link on the reply header while Coach
 * was a button. Reads the source: each link deletes in one line.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The guest card is the one approval card since 2026-10-18: the drawers and
// the Edit / Coach pair live there, the copy-to-send footer in the wrapper.
const card = readFileSync(new URL('../../components/messaging/card/ApprovalCard.tsx', import.meta.url), 'utf8');
const guest = readFileSync(new URL('../../app/messaging/MessagingQueue.tsx', import.meta.url), 'utf8');

describe('Edit and Coach on the guest card', () => {
  test('the contract is printed in both drawers, as text', () => {
    assert.ok(card.includes('Edit changes this reply only.'), 'the contract names Edit');
    assert.ok(card.includes('Coach rewrites it and teaches the AI.'), 'the contract names Coach');
    const uses = card.match(/<EditCoachContract \/>/g) ?? [];
    assert.equal(uses.length, 2, 'the contract renders once in the editor and once in the coach drawer');
    for (const src of [card, guest]) assert.ok(!/placeholder="[^"]*learn[^"]*"/.test(src), 'the difference is not in a placeholder');
  });

  test('Edit is a footer button at the weight of Coach, not an eyebrow link', () => {
    assert.ok(!guest.includes('title="Edit the reply text yourself'), 'the eyebrow Edit link is gone');
    assert.ok(/editing \? 'Cancel edit' : 'Edit'/.test(card), 'Edit toggles like Coach');
    assert.ok(card.includes("showCoach ? 'Cancel coaching' : 'Coach the AI'"));
    assert.ok(/\{editPart\}\s*\{coachPart\}/.test(card), 'Edit sits beside Coach in the standard footer');
    assert.ok(guest.includes('{ctl.parts.edit}'), 'Edit is on the copy-to-send card too');
  });
});
