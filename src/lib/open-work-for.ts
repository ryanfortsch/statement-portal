import 'server-only';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { selectAllPaged } from '@/lib/paged-select';
import { operatingDate } from '@/lib/operating-date';
import { ACTIVE_TASK_STATUSES, ACTIVE_WORK_SLIP_STATUSES } from '@/lib/work-types';
import { workAssignedTo } from '@/lib/work-board-view';
import { collapseWorkIssues } from '@/lib/work-issues';
import { loadWorkIssueLinks } from '@/lib/work-issues-server';

/**
 * One person's open work, the board's own "mine" (work-board-view.ts): the
 * slips they perform or coordinate, with linked reports collapsed to one
 * row, plus the office to-dos assigned to them. Snoozed slips stay out
 * until their day. Read by the My page; the home feed keeps its own copy
 * of the same filter in ForMeFeed.
 */

export type OpenWorkItem = {
  id: string;
  kind: 'slip' | 'task';
  title: string;
  priority: string | null;
  propertyId: string | null;
  propertyName: string | null;
  /** The earlier of the scheduled day and the follow-up day, or the to-do's due date. */
  dueDate: string | null;
  /** Due before today. */
  overdue: boolean;
  href: string;
};

export type OpenWork = { items: OpenWorkItem[]; overdue: number };

export async function loadOpenWorkFor(email: string, today: string = operatingDate()): Promise<OpenWork> {
  const me = email.toLowerCase().trim();
  if (!me) return { items: [], overdue: 0 };

  const [slipRows, taskRows, links, props] = await Promise.all([
    selectAllPaged<{
      id: string;
      property_id: string | null;
      title: string;
      priority: string | null;
      status: string;
      scheduled_date: string | null;
      follow_up_date: string | null;
      assigned_to_email: string | null;
      coordinator_email: string | null;
    }>(
      (from, to) =>
        supabase
          .from('work_slips')
          .select('id, property_id, title, priority, status, scheduled_date, follow_up_date, assigned_to_email, coordinator_email')
          .in('status', ACTIVE_WORK_SLIP_STATUSES)
          .or(`snoozed_until.is.null,snoozed_until.lte.${today}`)
          .order('id')
          .range(from, to),
      { label: 'Open slips' },
    ),
    selectAllPaged<{ id: string; title: string; priority: string | null; due_date: string | null }>(
      (from, to) =>
        supabase
          .from('tasks')
          .select('id, title, priority, due_date')
          .in('status', ACTIVE_TASK_STATUSES)
          .eq('assigned_to_email', me)
          .order('id')
          .range(from, to),
      { label: 'Open to-dos' },
    ),
    loadWorkIssueLinks(supabase).catch(() => []),
    supabase.from('properties').select('id, name'),
  ]);
  const names = new Map(((props.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));

  const slips: OpenWorkItem[] = collapseWorkIssues(slipRows, links)
    .filter((s) => workAssignedTo(s, me))
    .map((s) => {
      const dueDate = [s.scheduled_date, s.follow_up_date].filter((d): d is string => !!d).sort()[0] ?? null;
      return {
        id: s.id,
        kind: 'slip',
        title: s.title,
        priority: s.priority,
        propertyId: s.property_id,
        propertyName: s.property_id ? names.get(s.property_id) ?? null : null,
        dueDate,
        overdue: !!dueDate && dueDate < today,
        href: `/work/${s.id}`,
      };
    });
  const tasks: OpenWorkItem[] = taskRows.map((t) => ({
    id: t.id,
    kind: 'task',
    title: t.title,
    priority: t.priority,
    propertyId: null,
    propertyName: null,
    dueDate: t.due_date,
    overdue: !!t.due_date && t.due_date < today,
    href: `/work/tasks/${t.id}`,
  }));

  // Dated and overdue first, then high priority, then the rest by title.
  const rank = (i: OpenWorkItem) => (i.overdue ? 0 : i.dueDate ? 1 : i.priority === 'high' ? 2 : 3);
  const items = [...slips, ...tasks].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    return a.title.localeCompare(b.title);
  });
  return { items, overdue: items.filter((i) => i.overdue).length };
}
