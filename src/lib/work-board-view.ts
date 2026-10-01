import type { WorkSlipRow, TaskRow } from './work-types';

type BoardItem = Pick<WorkSlipRow | TaskRow, 'status' | 'priority' | 'created_at' | 'assigned_to_email'> & {
  scheduled_date?: string | null; due_date?: string | null;
  assigned_to_type?: WorkSlipRow['assigned_to_type']; assigned_to_label?: string | null;
};
export function workDate(item: BoardItem): string | null { return item.scheduled_date ?? item.due_date ?? null; }
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
