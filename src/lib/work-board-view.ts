import type { WorkSlipRow, TaskRow } from './work-types';
import { dueThisWeek } from './work-week.ts'; // relative + .ts: node:test loads this file

type BoardItem = Pick<WorkSlipRow | TaskRow, 'status' | 'priority' | 'created_at' | 'assigned_to_email'> & {
  scheduled_date?: string | null; due_date?: string | null;
  coordinator_email?: string | null; follow_up_date?: string | null;
  assigned_to_type?: WorkSlipRow['assigned_to_type']; assigned_to_label?: string | null;
};
export function workDate(item: BoardItem): string | null { return [item.follow_up_date, item.scheduled_date, item.due_date].filter((d): d is string => !!d).sort()[0] ?? null; }
export function workUnassigned(item: BoardItem): boolean {
  return !item.assigned_to_email && !item.assigned_to_label && (!item.assigned_to_type || item.assigned_to_type === 'unassigned');
}
export function workOverdue(item: BoardItem, today: string): boolean {
  const date = workDate(item);
  return !!date && date < today;
}
function rank(item: BoardItem, today: string): number {
  if (workOverdue(item, today)) return 0;
  if (item.status === 'blocked') return 1;
  if (workDate(item) === today) return 2;
  if (item.priority === 'high') return 3;
  if (workUnassigned(item)) return 4;
  return 5;
}
export function compareWork(a: BoardItem, b: BoardItem, today: string): number {
  return rank(a, today) - rank(b, today)
    || (workDate(a) ?? '9999').localeCompare(workDate(b) ?? '9999')
    || Number(b.priority === 'high') - Number(a.priority === 'high')
    || a.created_at.localeCompare(b.created_at);
}
export function workSignals(items: BoardItem[], today: string) {
  return {
    overdue: items.filter(item => workOverdue(item, today)).length,
    blocked: items.filter(item => item.status === 'blocked').length,
    dueToday: items.filter(item => workDate(item) === today).length,
    unclaimed: items.filter(workUnassigned).length,
  };
}

/** This week, the home page's "Open work · this week" rule
 *  (src/lib/work-week.ts): dated on or before today plus six, overdue
 *  included. Undated work is the backlog, not this week. */
export function workThisWeek(item: BoardItem, today: string): boolean {
  return dueThisWeek(workDate(item), today);
}

/** My week: assigned to me and due this week. */
export function workMyWeek(item: BoardItem, me: string, today: string): boolean {
  return !!me && (item.assigned_to_email === me || item.coordinator_email === me) && workThisWeek(item, today);
}

/** The view the board opens on with no ?filter=. A staff login opens on its
 *  own week (All is the first pill, one tap away, and the tab carries the
 *  total); an owner, or a session with no role, opens on everything. */
export function defaultWorkFilter(role: string | null | undefined): 'all' | 'my-week' {
  return role === 'staff' ? 'my-week' : 'all';
}
