/**
 * Resolve a Helm property to its live Guesty listing id.
 *
 * `properties.guesty_listing_id` is the intended home but nothing populates
 * it today, so we fall back to the two places the id actually lives:
 *   1. guesty_listings.listing_id — the sync-verified live Guesty id
 *      (sync-guesty maps each listing to a property).
 *   2. sca_launches.guesty_listing_id — what the operator typed when
 *      launching the property onto staycapeann.com.
 * Both tables are anon-readable, so the shared anon client is fine here.
 * First non-empty wins; returns '' when nothing maps.
 *
 * Mirrors the private resolver in caption-photos/actions.ts, lifted to a lib
 * so the Guesty field-sync tool shares the exact same resolution order.
 */
import { supabase } from '@/lib/supabase';

export async function resolveGuestyListingId(
  propertyId: string,
  fromProperty: string | null,
): Promise<string> {
  const direct = fromProperty?.trim();
  if (direct) return direct;

  const { data: gl } = await supabase
    .from('guesty_listings')
    .select('listing_id')
    .eq('property_id', propertyId)
    .not('listing_id', 'is', null)
    .limit(1);
  const synced = (gl?.[0] as { listing_id: string | null } | undefined)?.listing_id?.trim();
  if (synced) return synced;

  const { data: sca } = await supabase
    .from('sca_launches')
    .select('guesty_listing_id')
    .eq('property_id', propertyId)
    .maybeSingle();
  const launched = (sca as { guesty_listing_id: string | null } | null)?.guesty_listing_id?.trim();
  if (launched) return launched;

  return '';
}
