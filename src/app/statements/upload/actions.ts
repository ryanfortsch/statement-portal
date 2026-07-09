'use server';

import { supabaseAdmin } from '@/lib/supabase-admin';

export type ActivePropertyOption = { id: string; name: string; owner: string; location: string };

/**
 * Active properties for the upload dropdown, newest-name-sorted. Was a
 * client-side anon-key read of `properties` (which carries owner_last, owner
 * PII); moved server-side. Same columns, same shape, same fallback contract --
 * returns null (not []) on a fetch error so the caller can tell "failed, keep
 * the fallback list" apart from "succeeded with zero active properties".
 */
export async function loadActiveProperties(): Promise<ActivePropertyOption[] | null> {
  const { data, error } = await supabaseAdmin
    .from('properties')
    .select('id, name, owner_last, city')
    .eq('is_active', true)
    .order('name');
  if (error || !data) return null;
  const rows = data as Array<{ id: string; name: string; owner_last: string | null; city: string | null }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    owner: r.owner_last ?? '',
    location: (r.city ?? '').split(',')[0].trim(),
  }));
}
