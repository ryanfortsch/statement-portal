import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueThisWeek, workWeekEnd } from '../work-week.ts';
import { workThisWeek } from '../work-board-view.ts';

test('this week runs from today through the sixth day after, overdue included', () => {
  assert.equal(workWeekEnd('2026-10-18'), '2026-10-24');
  assert.equal(workWeekEnd('2026-12-29'), '2027-01-04');
  assert.ok(dueThisWeek('2026-10-24', '2026-10-18'));
  assert.ok(dueThisWeek('2026-09-01', '2026-10-18'), 'overdue counts');
  assert.ok(!dueThisWeek('2026-10-25', '2026-10-18'));
  assert.ok(!dueThisWeek(null, '2026-10-18'), 'undated work is the backlog');
});

test('the home and the board end the week on the same day', () => {
  const today = '2026-10-18';
  const end = workWeekEnd(today);
  const item = (scheduled_date: string) => ({ status: 'open', priority: 'normal', created_at: '', assigned_to_email: null, scheduled_date });
  assert.ok(workThisWeek(item(end) as never, today));
  assert.ok(!workThisWeek(item('2026-10-25') as never, today));
});
