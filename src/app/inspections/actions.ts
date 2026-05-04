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

type SubmittedItem = { itemId: string; status: InspectionStatus; notes: string };

export async function completeInspection(inspectionId: string, formData: FormData) {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const items: SubmittedItem[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('status_')) continue;
    const itemId = key.slice('status_'.length);
    const status = String(value) as InspectionStatus;
    if (status !== 'pass' && status !== 'issue' && status !== 'na') continue;
    const notes = String(formData.get(`notes_${itemId}`) || '').trim();
    items.push({ itemId, status, notes });
  }

  if (items.length === 0) throw new Error('Mark at least one item before submitting');

  const { error: resultsError } = await supabase
    .from('inspection_results')
    .upsert(
      items.map((i) => ({
        inspection_id: inspectionId,
        item_id: i.itemId,
        status: i.status,
        notes: i.notes || null,
      })),
      { onConflict: 'inspection_id,item_id' }
    );

  if (resultsError) throw new Error(resultsError.message);

  const passCount = items.filter((i) => i.status === 'pass').length;
  const issueCount = items.filter((i) => i.status === 'issue').length;
  const naCount = items.filter((i) => i.status === 'na').length;

  // Look up the property + template + which items are intermittent so we
  // can (a) record per-property history for any intermittent items just
  // completed and (b) bump the per-property "inspections since last
  // intermittent" counter (or reset to 0 when an intermittent ran).
  const { data: insp } = await supabase
    .from('inspections')
    .select('property_id, template_id')
    .eq('id', inspectionId)
    .maybeSingle();

  if (insp) {
    const itemIds = items.map((i) => i.itemId);
    const { data: itemRows } = await supabase
      .from('inspection_items')
      .select('id, item_category')
      .in('id', itemIds);

    const intermittentItemIds = new Set(
      (itemRows ?? [])
        .filter((r: { item_category: string | null }) => r.item_category === 'INTERMITTENT')
        .map((r: { id: string }) => r.id)
    );

    if (intermittentItemIds.size > 0) {
      const nowIso = new Date().toISOString();
      await supabase.from('property_inspection_item_history').upsert(
        Array.from(intermittentItemIds).map((iid) => ({
          property_id: (insp as { property_id: string }).property_id,
          inspection_item_id: iid,
          last_completed_at: nowIso,
          last_inspection_id: inspectionId,
        })),
        { onConflict: 'property_id,inspection_item_id' }
      );

      // Reset spacing counter -- an intermittent just ran.
      await supabase
        .from('properties')
        .update({ inspections_since_last_intermittent: 0 })
        .eq('id', (insp as { property_id: string }).property_id);
    } else {
      // Bump the spacing counter -- this inspection had no intermittent.
      const { data: prop } = await supabase
        .from('properties')
        .select('inspections_since_last_intermittent')
        .eq('id', (insp as { property_id: string }).property_id)
        .maybeSingle();
      const next = ((prop as { inspections_since_last_intermittent: number } | null)?.inspections_since_last_intermittent ?? 0) + 1;
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
      total_items: items.length,
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
