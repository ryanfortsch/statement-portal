import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collapseWorkIssues, relatedReportReason, type IssueReport } from '../work-issues.ts';
import { workAssignedTo, workNeedsAction, workScheduled, workWaiting, workBacklog } from '../work-board-view.ts';

const report = (id: string, patch: Partial<IssueReport> = {}): IssueReport => ({ id, property_id: 'home', title: 'Upstairs toilet running', description: 'Original evidence', status: 'open', location: 'upstairs bathroom', organize_group: null, organize_group_label: null, from_supply_key: null, from_prep_rule_key: null, from_guest_request_key: null, created_at: '2026-10-01', ...patch });
const work = { ...report('a'), priority: 'normal' as const, assigned_to_email: null, coordinator_email: null, scheduled_date: null, follow_up_date: null };
const links = [{ report_id: 'a', issue_id: 'a' }, { report_id: 'b', issue_id: 'a' }];
const today = '2026-10-30';

test('suggestions require matching evidence and never join reports by themselves', () => {
  assert.ok(relatedReportReason(report('a'), report('b')));
  assert.equal(relatedReportReason(report('a'), report('b', { property_id: 'elsewhere' })), null);
  assert.equal(relatedReportReason(report('a'), report('b', { status: 'done' })), null);
  assert.equal(relatedReportReason(report('a'), report('b', { from_supply_key: 'soap' })), null);
  assert.equal(relatedReportReason(report('a'), report('b', { title: 'Window screen missing', location: 'kitchen' })), null);
  assert.equal(collapseWorkIssues([report('a'), report('b')], []).length, 2);
});

test('one confirmed issue keeps the original records, earliest deadline, urgency and every responsible person', () => {
  const a = { ...work, title: 'Canonical repair' };
  const b = { ...work, id: 'b', priority: 'high' as const, scheduled_date: '2026-10-29', assigned_to_email: 'worker@example.test', coordinator_email: 'office@example.test' };
  const snapshot = JSON.stringify([a,b]);
  const [issue] = collapseWorkIssues([b,a], links);
  assert.equal(issue.id, 'a'); assert.equal(issue.title, a.title);
  assert.equal(issue.priority, 'high'); assert.equal(issue.scheduled_date, '2026-10-29');
  assert.equal(workAssignedTo(issue, 'worker@example.test'), true);
  assert.equal(workAssignedTo(issue, 'office@example.test'), true);
  assert.equal(workAssignedTo(issue, ''), false);
  assert.equal(JSON.stringify([a,b]), snapshot);
  assert.deepEqual(new Set(issue.linked_report_ids), new Set(['a','b']));
});

test('a partial read keeps visible reports and never joins across properties', () => {
  assert.equal(collapseWorkIssues([report('b')], links)[0].id, 'b');
  assert.equal(collapseWorkIssues([report('a'), report('b', { property_id: 'elsewhere' })], links).length, 2);
});

test('next actions includes urgent undated work, progress and due follow-ups; routine undated work is backlog', () => {
  assert.equal(workNeedsAction(work, today), false); assert.equal(workBacklog(work, today), true);
  for (const patch of [{ priority: 'high' as const }, { status: 'in_progress' as const }, { follow_up_date: '2026-10-29' }, { follow_up_date: '2026-11-05' }]) {
    assert.equal(workNeedsAction({ ...work, ...patch }, today), true);
    assert.equal(workBacklog({ ...work, ...patch }, today), false);
  }
  assert.equal(workNeedsAction({ ...work, follow_up_date: '2026-11-06' }, today), false);
});

test('scheduled and waiting work remains findable while only actionable waits enter the default view', () => {
  const scheduled = { ...work, scheduled_date: '2026-11-20' };
  assert.equal(workScheduled(scheduled, today), true); assert.equal(workNeedsAction(scheduled, today), false); assert.equal(workBacklog(scheduled, today), false);
  const waiting = { ...work, status: 'blocked' as const, follow_up_date: '2026-11-20' };
  assert.equal(workWaiting(waiting), true); assert.equal(workNeedsAction(waiting, today), false); assert.equal(workBacklog(waiting, today), false);
  assert.equal(workNeedsAction({ ...waiting, follow_up_date: null }, today), true);
  assert.equal(workWaiting({ ...work, owner_action_required: true, owner_status: 'sent' }), true);
});

test('a linked report cannot hide work in progress or an owner waiting for a decision', () => {
  const [progress] = collapseWorkIssues([work, { ...work, id: 'b', status: 'in_progress' as const }], links);
  assert.equal(workNeedsAction(progress, today), true);
  const [waiting] = collapseWorkIssues([work, { ...work, id: 'b', owner_action_required: true, owner_status: 'sent' as const }], links);
  assert.equal(workWaiting(waiting), true); assert.equal(workNeedsAction(waiting, today), true);
});

import '../../../tests/work-issue-actions.test.mjs';
