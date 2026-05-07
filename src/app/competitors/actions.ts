'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import { auth } from '@/auth';

/**
 * Server actions for the Competitors module — specifically, the inline
 * "Verify address" form on the inventory page.
 *
 * Writes go to public.competitor_listing_overrides via the service-role
 * client because the regular anon client doesn't have insert privileges.
 * The same pattern other Helm modules use for write paths (Quo webhook,
 * sync routes).
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function adminClient() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Helm Supabase env vars (URL + service role) are not configured.');
  }
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function strOrNull(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? '').trim();
  return v ? v : null;
}

/**
 * Upsert an address override for a competitor listing. address_line is
 * required — the rest is optional metadata. Forces revalidation of the
 * detail page so the chip flips to "verified by you" immediately.
 */
export async function setListingAddress(
  competitorId: string,
  listingSlug: string,
  formData: FormData,
) {
  const session = await auth();
  if (!session?.user?.email) {
    throw new Error('Not signed in');
  }

  const addressLine = strOrNull(formData, 'address_line');
  if (!addressLine) {
    throw new Error('Address is required');
  }

  const payload = {
    competitor_id: competitorId,
    listing_slug: listingSlug,
    address_line: addressLine,
    street: strOrNull(formData, 'street'),
    neighborhood: strOrNull(formData, 'neighborhood'),
    owner: strOrNull(formData, 'owner'),
    owner_note: strOrNull(formData, 'owner_note'),
    evidence: strOrNull(formData, 'evidence'),
    verified_by_email: session.user.email,
    verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error } = await adminClient()
    .from('competitor_listing_overrides')
    .upsert(payload, { onConflict: 'competitor_id,listing_slug' });
  if (error) throw new Error(error.message);

  revalidatePath(`/competitors/${competitorId}`);
  revalidatePath('/competitors');
}

/** Remove a user-verified override, reverting the listing to whatever the
 *  static research overlay says (or "unknown" if no research either). */
export async function clearListingAddress(competitorId: string, listingSlug: string) {
  const session = await auth();
  if (!session?.user?.email) {
    throw new Error('Not signed in');
  }

  const { error } = await adminClient()
    .from('competitor_listing_overrides')
    .delete()
    .eq('competitor_id', competitorId)
    .eq('listing_slug', listingSlug);
  if (error) throw new Error(error.message);

  revalidatePath(`/competitors/${competitorId}`);
  revalidatePath('/competitors');
}
