'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';
import {
  HELM_CORE_TEMPLATE_ID,
  type InspectionStatus,
  type InspectionNoteType,
  type WorkSlipCategory,
  type WorkSlipPriority,
} from '@/lib/inspections-types';
import { generateDeck } from '@/lib/inspection-deck';

export async function startInspection(formData: FormData) {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const propertyId = String(formData.get('property_id') || '');
  if (!propertyId) throw new Error('Pick a property');

  const inspectorName =
    session.user.name?.trim() ||
    session.user.email.split('@')[0].replace(/^./, (c) => c.toUpperCase());

  // Generate the 10-card deck for this property + active template
  const deck = await generateDeck({
    templateId: HELM_CORE_TEMPLATE_ID,
    propertyId,
    client: supabase,
  });

  const { data, error } = await supabase
    .from('inspections')
    .insert({
      property_id: propertyId,
      template_id: HELM_CORE_TEMPLATE_ID,
      inspector_email: session.user.email,
      inspector_name: inspectorName,
      ordered_item_ids: deck.itemIds,
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(error?.message || 'Failed to start inspection');

  revalidatePath('/inspections');
  redirect(`/inspections/${data.id}`);
}

/**
 * Save (or re-save) a single item's result. Used by the mobile stepper
 * for per-card optimistic saves. Idempotent (upserts on
 * inspection_id + item_id) so repeated taps or retries are safe.
 */
export async function saveResult(args: {
  inspectionId: string;
  itemId: string;
  status: InspectionStatus;
  notes: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };

  if (args.status !== 'pass' && args.status !== 'issue' && args.status !== 'na') {
    return { ok: false, error: `Invalid status: ${args.status}` };
  }

  const { error } = await supabase
    .from('inspection_results')
    .upsert(
      {
        inspection_id: args.inspectionId,
        item_id: args.itemId,
        status: args.status,
        notes: args.notes || null,
      },
      { onConflict: 'inspection_id,item_id' }
    );

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/inspections/${args.inspectionId}`);
  return { ok: true };
}

/**
 * Finalize an inspection. Reads existing inspection_results (already
 * saved per-card via saveResult), computes aggregate counts on the
 * inspection row, records any intermittent items completed to the
 * per-property history, bumps or resets the spacing counter, and
 * redirects to the summary page.
 */
export async function completeInspection(inspectionId: string) {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const [{ data: results }, { data: insp }] = await Promise.all([
    supabase
      .from('inspection_results')
      .select('item_id, status')
      .eq('inspection_id', inspectionId),
    supabase
      .from('inspections')
      .select('property_id, template_id')
      .eq('id', inspectionId)
      .maybeSingle(),
  ]);

  const allResults = (results ?? []) as { item_id: string; status: InspectionStatus }[];
  if (allResults.length === 0) throw new Error('Mark at least one item before completing');

  const passCount = allResults.filter((r) => r.status === 'pass').length;
  const issueCount = allResults.filter((r) => r.status === 'issue').length;
  const naCount = allResults.filter((r) => r.status === 'na').length;

  if (insp) {
    const itemIds = allResults.map((r) => r.item_id);
    const { data: itemRows } = await supabase
      .from('inspection_items')
      .select('id, item_category')
      .in('id', itemIds);

    const intermittentIds = new Set(
      (itemRows ?? [])
        .filter((r: { item_category: string | null }) => r.item_category === 'INTERMITTENT')
        .map((r: { id: string }) => r.id)
    );

    if (intermittentIds.size > 0) {
      const nowIso = new Date().toISOString();
      await supabase.from('property_inspection_item_history').upsert(
        Array.from(intermittentIds).map((iid) => ({
          property_id: (insp as { property_id: string }).property_id,
          inspection_item_id: iid,
          last_completed_at: nowIso,
          last_inspection_id: inspectionId,
        })),
        { onConflict: 'property_id,inspection_item_id' }
      );

      await supabase
        .from('properties')
        .update({ inspections_since_last_intermittent: 0 })
        .eq('id', (insp as { property_id: string }).property_id);
    } else {
      const { data: prop } = await supabase
        .from('properties')
        .select('inspections_since_last_intermittent')
        .eq('id', (insp as { property_id: string }).property_id)
        .maybeSingle();
      const next =
        ((prop as { inspections_since_last_intermittent: number } | null)
          ?.inspections_since_last_intermittent ?? 0) + 1;
      await supabase
        .from('properties')
        .update({ inspections_since_last_intermittent: next })
        .eq('id', (insp as { property_id: string }).property_id);
    }
  }

  const { error: updateError } = await supabase
    .from('inspections')
    .update({
      completed_at: new Date().toISOString(),
      total_items: allResults.length,
      pass_count: passCount,
      issue_count: issueCount,
      na_count: naCount,
    })
    .eq('id', inspectionId);

  if (updateError) throw new Error(updateError.message);

  revalidatePath('/inspections');
  revalidatePath(`/inspections/${inspectionId}`);
  redirect(`/inspections/${inspectionId}/summary`);
}

/**
 * Add a standalone note from inside an inspection. PROPERTY_NOTE notes
 * pin to the property folder and persist across inspections; the
 * INSPECTION_NOTE flavor stays scoped to this one inspection.
 */
export async function addInspectionNote(args: {
  inspectionId: string;
  propertyId: string;
  itemId?: string | null;
  text: string;
  noteType: InspectionNoteType;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };

  const text = args.text.trim();
  if (!text) return { ok: false, error: 'Note is empty' };
  if (args.noteType !== 'INSPECTION_NOTE' && args.noteType !== 'PROPERTY_NOTE') {
    return { ok: false, error: `Invalid note type: ${args.noteType}` };
  }

  const { data, error } = await supabase
    .from('inspection_notes')
    .insert({
      inspection_id: args.inspectionId,
      property_id: args.propertyId,
      inspection_item_id: args.itemId ?? null,
      author_email: session.user.email,
      note_text: text,
      note_type: args.noteType,
    })
    .select('id')
    .single();

  if (error || !data) return { ok: false, error: error?.message || 'Insert failed' };

  revalidatePath(`/inspections/${args.inspectionId}`);
  revalidatePath(`/inspections/${args.inspectionId}/summary`);
  if (args.noteType === 'PROPERTY_NOTE') {
    revalidatePath(`/properties/${args.propertyId}`);
  }
  return { ok: true, id: (data as { id: string }).id };
}

/**
 * Resolve a property note (mark as no-longer-pinned-to-the-folder).
 * Used by the "x" / "resolve" button on the property folder pinned-notes
 * section so an old observation doesn't accumulate forever.
 */
export async function resolveInspectionNote(noteId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };

  const { data: noteRow } = await supabase
    .from('inspection_notes')
    .select('property_id')
    .eq('id', noteId)
    .maybeSingle();

  const { error } = await supabase
    .from('inspection_notes')
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by_email: session.user.email,
    })
    .eq('id', noteId);

  if (error) return { ok: false, error: error.message };

  if (noteRow && (noteRow as { property_id: string }).property_id) {
    revalidatePath(`/properties/${(noteRow as { property_id: string }).property_id}`);
  }
  return { ok: true };
}

/**
 * Create a work slip from inside an inspection. The slip lands in
 * Helm's Work module (`/work`) with `inspection_id` + `inspection_item_id`
 * preserved so the slip can deep-link back to the source card.
 */
export async function createWorkSlipFromInspection(args: {
  inspectionId: string;
  propertyId: string;
  itemId?: string | null;
  title: string;
  description?: string | null;
  location?: string | null;
  category: WorkSlipCategory;
  priority: WorkSlipPriority;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };

  const title = args.title.trim();
  if (!title) return { ok: false, error: 'Title is required' };

  const validCategories = ['maintenance', 'owner', 'vendor', 'other', 'rising_tide'] as const;
  const validPriorities = ['low', 'normal', 'high'] as const;
  if (!validCategories.includes(args.category)) {
    return { ok: false, error: `Invalid category: ${args.category}` };
  }
  if (!validPriorities.includes(args.priority)) {
    return { ok: false, error: `Invalid priority: ${args.priority}` };
  }

  const { data, error } = await supabase
    .from('work_slips')
    .insert({
      property_id: args.propertyId,
      inspection_id: args.inspectionId,
      inspection_item_id: args.itemId ?? null,
      title,
      description: args.description?.trim() || null,
      location: args.location?.trim() || null,
      category: args.category,
      priority: args.priority,
      status: 'open',
      created_by_email: session.user.email,
    })
    .select('id')
    .single();

  if (error || !data) return { ok: false, error: error?.message || 'Insert failed' };

  revalidatePath(`/inspections/${args.inspectionId}`);
  revalidatePath(`/inspections/${args.inspectionId}/summary`);
  revalidatePath(`/properties/${args.propertyId}`);
  revalidatePath('/work');
  return { ok: true, id: (data as { id: string }).id };
}
