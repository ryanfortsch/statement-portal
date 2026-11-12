/**
 * Which partner homes are on staycapeann.com right now: partner_listings
 * rows listed and not taken off (src/lib/partner-listing.ts isListed).
 *
 * The PMS bridge reads this twice: GET /api/pms/properties?include=partner
 * names only these homes, and a booking request for any other partner home
 * is refused. Its own module so the bridge can read it without importing
 * the setup screen's loaders. Fails closed: a read that fails lists nobody.
 */

import { supabaseAdmin, isServiceConfigured } from './supabase-admin.ts';

export async function listedPartnerIds(): Promise<Set<string>> {
  if (!isServiceConfigured) return new Set();
  const { data, error } = await supabaseAdmin
    .from('partner_listings')
    .select('property_id')
    .not('listed_at', 'is', null)
    .is('unlisted_at', null)
    .limit(1000);
  if (error) {
    console.error('[partner-listed] read failed', error.message);
    return new Set();
  }
  return new Set(((data ?? []) as Array<{ property_id: string }>).map((r) => r.property_id));
}

export async function isListedPartner(propertyId: string): Promise<boolean> {
  if (!isServiceConfigured || !propertyId) return false;
  const { data, error } = await supabaseAdmin
    .from('partner_listings')
    .select('property_id')
    .eq('property_id', propertyId)
    .not('listed_at', 'is', null)
    .is('unlisted_at', null)
    .maybeSingle();
  if (error) {
    console.error('[partner-listed] read failed', propertyId, error.message);
    return false;
  }
  return !!data;
}
