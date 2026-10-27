'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import type {
  WorkSlipCategory,
  WorkSlipPriority,
  WorkSlipStatus,
  WorkSlipOwnerActionType,
  WorkSlipOwnerStatus,
  TaskScope,
  TaskPriority,
  TaskStatus,
} from '@/lib/work-types';
import { WORK_PRIORITIES } from '@/lib/work-types';
import { LANE_ORDER, laneChoicePatch, slipLane, type LaneChoiceSlip, type WorkLane } from '@/lib/work-slip-lanes';

const TASK_STATUSES: TaskStatus[] = ['open', 'in_progress', 'blocked', 'done', 'archived'];

// ─── Work slips ───────────────────────────────────────────────────

export async function createWorkSlip(args: {
  property_id: string;
  title: string;
  description?: string;
  location?: string;
  category?: WorkSlipCategory;
  priority?: WorkSlipPriority;
  scheduled_date?: string | null;
  inspection_id?: string;
  inspection_item_id?: string;
  assigned_to_email?: string | null;
  /**
   * Optional photos to attach at create time. Uploaded through
   * PhotoUploader (which stores in Blob and hands us the public URLs);
   * we just persist the array. Same shape as the inspection-driven
   * createWorkSlipFromInspection so the two paths write the same column.
   */
  photo_urls?: string[];
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  if (!args.title?.trim()) return { ok: false, error: 'Title is required' };
  if (!args.property_id) return { ok: false, error: 'Pick a property' };

  const assignedEmail = args.assigned_to_email?.trim() || null;
  // If we have an assignee, mark the slip as team-claimed; otherwise stay
  // unassigned. Owner-action assignment is handled separately.
  const assignedType = assignedEmail ? 'team' : 'unassigned';
  const photos = (args.photo_urls ?? []).filter((u) => typeof u === 'string' && u.length > 0);

  const { data, error } = await supabase
    .from('work_slips')
    .insert({
      property_id: args.property_id,
      title: args.title.trim(),
      description: args.description?.trim() || null,
      location: args.location?.trim() || null,
      category: args.category ?? 'maintenance',
      // Filing under Owner IS the ask: the slip enters the owner-action
      // rail (board filter, OWNER badge, draft-owner-email) immediately.
      // The detail page's Owner section refines type/notes afterward.
      owner_action_required: args.category === 'owner',
      priority: args.priority ?? 'normal',
      scheduled_date: args.scheduled_date || null,
      inspection_id: args.inspection_id || null,
      inspection_item_id: args.inspection_item_id || null,
      created_by_email: session.user.email,
      assigned_to_email: assignedEmail,
      assigned_to_type: assignedType,
      photo_urls: photos,
    })
    .select('id')
    .single();

  if (error || !data) return { ok: false, error: error?.message || 'Failed to create work slip' };

  revalidatePath('/work');
  return { ok: true, id: (data as { id: string }).id };
}

export async function updateWorkSlipStatus(args: {
  id: string;
  status: WorkSlipStatus;
  /** When the status change is triggered from a property page, pass the
   *  property id so its Open Work list + the /properties slip counts
   *  revalidate alongside the work board. */
  propertyId?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };

  const patch: Record<string, unknown> = { status: args.status };
  if (args.status === 'done') {
    patch.completed_at = new Date().toISOString();
    patch.closed_by_email = session.user.email;
  }
  // Dismissed = closed without work happening (triage false positive,
  // duplicate, won't-do). Stamp closed_* but not completed_at so the
  // slip never counts as completed work.
  if (args.status === 'dismissed') {
    patch.closed_at = new Date().toISOString();
    patch.closed_by_email = session.user.email;
  }
  // Reopening clears the close stamps AND any lingering snooze, matching
  // the /api/work-slips reopen path — otherwise a reopened slip keeps a
  // Completed date, and a pre-close snooze would keep it hidden from the
  // active queue despite "Reopen puts it back in the queue."
  if (args.status === 'open') {
    patch.completed_at = null;
    patch.closed_at = null;
    patch.closed_by_email = null;
    patch.snoozed_until = null;
    patch.snoozed_by_email = null;
    patch.snoozed_at = null;
  }

  const { error } = await supabase.from('work_slips').update(patch).eq('id', args.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/work');
  revalidatePath(`/work/${args.id}`);
  // Marking a slip done anywhere feeds through every read path: the work
  // board (above), the property's Open Work list, and the /properties
  // slip-count badges. All filter by status, so a revalidate is enough.
  revalidatePath('/properties');
  if (args.propertyId) revalidatePath(`/properties/${args.propertyId}`);
  return { ok: true };
}

/**
 * Rename a work slip from the detail page. Tasks have had full edit via
 * updateTask since day one; slips only ever got status/assignment
 * mutations, so a typo'd or vague title was frozen at creation.
 */
export async function updateWorkSlipTitle(args: {
  id: string;
  title: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  const title = args.title.trim();
  if (!title) return { ok: false, error: 'Title is required' };

  const { error } = await supabase.from('work_slips').update({ title }).eq('id', args.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/work');
  revalidatePath(`/work/${args.id}`);
  return { ok: true };
}

/**
 * Save the "what to bring" list on a work slip. This is the materials a
 * contractor needs to COMPLETE the job (e.g. "P-trap washer, plunger"). It gets
 * rolled into the packet's supply-closet (85 Eastern) pick list so nothing's
 * forgotten before the route. Empty clears it.
 */
export async function updateWorkSlipBringList(args: {
  id: string;
  bringList: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  const bring = args.bringList.trim();

  const { error } = await supabase
    .from('work_slips')
    .update({ bring_list: bring || null })
    .eq('id', args.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/work');
  revalidatePath(`/work/${args.id}`);
  return { ok: true };
}

/**
 * Save resolution notes (and optionally the status) on a work slip from
 * the detail page. Used when marking done or capturing context after
 * the fact -- e.g. "Replaced the bulb, took 5 min."
 */
export async function updateWorkSlipResolution(args: {
  id: string;
  resolution_notes: string;
  status?: WorkSlipStatus;
  /** Pass so a close from the detail page also revalidates the property's
   *  Open Work list and the /properties count badges. */
  propertyId?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };

  const patch: Record<string, unknown> = {
    resolution_notes: args.resolution_notes.trim() || null,
  };
  if (args.status) {
    patch.status = args.status;
    if (args.status === 'done') {
      patch.completed_at = new Date().toISOString();
      patch.closed_by_email = session.user.email;
    }
    // Same stamping contract as updateWorkSlipStatus: dismissal gets
    // closed_at but never completed_at.
    if (args.status === 'dismissed') {
      patch.closed_at = new Date().toISOString();
      patch.closed_by_email = session.user.email;
    }
  }

  const { error } = await supabase.from('work_slips').update(patch).eq('id', args.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/work');
  revalidatePath(`/work/${args.id}`);
  // A status change feeds the property surfaces too, same as
  // updateWorkSlipStatus.
  if (args.status) {
    revalidatePath('/properties');
    if (args.propertyId) revalidatePath(`/properties/${args.propertyId}`);
  }
  return { ok: true };
}

/**
 * Replace the photo_urls array on a work slip. Called from the slip
 * detail page after PhotoUploader add/remove. The client passes the full
 * desired array (not a delta) so the server doesn't have to reconcile.
 */
export async function updateWorkSlipPhotos(args: {
  id: string;
  photo_urls: string[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };

  const { error } = await supabase
    .from('work_slips')
    .update({ photo_urls: args.photo_urls })
    .eq('id', args.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/work');
  revalidatePath(`/work/${args.id}`);
  return { ok: true };
}

/**
 * Reassign a single work slip from the slip detail page. Takes the
 * canonical email (or null) and updates assigned_to_email +
 * assigned_to_type together so the queue's "Unclaimed" filter and the
 * "team / unassigned / owner" pill stay in sync.
 *
 * Unlike the bulk path, this also stamps claimed_at when the slip
 * goes from unassigned → assigned so we can show "claimed Apr 30" on
 * the row.
 */
export async function updateWorkSlipAssignment(args: {
  id: string;
  assigned_to_email: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };

  const email = args.assigned_to_email?.trim() || null;
  const patch: Record<string, unknown> = {
    assigned_to_email: email,
    assigned_to_type: email ? 'team' : 'unassigned',
    // Vendor label from markRunScheduled displays over the email on the
    // board and property rows; clear it so a reassign or unassign doesn't
    // keep showing the old vendor.
    assigned_to_label: null,
  };
  if (email) {
    // Lightly stamp claimed_at when transitioning into a claimed state.
    // Reading the current row first would be one extra round trip; the
    // upsert-style behavior here will overwrite a previous claim with
    // a new timestamp on every reassign which is fine for now.
    patch.claimed_at = new Date().toISOString();
  } else {
    patch.claimed_at = null;
  }

  const { error } = await supabase.from('work_slips').update(patch).eq('id', args.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/work');
  revalidatePath(`/work/${args.id}`);
  return { ok: true };
}

/** The stamp every human lane edit writes, so the organize pass skips the
 *  slip from then on and the slip page says who decided. */
function laneSetBy(email: string): { organized_at: string; organize_note: string } {
  return { organized_at: new Date().toISOString(), organize_note: `Set by ${email.split('@')[0]}` };
}

/**
 * Whose hands a slip goes to: the one question the slip page asks about who
 * does the work. The lane is never stored (lib/work-slip-lanes.ts derives it
 * from category, run_scope and the owner flag), so a choice writes exactly
 * the columns laneChoicePatch says that lane reads back off, and stamps
 * organized_at like every operator lane edit: the nightly organize pass and
 * the scope classifier never re-file a human's call. Tapping the lane the
 * slip is already in only stamps it.
 */
export async function updateWorkSlipLane(args: {
  id: string;
  lane: WorkLane;
  propertyId?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  if (!LANE_ORDER.includes(args.lane)) return { ok: false, error: 'Bad lane' };

  const { data: current, error: readErr } = await supabase
    .from('work_slips')
    .select('category, title, run_scope, owner_action_required, owner_action_type, from_supply_key, from_guest_request_key')
    .eq('id', args.id)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (!current) return { ok: false, error: 'Work slip not found' };
  const row = current as LaneChoiceSlip;

  const stamp = laneSetBy(session.user.email);
  let patch: Record<string, unknown>;
  if (slipLane(row) === args.lane) {
    patch = stamp;
  } else {
    const choice = laneChoicePatch(args.lane, row);
    if (!choice) return { ok: false, error: 'This slip cannot go to that lane.' };
    patch = {
      ...choice,
      // A scope a person set is final; the classifier only fills empty ones.
      ...(choice.run_scope ? { run_scope_note: stamp.organize_note } : {}),
      ...stamp,
    };
  }

  const { error } = await supabase.from('work_slips').update(patch).eq('id', args.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/work');
  revalidatePath(`/work/${args.id}`);
  revalidatePath('/');
  revalidatePath('/properties');
  if (args.propertyId) revalidatePath(`/properties/${args.propertyId}`);
  return { ok: true };
}

const OWNER_ACTION_TYPES: WorkSlipOwnerActionType[] = ['approve', 'purchase', 'schedule', 'decide', 'reimburse'];
const OWNER_STATUSES: WorkSlipOwnerStatus[] = ['not_sent', 'sent', 'approved', 'declined', 'questions'];

/**
 * Flag (or un-flag) a slip as needing the owner's input, with the kind of
 * ask and optional context for the email draft. This and the Owner
 * category at create time are the only writers of the flag -- the board's
 * Owner Action filter and OWNER badges, the /properties rollup, the home
 * card, the daily brief, and /api/work/draft-owner-email all read it.
 * Pass undefined to leave type/notes unchanged, null/empty to clear.
 */
export async function updateWorkSlipOwnerAction(args: {
  id: string;
  owner_action_required: boolean;
  owner_action_type?: WorkSlipOwnerActionType | null;
  owner_action_notes?: string | null;
  propertyId?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  if (args.owner_action_type != null && !OWNER_ACTION_TYPES.includes(args.owner_action_type)) {
    return { ok: false, error: 'Bad action type' };
  }

  const patch: Record<string, unknown> = {
    owner_action_required: args.owner_action_required,
    // Flagging (or withdrawing) the owner ask is a lane decision by a
    // person; the organize pass leaves the slip alone from here on.
    ...laneSetBy(session.user.email),
  };
  if (args.owner_action_required) {
    if (args.owner_action_type !== undefined) patch.owner_action_type = args.owner_action_type;
    if (args.owner_action_notes !== undefined) {
      patch.owner_action_notes = args.owner_action_notes?.trim() || null;
    }
  } else {
    // Withdrawing the ask clears its details and resets the loop; the
    // owner_last_contacted_at stamp stays as history of any email sent.
    patch.owner_action_type = null;
    patch.owner_action_notes = null;
    patch.owner_status = 'not_sent';
  }

  const { error } = await supabase.from('work_slips').update(patch).eq('id', args.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/work');
  revalidatePath(`/work/${args.id}`);
  // The flag feeds count badges on the home card and /properties rollup.
  revalidatePath('/');
  revalidatePath('/properties');
  if (args.propertyId) revalidatePath(`/properties/${args.propertyId}`);
  return { ok: true };
}

/**
 * Record where the owner-ask stands. 'sent' is stamped by the
 * draft-owner-email routes; approved / declined / questions are the
 * operator logging the owner's reply from their inbox or a call. The
 * daily brief keeps nagging until a flagged slip reaches 'approved'.
 */
export async function updateWorkSlipOwnerStatus(args: {
  id: string;
  owner_status: WorkSlipOwnerStatus;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  if (!OWNER_STATUSES.includes(args.owner_status)) return { ok: false, error: 'Bad owner status' };

  const { error } = await supabase
    .from('work_slips')
    .update({ owner_status: args.owner_status })
    .eq('id', args.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/work');
  revalidatePath(`/work/${args.id}`);
  return { ok: true };
}

/**
 * Snooze a slip until a chosen date. The slip stays in its current
 * status; snoozed_until is a presentation hint that hides it from
 * the active queue / home / property page until the date passes.
 *
 * Pass null to un-snooze immediately (the row reappears in the
 * active queue right away).
 */
export async function snoozeWorkSlip(args: {
  id: string;
  until: string | null;     // YYYY-MM-DD or null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };

  const patch: Record<string, unknown> = {
    snoozed_until: args.until || null,
    snoozed_by_email: args.until ? session.user.email : null,
    snoozed_at: args.until ? new Date().toISOString() : null,
  };

  const { error } = await supabase.from('work_slips').update(patch).eq('id', args.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/work');
  revalidatePath(`/work/${args.id}`);
  return { ok: true };
}

/**
 * Bulk-update many work slips in one round trip. Accepts only the small
 * set of fields safe to set across many rows from the queue's bulk bar:
 * status, priority, assigned_to_email. Empty string assigned_to_email
 * unassigns. Caller passes the full set of ids to operate on.
 */
export async function bulkUpdateWorkSlips(args: {
  ids: string[];
  patch: {
    status?: WorkSlipStatus;
    priority?: WorkSlipPriority;
    assigned_to_email?: string | null;
  };
}): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  if (!args.ids || args.ids.length === 0) return { ok: false, error: 'No slips selected' };

  const patch: Record<string, unknown> = {};
  if (args.patch.status !== undefined) {
    patch.status = args.patch.status;
    if (args.patch.status === 'done') {
      patch.completed_at = new Date().toISOString();
      patch.closed_by_email = session.user.email;
    }
  }
  if (args.patch.priority !== undefined) {
    patch.priority = args.patch.priority;
  }
  if (args.patch.assigned_to_email !== undefined) {
    const email = args.patch.assigned_to_email?.trim() || null;
    patch.assigned_to_email = email;
    patch.assigned_to_type = email ? 'team' : 'unassigned';
    // Same as updateWorkSlipAssignment: drop any vendor label from
    // markRunScheduled so it can't mask the new assignee (or unassigned).
    patch.assigned_to_label = null;
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: 'Nothing to update' };

  const { error } = await supabase.from('work_slips').update(patch).in('id', args.ids);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/work');
  for (const id of args.ids) revalidatePath(`/work/${id}`);
  return { ok: true, updated: args.ids.length };
}

// ─── Tasks ────────────────────────────────────────────────────────

export async function createTask(args: {
  title: string;
  description?: string;
  scope?: TaskScope;
  property_ids?: string[];
  priority?: TaskPriority;
  due_date?: string | null;
  tags?: string[];
  assigned_to_email?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  if (!args.title?.trim()) return { ok: false, error: 'Title is required' };
  if (args.priority !== undefined && !WORK_PRIORITIES.includes(args.priority)) return { ok: false, error: 'Bad priority' };

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      title: args.title.trim(),
      description: args.description?.trim() || null,
      scope: args.scope ?? 'corporate',
      property_ids: args.property_ids && args.property_ids.length > 0 ? args.property_ids : null,
      priority: args.priority ?? 'normal',
      due_date: args.due_date || null,
      tags: args.tags && args.tags.length > 0 ? args.tags : null,
      created_by_email: session.user.email,
      assigned_to_email: args.assigned_to_email?.trim() || null,
    })
    .select('id')
    .single();

  if (error || !data) return { ok: false, error: error?.message || 'Failed to create task' };

  revalidatePath('/work');
  return { ok: true, id: (data as { id: string }).id };
}

export async function updateTaskStatus(args: {
  id: string;
  status: TaskStatus;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  if (!TASK_STATUSES.includes(args.status)) return { ok: false, error: 'Bad status' };

  const { error } = await supabase.from('tasks').update({ status: args.status }).eq('id', args.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/work');
  revalidatePath(`/work/tasks/${args.id}`);
  return { ok: true };
}

/**
 * Update an office to-do. The to-do page saves each field on its own, so a
 * call usually carries one field; pass undefined to leave a field
 * unchanged, null (or an empty string for trimmable fields) to clear a
 * nullable one.
 */
export async function updateTask(args: {
  id: string;
  title?: string;
  description?: string | null;
  scope?: TaskScope;
  property_ids?: string[] | null;
  assigned_to_email?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  due_date?: string | null;
  tags?: string[] | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  if (args.title !== undefined && !args.title.trim()) return { ok: false, error: 'Title is required' };
  if (args.priority !== undefined && !WORK_PRIORITIES.includes(args.priority)) return { ok: false, error: 'Bad priority' };
  if (args.status !== undefined && !TASK_STATUSES.includes(args.status)) return { ok: false, error: 'Bad status' };

  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (k === 'id') continue;
    if (v === undefined) continue;
    if (typeof v === 'string') patch[k] = v.trim() || null;
    else if (Array.isArray(v)) patch[k] = v.length > 0 ? v : null;
    else patch[k] = v;
  }
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabase.from('tasks').update(patch).eq('id', args.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/work');
  revalidatePath(`/work/tasks/${args.id}`);
  return { ok: true };
}

/** Delete an office to-do and its comments for good. The page asks once,
 *  in words, before calling this; Dismiss is the reversible way to close
 *  one. Lands on the Office to-dos tab. */
export async function deleteTask(args: { id: string }): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');
  const { error } = await supabase.from('tasks').delete().eq('id', args.id);
  if (error) throw new Error(error.message);
  revalidatePath('/work');
  redirect('/work?tab=tasks');
}

/**
 * Bulk-update many office to-dos in one round trip. Mirrors
 * bulkUpdateWorkSlips, on the same priority scale, so the board's bulk bar
 * passes its words through unchanged. Empty string assignee unassigns.
 */
export async function bulkUpdateTasks(args: {
  ids: string[];
  patch: {
    status?: TaskStatus;
    priority?: TaskPriority;
    assigned_to_email?: string | null;
  };
}): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  if (!args.ids || args.ids.length === 0) return { ok: false, error: 'No to-dos selected' };
  if (args.patch.priority !== undefined && !WORK_PRIORITIES.includes(args.patch.priority)) return { ok: false, error: 'Bad priority' };
  if (args.patch.status !== undefined && !TASK_STATUSES.includes(args.patch.status)) return { ok: false, error: 'Bad status' };

  const patch: Record<string, unknown> = {};
  if (args.patch.status !== undefined) patch.status = args.patch.status;
  if (args.patch.priority !== undefined) patch.priority = args.patch.priority;
  if (args.patch.assigned_to_email !== undefined) {
    patch.assigned_to_email = args.patch.assigned_to_email?.trim() || null;
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: 'Nothing to update' };

  const { error } = await supabase.from('tasks').update(patch).in('id', args.ids);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/work');
  for (const id of args.ids) revalidatePath(`/work/tasks/${id}`);
  return { ok: true, updated: args.ids.length };
}

export async function addTaskComment(args: {
  task_id: string;
  body: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  const body = args.body.trim();
  if (!body) return { ok: false, error: 'Comment is empty' };

  const { data, error } = await supabase
    .from('task_comments')
    .insert({ task_id: args.task_id, author_email: session.user.email, body })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message || 'Insert failed' };

  revalidatePath(`/work/tasks/${args.task_id}`);
  return { ok: true, id: (data as { id: string }).id };
}

export async function deleteTaskComment(args: {
  id: string;
  task_id: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };

  // Scoped to author so users can only remove their own comments.
  const { error } = await supabase
    .from('task_comments')
    .delete()
    .eq('id', args.id)
    .eq('author_email', session.user.email);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/work/tasks/${args.task_id}`);
  return { ok: true };
}

// ─── Work slip comments ─────────────────────────────────────────

export async function addWorkSlipComment(args: {
  work_slip_id: string;
  body: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  const body = args.body.trim();
  if (!body) return { ok: false, error: 'Comment is empty' };

  const { data, error } = await supabase
    .from('work_slip_comments')
    .insert({ work_slip_id: args.work_slip_id, author_email: session.user.email, body })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message || 'Insert failed' };

  revalidatePath(`/work/${args.work_slip_id}`);
  return { ok: true, id: (data as { id: string }).id };
}

export async function deleteWorkSlipComment(args: {
  id: string;
  work_slip_id: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };

  const { error } = await supabase
    .from('work_slip_comments')
    .delete()
    .eq('id', args.id)
    .eq('author_email', session.user.email);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/work/${args.work_slip_id}`);
  return { ok: true };
}
