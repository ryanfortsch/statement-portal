/**
 * The launch checklist stops following an established home around
 * (src/lib/launch-checklist.ts launchBoardGroup / launchChecklistVisible).
 * The property page's Now chip and Facts footer line and the onboarding
 * board read one rule; the guards at the bottom keep them reading it.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LAUNCH_STEPS,
  launchBoardGroup,
  launchChecklistVisible,
  requiredOpenSteps,
  type EffectiveLaunchStep,
} from '../launch-checklist.ts';

const read = (repoPath: string): string => readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

describe('launchBoardGroup', () => {
  test('no checklist rows: not tracked, whatever the summary says', () => {
    assert.equal(launchBoardGroup(false, { live: true, requiredRemaining: 13 }), 'untracked');
  });
  test('gate open: in flight', () => {
    assert.equal(launchBoardGroup(true, { live: false, requiredRemaining: 13 }), 'in_flight');
  });
  test('live with a required step open: loose ends', () => {
    assert.equal(launchBoardGroup(true, { live: true, requiredRemaining: 1 }), 'loose_ends');
  });
  test('live and nothing required open: complete', () => {
    assert.equal(launchBoardGroup(true, { live: true, requiredRemaining: 0 }), 'complete');
  });
});

describe('launchChecklistVisible', () => {
  test('a home being brought online always shows it', () => {
    for (const g of ['untracked', 'in_flight', 'loose_ends', 'complete'] as const) {
      assert.equal(launchChecklistVisible(false, g), true, g);
    }
  });
  test('21 Horton: established and never tracked, no chip', () => {
    assert.equal(launchChecklistVisible(true, 'untracked'), false);
  });
  test('an established home the board calls complete: no chip', () => {
    assert.equal(launchChecklistVisible(true, 'complete'), false);
  });
  test('an established home with a required step open keeps it', () => {
    assert.equal(launchChecklistVisible(true, 'loose_ends'), true);
    assert.equal(launchChecklistVisible(true, 'in_flight'), true);
  });
});

describe('requiredOpenSteps', () => {
  test('required, unresolved, gate excluded, checklist order', () => {
    const effective: EffectiveLaunchStep[] = LAUNCH_STEPS.map((step) => ({
      step,
      row: null,
      status: 'todo',
      resolved: !step.required || step.key === 'owner_contact_confirmed',
      auto: false,
    }));
    const open = requiredOpenSteps(effective);
    assert.ok(open.length > 0);
    assert.ok(open.every((s) => s.required && !s.gate));
    assert.ok(!open.some((s) => s.key === 'owner_contact_confirmed'));
    const order = LAUNCH_STEPS.map((s) => s.key);
    assert.deepEqual(open.map((s) => s.key), order.filter((k) => open.some((s) => s.key === k)));
  });
});

describe('one rule on the page and the board', () => {
  test('the Now chip and the Facts footer line are both gated', () => {
    const src = read('src/app/properties/[id]/page.tsx');
    assert.ok(src.includes('launchChecklistVisible(\n    !showSetup,\n    launchBoardGroup(launchLoad.rows.length > 0, launchProgress),\n  )'));
    assert.ok(src.includes('{showLaunchChecklist && ('), 'the Now chip');
    assert.ok(src.includes('{!showSetup && showLaunchChecklist && ('), 'the Facts footer line');
  });
  test('the board groups with the same rule, lists only required open steps for loose ends, and has no stat strip', () => {
    const src = read('src/app/properties/onboarding/page.tsx');
    assert.ok(src.includes('launchBoardGroup(r.load.rows.length > 0, r.load.summary)'));
    assert.ok(src.includes('requiredOpenSteps(load.effective)'));
    assert.ok(/rows=\{looseEnds\}[\s\S]{0,120}requiredOnly/.test(src));
    assert.ok(!src.includes('Open required steps'), 'the group counts say it');
    assert.ok(!src.includes('rt-helm-stat-strip'));
  });
});
