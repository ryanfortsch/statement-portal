'use server';

import { supabaseAdmin } from '@/lib/supabase-admin';
import { PROPERTIES } from '@/lib/properties';

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

/**
 * Open owner-action work slips, counted per LEGACY statement property id.
 * Was a client-side embedded-join read (`work_slips.select('property_id,
 * properties!inner(name)')`) -- PostgREST embedded resource expansion still
 * requires SELECT on `properties` even though the literal `.from()` target is
 * `work_slips`, so this was a real anon-key properties read that a plain
 * `.from('properties')` grep doesn't catch. Moved the whole computation
 * (including the name -> legacy-id reverse lookup) server-side; same status /
 * owner_action_required / snoozed filters, same shape.
 */
export async function loadOwnerActionCounts(): Promise<Record<string, number>> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin
    .from('work_slips')
    .select('property_id, properties!inner(name)')
    .in('status', ['open', 'in_progress', 'scheduled'])
    .eq('owner_action_required', true)
    .or(`snoozed_until.is.null,snoozed_until.lte.${todayIso}`);
  if (error) return {};

  const nameToLegacy = new Map<string, string>();
  for (const [legacyId, p] of Object.entries(PROPERTIES)) {
    nameToLegacy.set(p.name.toLowerCase().trim(), legacyId);
  }

  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as Array<{ properties: { name: string } | { name: string }[] | null }>) {
    const pname = Array.isArray(row.properties) ? row.properties[0]?.name : row.properties?.name;
    if (!pname) continue;
    const legacyId = nameToLegacy.get(pname.toLowerCase().trim());
    if (!legacyId) continue;
    counts[legacyId] = (counts[legacyId] ?? 0) + 1;
  }
  return counts;
}
