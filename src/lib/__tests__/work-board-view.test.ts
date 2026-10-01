import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareWork, workOverdue, workSignals, workUnassigned } from '../work-board-view.ts';
import { operatingDate } from '../operating-date.ts';

const today = '2026-09-30';
const base = { status: 'open' as const, priority: 'normal' as const, created_at: '2026-09-01T12:00:00Z', assigned_to_email: 'example@example.test' };

test('the operating day stays in Eastern time after midnight UTC and across year boundaries', () => {
  assert.equal(operatingDate(new Date('2026-10-01T02:00:00Z')), '2026-09-30');
  assert.equal(operatingDate(new Date('2027-01-01T04:59:59Z')), '2026-12-31');
  assert.equal(operatingDate(new Date('2027-01-01T05:00:00Z')), '2027-01-01');
});

test('the operating day follows both daylight-saving transitions', () => {
  for (const instant of ['2026-03-08T06:59:59Z', '2026-03-08T07:00:00Z']) assert.equal(operatingDate(new Date(instant)), '2026-03-08');
  for (const instant of ['2026-11-01T05:59:59Z', '2026-11-01T06:00:00Z']) assert.equal(operatingDate(new Date(instant)), '2026-11-01');
  assert.equal(operatingDate(new Date('2026-03-09T03:59:59Z')), '2026-03-08');
  assert.equal(operatingDate(new Date('2026-03-09T04:00:00Z')), '2026-03-09');
});

test('overdue and blocked work outrank routine backlog, on slips and tasks', () => {
  const items = [
    { ...base, id: 'routine' },
    { ...base, id: 'unassigned', assigned_to_email: null },
    { ...base, id: 'high', priority: 'high' as const },
    { ...base, id: 'today', due_date: today, priority: 'medium' as const },
    { ...base, id: 'blocked', status: 'blocked' as const },
    { ...base, id: 'overdue', scheduled_date: '2026-09-29' },
  ];
  assert.deepEqual(items.sort((a,b) => compareWork(a,b,today)).map(i => i.id), ['overdue', 'blocked', 'today', 'high', 'unassigned', 'routine']);
});

test('due dates distinguish yesterday, today, tomorrow, and undated work', () => {
  assert.equal(workOverdue({ ...base, scheduled_date: '2026-09-29' }, today), true);
  assert.equal(workOverdue({ ...base, due_date: '2026-09-29' }, today), true);
  for (const due_date of [null, today, '2026-10-01']) assert.equal(workOverdue({ ...base, due_date }, today), false);
});

test('owners and named vendors are never counted as unassigned', () => {
  const noEmail = { ...base, assigned_to_email: null };
  assert.equal(workUnassigned({ ...noEmail, assigned_to_type: 'owner' }), false);
  assert.equal(workUnassigned({ ...noEmail, assigned_to_type: 'unassigned', assigned_to_label: 'Example HVAC' }), false);
  assert.equal(workUnassigned(base), false);
  assert.equal(workUnassigned({ ...noEmail, assigned_to_type: 'unassigned' }), true);
  assert.equal(workUnassigned(noEmail), true);
});

test('filter counts describe separate actionable sets without inventing a combined total', () => {
  const items = [
    { ...base, status: 'blocked' as const, scheduled_date: '2026-09-29', assigned_to_email: null, assigned_to_type: 'unassigned' as const },
    { ...base, due_date: today, priority: 'medium' as const },
    { ...base, scheduled_date: today, assigned_to_email: null, assigned_to_type: 'owner' as const },
    { ...base, scheduled_date: '2026-10-01', assigned_to_email: null, assigned_to_label: 'Example HVAC' },
  ];
  assert.deepEqual(workSignals(items, today), { overdue: 1, blocked: 1, dueToday: 2, unclaimed: 1 });
  assert.deepEqual(workSignals(items.slice(1), today), { overdue: 0, blocked: 0, dueToday: 2, unclaimed: 0 });
});
