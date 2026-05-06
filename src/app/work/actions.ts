'use server';

import { revalidatePath } from 'next/cache';
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
  return { ok: true };
}
