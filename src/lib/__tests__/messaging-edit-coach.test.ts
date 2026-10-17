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

const src = readFileSync(new URL('../../app/messaging/MessagingQueue.tsx', import.meta.url), 'utf8');

describe('Edit and Coach on the guest card', () => {
  test('the contract is printed in both drawers, as text', () => {
    assert.ok(src.includes('Edit changes this reply only.'), 'the contract names Edit');
    assert.ok(src.includes('Coach rewrites it and teaches the AI.'), 'the contract names Coach');
    const uses = src.match(/<EditCoachContract \/>/g) ?? [];
    assert.equal(uses.length, 2, 'the contract renders once in the editor and once in the coach drawer');
    assert.ok(!/placeholder="[^"]*learn[^"]*"/.test(src), 'the difference is not in a placeholder');
  });

  test('Edit is a footer button at the weight of Coach, not an eyebrow link', () => {
    assert.ok(!src.includes('title="Edit the reply text yourself'), 'the eyebrow Edit link is gone');
    const footerEdits = src.match(/<EditButton editing=\{editing\}/g) ?? [];
    assert.ok(footerEdits.length >= 2, 'Edit sits in the main footer and on the copy-to-send card');
    assert.ok(/editing \? 'Cancel edit' : 'Edit'/.test(src), 'Edit toggles like Coach');
    assert.ok(src.includes("showCoach ? 'Cancel coaching' : 'Coach the AI'"));
  });
});
