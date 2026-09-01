/**
 * Work slips -> owner-friendly "work notes" for the statement email.
 *
 * Loads one property-month of work_slips and rewrites them as polished,
 * owner-facing lines, grouped by where they stand:
 *
 *   completed     done during the statement month
 *   inProgress    in_progress, or scheduled on the calendar
 *   awaitingOwner owner_action_required and not yet answered
 *
 * The polish is deterministic (framing + tidying, no AI) so the preview
 * modal and the Gmail draft always agree. The line builders lean on the
 * fields that were written for humans: the slip title names the job,
 * resolution_notes says what was done, owner_action_notes is already
 * addressed to the owner by the owner-action workflow.
 *
 * Deliberately excluded: category 'rising_tide' (internal, on our dime),
 * dismissed slips, and the open backlog that nobody has started -- an
 * owner email should read as motion, not as a to-do list.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import type { PropertyWorkNotes } from '@/lib/email-templates';
import type { WorkSlipOwnerActionType } from '@/lib/work-types';

type SlipRow = {
  title: string;
  category: string;
  status: string;
  priority: 'low' | 'normal' | 'high';
  scheduled_date: string | null;
  completed_at: string | null;
  closed_at: string | null;
  owner_action_required: boolean;
  owner_action_type: WorkSlipOwnerActionType | null;
  owner_action_notes: string | null;
  owner_status: string | null;
  resolution_notes: string | null;
  created_at: string;
};

const SLIP_COLUMNS =
  'title, category, status, priority, scheduled_date, completed_at, closed_at, ' +
  'owner_action_required, owner_action_type, owner_action_notes, owner_status, ' +
  'resolution_notes, created_at';

/** Keep each group scannable; the tail folds into one closing bullet. */
const MAX_COMPLETED = 8;
const MAX_IN_PROGRESS = 5;

/** Collapse whitespace, drop trailing punctuation, capitalize the start. */
function tidy(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim().replace(/[.;,\s]+$/, '');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

/** Lowercase a leading word only when it isn't a proper noun / acronym
 *  ("Replaced the..." -> "replaced the...", but "Drometer's quote" and
 *  "HVAC filter" keep their case). Used when notes continue a title. */
function lowerLead(s: string): string {
  const rest = s.slice(1);
  const firstWord = s.split(' ')[0];
  if (firstWord.length > 1 && firstWord.slice(1) !== firstWord.slice(1).toLowerCase()) return s;
  return s.charAt(0).toLowerCase() + rest;
}

/** "2026-09-12" -> "September 12" */
function fmtDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

const PRIORITY_RANK: Record<string, number> = { high: 0, normal: 1, low: 2 };

function completedLine(slip: SlipRow): string {
  const title = tidy(slip.title);
  const notes = slip.resolution_notes ? tidy(slip.resolution_notes) : '';
  // Append the resolution when it's short and says something the title
  // doesn't. Long notes are usually internal play-by-play; leave them out.
  if (notes && notes.length <= 160 && notes.toLowerCase() !== title.toLowerCase()) {
    return `${title} - ${lowerLead(notes)}`;
  }
  return title;
}

function inProgressLine(slip: SlipRow): string {
  const title = tidy(slip.title);
  if (slip.status === 'scheduled') {
    return slip.scheduled_date
      ? `${title}, on the calendar for ${fmtDay(slip.scheduled_date)}`
      : `${title}, being scheduled now`;
  }
  return `${title}, underway`;
}

const ACTION_PHRASE: Record<WorkSlipOwnerActionType, string> = {
  approve: 'ready for your approval',
  purchase: 'waiting on a purchase decision',
  schedule: 'waiting on a date that works for you',
  decide: 'waiting on your call',
  reimburse: 'a reimbursement to square up',
};

function awaitingLine(slip: SlipRow): string {
  const title = tidy(slip.title);
  const notes = slip.owner_action_notes ? tidy(slip.owner_action_notes) : '';
  if (notes && notes.length <= 200) return `${title}: ${notes}`;
  const phrase = slip.owner_action_type ? ACTION_PHRASE[slip.owner_action_type] : 'waiting on your input';
  return `${title}, ${phrase}`;
}

/** True when the owner still owes an answer on this slip. */
function isAwaitingOwner(slip: SlipRow): boolean {
  return slip.owner_action_required
    && slip.owner_status !== 'approved'
    && slip.owner_status !== 'declined';
}

function byPriorityThenAge(a: SlipRow, b: SlipRow): number {
  const p = (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1);
  return p !== 0 ? p : a.created_at.localeCompare(b.created_at);
}

/** Cap a group, folding the overflow into one closing line. */
function cap(lines: string[], max: number, tail: (n: number) => string): string[] {
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  kept.push(tail(lines.length - max));
  return kept;
}

export async function loadStatementWorkNotes(args: {
  propertyId: string;
  propertyName: string;
  /** "YYYY-MM" */
  month: string;
}): Promise<PropertyWorkNotes> {
  const { propertyId, propertyName, month } = args;
  const start = `${month}-01`;
  const startDate = new Date(`${start}T00:00:00Z`);
  const end = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 1))
    .toISOString()
    .slice(0, 10);

  // Two bounded queries instead of one broad one: the done backlog grows
  // forever (PostgREST would silently cap a bare select at 1000 rows), so
  // completed slips are filtered to the month window server-side. A slip
  // closed from the board may carry closed_at without completed_at; either
  // stamp inside the window counts.
  const [{ data: doneRows }, { data: activeRows }] = await Promise.all([
    supabaseAdmin
      .from('work_slips')
      .select(SLIP_COLUMNS)
      .eq('property_id', propertyId)
      .eq('status', 'done')
      .neq('category', 'rising_tide')
      .or([
        `and(completed_at.gte.${start},completed_at.lt.${end})`,
        `and(completed_at.is.null,closed_at.gte.${start},closed_at.lt.${end})`,
      ].join(',')),
    supabaseAdmin
      .from('work_slips')
      .select(SLIP_COLUMNS)
      .eq('property_id', propertyId)
      .neq('category', 'rising_tide')
      .in('status', ['open', 'in_progress', 'scheduled', 'blocked']),
  ]);

  const done = ((doneRows || []) as unknown as SlipRow[]).filter(s => tidy(s.title).length > 0);
  const active = ((activeRows || []) as unknown as SlipRow[]).filter(s => tidy(s.title).length > 0);

  done.sort((a, b) => (a.completed_at || a.closed_at || '').localeCompare(b.completed_at || b.closed_at || ''));

  const awaiting = active.filter(isAwaitingOwner).sort(byPriorityThenAge);
  // Open-but-unstarted and blocked slips stay internal unless they're
  // waiting on the owner; "in motion" means someone is actually on it.
  const moving = active
    .filter(s => !isAwaitingOwner(s) && (s.status === 'in_progress' || s.status === 'scheduled'))
    .sort(byPriorityThenAge);

  return {
    propertyName,
    completed: cap(done.map(completedLine), MAX_COMPLETED,
      n => `Plus ${n} smaller item${n === 1 ? '' : 's'} handled along the way`),
    inProgress: cap(moving.map(inProgressLine), MAX_IN_PROGRESS,
      n => `And ${n} more item${n === 1 ? '' : 's'} on our list`),
    awaitingOwner: awaiting.map(awaitingLine),
  };
}
