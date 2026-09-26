import { supabaseAdmin as supabase, isServiceConfigured } from '@/lib/supabase-admin';

/**
 * Who physically goes to a house.
 *
 * "Which cleaner serves this property, and what is their number" is one of
 * the questions an operator most often opens a property record to answer,
 * and until now the record could not answer it at all: there was no
 * `cleaner_phones` read anywhere under src/app/properties. The mapping only
 * existed inside the Quo ingest path, where it routes inbound texts.
 */
export type PropertyCleaner = {
  phone: string;
  display_name: string;
  vendor: string | null;
  /** True when this cleaner is mapped to every property rather than this one. */
  fleetWide: boolean;
};

/**
 * Active cleaners who serve one property.
 *
 * `cleaner_phones.property_ids = '{}'` means "serves all properties" (the Quo
 * parser falls back to body matching for them), so an empty array is a match,
 * not a miss. Property-specific mappings sort first: on a house that has one,
 * naming the fleet-wide cleaner first would be actively misleading.
 *
 * The roster is a handful of rows, so this reads the active set and filters in
 * JS rather than building an array-contains-or-empty PostgREST filter. Same
 * shape as the fleet read in launch-context.ts.
 */
export async function getPropertyCleaners(propertyId: string): Promise<PropertyCleaner[]> {
  if (!propertyId || !isServiceConfigured) return [];
  try {
    const { data, error } = await supabase
      .from('cleaner_phones')
      .select('phone, display_name, vendor, property_ids')
      .eq('active', true)
      .limit(500);
    if (error || !data) return [];

    const rows = data as Array<{
      phone: string;
      display_name: string | null;
      vendor: string | null;
      property_ids: string[] | null;
    }>;

    return rows
      .map((r) => {
        const ids = r.property_ids ?? [];
        const fleetWide = ids.length === 0;
        const serves = fleetWide || ids.includes(propertyId);
        return serves
          ? {
              phone: r.phone,
              display_name: r.display_name ?? 'Cleaner',
              vendor: r.vendor,
              fleetWide,
            }
          : null;
      })
      .filter((c): c is PropertyCleaner => c !== null)
      .sort((a, b) => Number(a.fleetWide) - Number(b.fleetWide));
  } catch {
    return [];
  }
}
