'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';

/**
 * Upsert a property's marketing memory. Selling points come in as a
 * newline-separated textarea and get split into the text[] column.
 */
export async function saveMarketing(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const propertyId = String(formData.get('property_id') || '');
  if (!propertyId) throw new Error('Missing property id');

  const sellingPointsRaw = String(formData.get('selling_points') || '');
  const sellingPoints = sellingPointsRaw
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const sleepsRaw = String(formData.get('sleeps') || '').trim();
  const bedroomsRaw = String(formData.get('bedrooms') || '').trim();

  const row = {
    property_id: propertyId,
    tagline: String(formData.get('tagline') || '').trim() || null,
    primary_selling_point: String(formData.get('primary_selling_point') || '').trim() || null,
    selling_points: sellingPoints,
    on_water: formData.get('on_water') === 'on',
    bedrooms: bedroomsRaw ? Number(bedroomsRaw) : null,
    sleeps: sleepsRaw ? Number(sleepsRaw) : null,
    best_for: String(formData.get('best_for') || '').trim() || null,
    notes: String(formData.get('notes') || '').trim() || null,
  };

  const { error } = await supabase
    .from('property_marketing')
    .upsert(row, { onConflict: 'property_id' });
  if (error) throw new Error(error.message);

  revalidatePath('/guests/marketing');
}
