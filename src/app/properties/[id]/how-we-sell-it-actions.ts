'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * Save a home's "How we sell it" (property_marketing). Selling points come
 * in one per line and are split into the text[] column. A partial upsert:
 * only these six columns change, so the retired sleeps and bedrooms columns
 * are left as they are.
 */
export async function saveHowWeSellIt(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const propertyId = String(formData.get('property_id') || '');
  if (!propertyId) throw new Error('Missing property id');

  const sellingPoints = String(formData.get('selling_points') || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const row = {
    property_id: propertyId,
    tagline: String(formData.get('tagline') || '').trim() || null,
    primary_selling_point: String(formData.get('primary_selling_point') || '').trim() || null,
    selling_points: sellingPoints,
    on_water: formData.get('on_water') === 'on',
    best_for: String(formData.get('best_for') || '').trim() || null,
    notes: String(formData.get('notes') || '').trim() || null,
  };

  const { error } = await supabaseAdmin
    .from('property_marketing')
    .upsert(row, { onConflict: 'property_id' });
  if (error) throw new Error(error.message);

  revalidatePath(`/properties/${propertyId}`);
}
