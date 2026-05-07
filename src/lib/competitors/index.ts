import type { CompetitorId, CompetitorListing, CompetitorMeta } from './types';
import { AVH_META, AVH_LISTINGS } from './avh-listings';
import { SHOREWAY_META, SHOREWAY_LISTINGS } from './shoreway-listings';
import { getAddressMatch } from './addresses';

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

export function getCompetitor(id: CompetitorId): { meta: CompetitorMeta; listings: CompetitorListing[] } | null {
  const c = REGISTRY[id];
  if (!c) return null;
  // Merge address overlay into each listing at read time so the seed
  // listing files stay tight and address research lives in addresses.ts
  // where it's reviewable in one place.
  const listings = c.listings.map((l) => {
    const address = getAddressMatch(id, l.slug);
    return address ? { ...l, address } : l;
  });
  return { meta: c.meta, listings };
}

export type AddressCoverage = {
  total: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
};

export function computeAddressCoverage(listings: CompetitorListing[]): AddressCoverage {
  const c: AddressCoverage = { total: listings.length, high: 0, medium: 0, low: 0, unknown: 0 };
  for (const l of listings) {
    const conf = l.address?.confidence ?? 'unknown';
    c[conf] += 1;
  }
  return c;
}
