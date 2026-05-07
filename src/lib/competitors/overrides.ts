import { supabase, isConfigured as isHelmConfigured } from '@/lib/supabase';
import type { CompetitorId, AddressMatch } from './types';

/**
 * User-verified address overrides for competitor listings.
 *
 * Reads from public.competitor_listing_overrides — the table backing the
 * inline "Verify address" form on the inventory page. The DB row always
 * wins over the static research overlay in addresses.ts, since "verified
 * by Dotti against VGSI" is a stronger signal than any web research.
 */

type OverrideRow = {
  competitor_id: string;
  listing_slug: string;
  address_line: string;
  street: string | null;
  neighborhood: string | null;
  owner: string | null;
  owner_note: string | null;
  evidence: string | null;
  verified_by_email: string | null;
  verified_at: string;
};

/**
 * Fetch all overrides for a single competitor in one round trip and return
 * them as a slug-keyed map ready to merge into listings.
 */
export async function getOverridesForCompetitor(
  competitorId: CompetitorId,
): Promise<Map<string, AddressMatch>> {
  const map = new Map<string, AddressMatch>();
  if (!isHelmConfigured) return map;

  const { data, error } = await supabase
    .from('competitor_listing_overrides')
    .select('*')
    .eq('competitor_id', competitorId);
  if (error) {
    // Failing the lookup shouldn't break the page — fall back to research-only.
    console.warn('[competitors/overrides] read failed', error);
    return map;
  }

  for (const row of (data ?? []) as OverrideRow[]) {
    map.set(row.listing_slug, rowToAddressMatch(row));
  }
  return map;
}

function rowToAddressMatch(row: OverrideRow): AddressMatch {
  return {
    addressGuess: row.address_line,
    street: row.street ?? undefined,
    neighborhood: row.neighborhood ?? undefined,
    owner: row.owner ?? undefined,
    ownerNote: row.owner_note ?? undefined,
    confidence: 'high',
    evidence: row.evidence ?? `Verified by ${row.verified_by_email ?? 'team'} on ${row.verified_at.slice(0, 10)}`,
    userVerified: true,
    verifiedByEmail: row.verified_by_email ?? undefined,
    verifiedAt: row.verified_at,
  };
}
