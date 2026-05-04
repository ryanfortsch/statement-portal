'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';
import { HELM_CORE_TEMPLATE_ID, type InspectionStatus } from '@/lib/inspections-types';
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
