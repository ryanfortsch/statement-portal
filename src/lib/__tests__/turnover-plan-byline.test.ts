import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { creditsPlannedWalk } from '../../app/turnovers/turnover-format.ts';

const plan = (assigned: string | null, date: string | null = '2026-10-16') => ({
  id: 'p1',
  planned_for_date: date,
  notes: null,
  planned_by_email: 'ryan@risingtidestr.com',
  assigned_to_email: assigned,
});

test('an assigned walk keeps its name through the prep window, the viewer\'s own included', () => {
  assert.equal(creditsPlannedWalk(plan('ryan@risingtidestr.com'), true), true);
  assert.equal(creditsPlannedWalk(plan('delaney@risingtidestr.com'), true), true);
  assert.equal(creditsPlannedWalk(plan('ryan@risingtidestr.com'), false), true);
});

test('an unassigned plan reads "Planned" until it is due, then yields to Start', () => {
  assert.equal(creditsPlannedWalk(plan(null), false), true);
  assert.equal(creditsPlannedWalk(plan(null), true), false);
  assert.equal(creditsPlannedWalk(plan('   '), true), false);
});

test('no plan, or a plan with no date, is never credited', () => {
  assert.equal(creditsPlannedWalk(null, false), false);
  assert.equal(creditsPlannedWalk(plan('ryan@risingtidestr.com', null), false), false);
});

test('a credited walk still offers Start in the expanded row', () => {
  // Without this the assignee of a self-assigned walk has no way to begin it
  // from the row: the collapsed action is their own name.
  const src = readFileSync(new URL('../../app/turnovers/CompactTurnoverRow.tsx', import.meta.url), 'utf8');
  assert.match(src, /\{bylineWalk && \(\s*<form action=\{startInspection\}/);
  assert.match(src, /const bylineWalk =[\s\S]*?creditsPlannedWalk\(t\.plan, due\)/);
});
