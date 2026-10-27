import 'server-only';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import type { PropertyDocument } from './property-documents';

/** All documents for a property. Contract-auto rows sort first, then
 *  newest-first within the rest, so the executed contract is always at
 *  the top of the Documents tab. */
export async function getPropertyDocuments(propertyId: string): Promise<PropertyDocument[]> {
  try {
    const { data, error } = await supabase
      .from('property_documents')
      .select('*')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const rows = (data ?? []) as PropertyDocument[];
    return rows.sort((a, b) => {
      if (a.source === 'contract-auto' && b.source !== 'contract-auto') return -1;
      if (b.source === 'contract-auto' && a.source !== 'contract-auto') return 1;
      return b.created_at.localeCompare(a.created_at);
    });
  } catch {
    // Table not migrated yet on this env; Documents tab shows empty.
    return [];
  }
}

