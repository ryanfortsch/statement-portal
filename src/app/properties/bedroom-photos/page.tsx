import { redirect } from 'next/navigation';
import { supabaseAdmin as supabase, isServiceConfigured } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

/**
 * Bedroom photos is retired as a fleet page (2026-10-18). It was a second
 * publish path for the registry entry the launcher edits: the same uploader
 * sits in each home's Stay Cape Ann launcher, under Sleeping arrangements and
 * bedroom photos, and a live listing opens there on what guests see. Old
 * links land on that home's launcher, or on the launcher index.
 */
const PROPERTY_ID = /^[a-z0-9_]{1,60}$/;

async function propertyForListing(listingId: string): Promise<string | null> {
  if (!isServiceConfigured || !listingId) return null;
  const { data: launch } = await supabase
    .from('sca_launches')
    .select('property_id')
    .eq('guesty_listing_id', listingId)
    .limit(1)
    .maybeSingle();
  if (launch?.property_id) return String(launch.property_id);
  const { data: prop } = await supabase
    .from('properties')
    .select('id')
    .eq('guesty_listing_id', listingId)
    .limit(1)
    .maybeSingle();
  return prop?.id ? String(prop.id) : null;
}

export default async function BedroomPhotosRedirect({
  searchParams,
}: {
  searchParams: Promise<{ listing?: string; property?: string }>;
}) {
  const { listing, property } = await searchParams;
  const id = property && PROPERTY_ID.test(property) ? property : await propertyForListing((listing ?? '').trim());
  redirect(id ? `/properties/${id}/stay-cape-ann#sleeping` : '/properties/stay-cape-ann');
}
