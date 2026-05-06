'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';
import type {
  WorkSlipCategory,
  WorkSlipPriority,
  WorkSlipStatus,
  TaskScope,
  TaskPriority,
  TaskStatus,
} from '@/lib/work-types';

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
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  if (!args.title?.trim()) return { ok: false, error: 'Title is required' };
  if (!args.property_id) return { ok: false, error: 'Pick a property' };

  const { data, error } = await supabase
    .from('work_slips')
    .insert({
      property_id: args.property_id,
      title: args.title.trim(),
      description: args.description?.trim() || null,
      location: args.location?.trim() || null,
      category: args.category ?? 'maintenance',
      priority: args.priority ?? 'normal',
      scheduled_date: args.scheduled_date || null,
      inspection_id: args.inspection_id || null,
      inspection_item_id: args.inspection_item_id || null,
      created_by_email: session.user.email,
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
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };

  const patch: Record<string, unknown> = { status: args.status };
  if (args.status === 'done') {
    patch.completed_at = new Date().toISOString();
    patch.closed_by_email = session.user.email;
  }

  const { error } = await supabase.from('work_slips').update(patch).eq('id', args.id);
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
  }

  const { error } = await supabase.from('work_slips').update(patch).eq('id', args.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/work');
  revalidatePath(`/work/${args.id}`);
  return { ok: true };
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
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  if (!args.title?.trim()) return { ok: false, error: 'Title is required' };

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      title: args.title.trim(),
      description: args.description?.trim() || null,
      scope: args.scope ?? 'corporate',
      property_ids: args.property_ids && args.property_ids.length > 0 ? args.property_ids : null,
      priority: args.priority ?? 'medium',
      due_date: args.due_date || null,
      tags: args.tags && args.tags.length > 0 ? args.tags : null,
      created_by_email: session.user.email,
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

  const { error } = await supabase.from('tasks').update({ status: args.status }).eq('id', args.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/work');
  revalidatePath(`/work/tasks/${args.id}`);
  return { ok: true };
}

/**
 * Full update for a task from the detail page. Pass undefined to leave
 * a field unchanged. Pass null (or empty string for trimmable fields) to
 * explicitly clear a nullable field.
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

export async function deleteTask(args: { id: string }): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');
  const { error } = await supabase.from('tasks').delete().eq('id', args.id);
  if (error) throw new Error(error.message);
  revalidatePath('/work');
  redirect('/work');
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
