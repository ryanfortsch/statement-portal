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

/** What a split house's fact sheet prints about each of its units. */
export type UnitFacts = {
  id: string;
  name: string;
  bedrooms: number | null;
  bathrooms: number | null;
};

/**
 * The units of this house, with the counts each one carries on its own
 * record. 17 Beach's main house has 3.5 baths and its guest house 1.5: the
 * whole house's single Bathrooms figure cannot say that, its units can.
 * Empty when the home has no units or on any failure.
 */
export async function loadUnitFacts(houseId: string): Promise<UnitFacts[]> {
  if (!isServiceConfigured) return [];
  try {
    const parents = await loadUnitParents();
    const ids = [...parents].filter(([, parent]) => parent === houseId).map(([unit]) => unit);
    if (ids.length === 0) return [];
    const { data, error } = await supabase.from('properties').select('id, name, bedrooms, bathrooms').in('id', ids).order('name');
    if (error) throw error;
    return (data ?? []) as UnitFacts[];
  } catch {
    return [];
  }
}
