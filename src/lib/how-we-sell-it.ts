/**
 * "How we sell it": a home's selling points, the copy the campaign AI reads
 * on every draft (property_marketing). It lived on its own Growth page as
 * Marketing Memory until 2026-10-18; it now sits on the property page's
 * Guest & listing tab.
 *
 * Sleeps and bedrooms are not here: the registry holds them
 * (properties.max_occupancy, properties.bedrooms) and the campaign context
 * reads them from there, so there is one place to type "sleeps 8". The two
 * old columns stay on the table and nothing reads or writes them.
 *
 * Read and written through the service-role client, like every other
 * writer; the anon key is public.
 */
import { supabaseAdmin, isServiceConfigured } from './supabase-admin';

export type HowWeSellItRow = {
  property_id: string;
  tagline: string | null;
  primary_selling_point: string | null;
  selling_points: string[] | null;
  on_water: boolean;
  best_for: string | null;
  notes: string | null;
};

export const HOW_WE_SELL_IT_COLUMNS = 'property_id, tagline, primary_selling_point, selling_points, on_water, best_for, notes';

/** The home's row, null when nothing is written yet, or a failed read. */
export async function loadHowWeSellIt(propertyId: string): Promise<{ ok: true; row: HowWeSellItRow | null } | { ok: false }> {
  if (!isServiceConfigured) return { ok: false };
  try {
    const { data, error } = await supabaseAdmin
      .from('property_marketing')
      .select(HOW_WE_SELL_IT_COLUMNS)
      .eq('property_id', propertyId)
      .maybeSingle();
    if (error) return { ok: false };
    return { ok: true, row: (data as HowWeSellItRow | null) ?? null };
  } catch {
    return { ok: false };
  }
}
