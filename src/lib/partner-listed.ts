/**
 * Which partner homes are on staycapeann.com right now: partner_listings
 * rows listed and not taken off (src/lib/partner-listing.ts isListed).
 *
 * The PMS bridge reads this twice: GET /api/pms/properties?include=partner
 * names only these homes (listedPartners), and a booking request for any
 * other partner home is refused (isListedPartner). Its own module so the
 * bridge can read it without importing the setup screen's loaders. Fails
 * closed: a read that fails lists nobody.
 */

import { supabaseAdmin, isServiceConfigured } from './supabase-admin.ts';

/**
 * The listed partner homes, each with its place on the site (site_rank,
 * null when no owner has set one). The bridge's fleet read hands the place
 * to staycapeann.com, which orders every home on one scale.
 */
export async function listedPartners(): Promise<Map<string, { site_rank: number | null }>> {
  if (!isServiceConfigured) return new Map();
  const { data, error } = await supabaseAdmin
    .from('partner_listings')
    .select('property_id, site_rank')
    .not('listed_at', 'is', null)
    .is('unlisted_at', null)
    .limit(1000);
  if (error) {
    console.error('[partner-listed] read failed', error.message);
    return new Map();
  }
  return new Map(
    ((data ?? []) as Array<{ property_id: string; site_rank: number | null }>).map((r) => [
      r.property_id,
      { site_rank: typeof r.site_rank === 'number' ? r.site_rank : null },
    ]),
  );
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
