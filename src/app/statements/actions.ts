'use server';

import { supabaseAdmin } from '@/lib/supabase-admin';

export type OwnerConfigRow = {
  name: string;
  owner_greeting: string;
  owner_full: string;
  owner_emails: string[];
};

/**
 * Owner name/email config per property, keyed by property_id. Was a
 * client-side read of `properties` via the anon key; moved server-side
 * (service role) since `properties` carries owner PII (emails, names) that
 * shouldn't be reachable through the public anon key. Same columns, same
 * shape -- the dashboard's live owner-profile hydration is unchanged.
 */
export async function loadOwnerConfig(): Promise<Record<string, OwnerConfigRow>> {
  const { data } = await supabaseAdmin
    .from('properties')
    .select('id, name, owner_greeting, owner_full, owner_emails');
  const map: Record<string, OwnerConfigRow> = {};
  (data || []).forEach((r: { id: string; name: string | null; owner_greeting: string | null; owner_full: string | null; owner_emails: string[] | null }) => {
    map[r.id] = {
      name: r.name || '',
      owner_greeting: r.owner_greeting || '',
      owner_full: r.owner_full || '',
      owner_emails: Array.isArray(r.owner_emails) ? r.owner_emails : [],
    };
  });
  return map;
}

/**
 * MassTaxConnect occupancy-tax cert IDs for the given properties, keyed by
 * property_id. Same reasoning as loadOwnerConfig -- was an anon-key client
 * read; tax_cert_id is business/financial data, moved server-side.
 */
export async function loadTaxCerts(propIds: string[]): Promise<Record<string, string | null>> {
  if (propIds.length === 0) return {};
  const { data } = await supabaseAdmin.from('properties').select('id, tax_cert_id').in('id', propIds);
  const map: Record<string, string | null> = {};
  (data || []).forEach((r: { id: string; tax_cert_id: string | null }) => {
    map[r.id] = r.tax_cert_id;
  });
  return map;
}
