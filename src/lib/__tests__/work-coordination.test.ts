import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coordinationPatch } from '../work-coordination.ts';
import { workDate, workMyWeek } from '../work-board-view.ts';
test('coordination never rewrites worker, lane or visit date', () => {
  assert.deepEqual(coordinationPatch({ coordinator_email: ' A@EXAMPLE.TEST ', follow_up_date: '2026-11-02' }, ['a@example.test']), { ok: true, patch: { coordinator_email: 'a@example.test', follow_up_date: '2026-11-02' } });
  assert.deepEqual(coordinationPatch({ follow_up_date: null }, []), { ok: true, patch: { follow_up_date: null } });
  assert.equal(coordinationPatch({ coordinator_email: 'stranger@example.test' }, []).ok, false);
  for (const d of ['2026-02-30', 'invalid', '2026-1-1']) assert.equal(coordinationPatch({ follow_up_date: d }, []).ok, false);
});
test('follow-up can be due before a booked vendor visit', () => {
  const item = { status: 'scheduled' as const, priority: 'normal' as const, created_at: '', assigned_to_email: null, coordinator_email: 'a@example.test', follow_up_date: '2026-10-30', scheduled_date: '2026-11-10' };
  assert.equal(workDate(item), '2026-10-30');
  assert.equal(workMyWeek(item, 'a@example.test', '2026-10-30'), true);
});
