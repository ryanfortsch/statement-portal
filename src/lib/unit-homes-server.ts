import { supabaseAdmin as supabase, isServiceConfigured } from '@/lib/supabase-admin';
import { parentOfUnits, type LinkRoleRow } from './unit-homes';

/**
 * Which homes are units of a split house, from listing_links (a 'unit'
 * member belongs to its group's 'whole'). Unit id -> house id. Empty on
 * any failure, so a list reads flat rather than blank. The properties
 * list and the week grid on Turnovers both read it; keep them on this one
 * read so they never disagree about what is a unit.
 */
export async function loadUnitParents(): Promise<Map<string, string>> {
  if (!isServiceConfigured) return new Map();
  try {
    const { data, error } = await supabase.from('listing_links').select('group_key, role, property_id');
    if (error) throw error;
    return parentOfUnits((data ?? []) as LinkRoleRow[]);
  } catch {
    return new Map();
  }
}
