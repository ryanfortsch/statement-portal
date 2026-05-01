'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';
import { STANDARD_TEMPLATE_ID, type InspectionStatus } from '@/lib/inspections-types';

export async function startInspection(formData: FormData) {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const propertyId = String(formData.get('property_id') || '');
  if (!propertyId) throw new Error('Pick a property');

  const inspectorName =
    session.user.name?.trim() ||
    session.user.email.split('@')[0].replace(/^./, (c) => c.toUpperCase());

  const { data, error } = await supabase
    .from('inspections')
    .insert({
      property_id: propertyId,
      template_id: STANDARD_TEMPLATE_ID,
      inspector_email: session.user.email,
      inspector_name: inspectorName,
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

  // Parse all status_<itemId> + notes_<itemId> entries from the form
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
