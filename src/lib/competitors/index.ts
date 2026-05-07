import type { CompetitorId, CompetitorListing, CompetitorMeta } from './types';
import { AVH_META, AVH_LISTINGS } from './avh-listings';
import { SHOREWAY_META, SHOREWAY_LISTINGS } from './shoreway-listings';
import { getAddressMatch } from './addresses';
import { getOverridesForCompetitor } from './overrides';

export type { CompetitorId, CompetitorListing, CompetitorMeta, CompetitorSummary, AddressMatch } from './types';
export { summarizeCompetitor } from './types';
export { formatBedroomLabel } from './format';

const REGISTRY: Record<CompetitorId, { meta: CompetitorMeta; listings: CompetitorListing[] }> = {
  'atlantic-vacation-homes': { meta: AVH_META, listings: AVH_LISTINGS },
  'shoreway-management': { meta: SHOREWAY_META, listings: SHOREWAY_LISTINGS },
};

export function listCompetitors(): CompetitorMeta[] {
  return Object.values(REGISTRY).map((c) => c.meta);
}

/**
 * Resolve a competitor's listings with all known address layers merged in.
 * Layer precedence (highest wins):
 *   1. user-verified DB override (competitor_listing_overrides)
 *   2. static research overlay (src/lib/competitors/addresses.ts)
 *   3. nothing — listing has no address yet
 */
export async function getCompetitor(
  id: CompetitorId,
): Promise<{ meta: CompetitorMeta; listings: CompetitorListing[] } | null> {
  const c = REGISTRY[id];
  if (!c) return null;
  const overrides = await getOverridesForCompetitor(id);
  const listings = c.listings.map((l) => {
    const dbOverride = overrides.get(l.slug);
    if (dbOverride) return { ...l, address: dbOverride };
    const research = getAddressMatch(id, l.slug);
    return research ? { ...l, address: research } : l;
  });
  return { meta: c.meta, listings };
}

export type AddressCoverage = {
  total: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
  /** Listings whose address has an owner identified (via VGSI or similar). */
  withOwner: number;
};

export function computeAddressCoverage(listings: CompetitorListing[]): AddressCoverage {
  const c: AddressCoverage = { total: listings.length, high: 0, medium: 0, low: 0, unknown: 0, withOwner: 0 };
  for (const l of listings) {
    const conf = l.address?.confidence ?? 'unknown';
    c[conf] += 1;
    if (l.address?.owner) c.withOwner += 1;
  }
  return c;
}
