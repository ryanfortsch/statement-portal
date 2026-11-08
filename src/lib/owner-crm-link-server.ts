import 'server-only';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { selectAllPaged } from '@/lib/paged-select';
import { buildOwnerCrmDirectory, EMPTY_OWNER_CRM_DIRECTORY, type CrmContactRow, type OwnerCrmDirectory } from '@/lib/owner-crm-link';

/**
 * The CRM contacts an owner card can link to. Fails soft to an empty
 * directory: a card without the link still approves and sends exactly as
 * before, it just does not offer the CRM contact.
 */
export async function loadOwnerCrmDirectory(): Promise<OwnerCrmDirectory> {
  try {
    const rows = await selectAllPaged<CrmContactRow>((from, to) =>
      supabase.from('contacts').select('id, type, phone, emails, linked_property_ids').order('id').range(from, to),
    );
    return buildOwnerCrmDirectory(rows);
  } catch {
    return EMPTY_OWNER_CRM_DIRECTORY;
  }
}
