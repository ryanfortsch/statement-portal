/**
 * The prospect workroom has one manual override, "Done outside Helm", on
 * each stage that can finish somewhere Helm cannot see: the projection
 * (sent by text or by hand), the contract (signed on paper), onboarding
 * (the intake given by phone). Same words, same Undo, no explanation under
 * it. Four differently named overrides, each with its own italic sentence,
 * is what this replaced.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const page = read('src/app/prospects/[id]/page.tsx');

test('one control per stage, three stages', () => {
  const uses = page.match(/<DoneOutsideHelm\b[^>]*\/>/g) ?? [];
  assert.equal(uses.length, 3);
  for (const u of uses) assert.match(u, /mark=\{[^}]+\}[\s\S]*undo=\{[^}]+\}/, 'every stage carries its Undo');
  assert.match(page, /mark=\{send\}[\s\S]*?undo=\{unsend\}/);
  assert.match(page, /mark=\{markContractDone\} undo=\{unmarkContractDone\}/);
  assert.match(page, /mark=\{markOnboardingDone\} undo=\{unmarkOnboardingDone\}/);
});

test('the old names and their explanations are gone', () => {
  for (const gone of [
    'Mark as sent',
    'Mark contract complete',
    'Mark onboarding complete',
    'Marked complete',
    'Manual override',
    'Use when the contract was executed outside',
    'gathered the property info another way',
  ]) {
    assert.ok(!page.includes(gone), `still on the page: ${gone}`);
  }
});

test('the control says the same thing on every stage', () => {
  const control = read('src/components/projections/DoneOutsideHelm.tsx');
  assert.match(control, /export const DONE_OUTSIDE_HELM = 'Done outside Helm'/);
  assert.match(control, /label="Undo"/);
  assert.doesNotMatch(control, /fontStyle: 'italic'/);
});

test('a hand-marked send can be undone, and only a hand mark', () => {
  const actions = read('src/app/projections/actions.ts');
  const start = actions.indexOf('export async function unmarkSent(');
  assert.ok(start >= 0);
  const body = actions.slice(start, actions.indexOf('\nexport ', start + 1));
  assert.match(body, /update\(\{ status: 'draft', sent_at: null \}\)/);
  assert.match(body, /\.eq\('status', 'sent'\)/);
});
