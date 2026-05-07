import type { CompetitorId, CompetitorListing, CompetitorMeta } from './types';
import { AVH_META, AVH_LISTINGS } from './avh-listings';

export type { CompetitorId, CompetitorListing, CompetitorMeta, CompetitorSummary } from './types';
export { summarizeCompetitor } from './types';

const REGISTRY: Record<CompetitorId, { meta: CompetitorMeta; listings: CompetitorListing[] }> = {
  'atlantic-vacation-homes': { meta: AVH_META, listings: AVH_LISTINGS },
};

export function listCompetitors(): CompetitorMeta[] {
  return Object.values(REGISTRY).map((c) => c.meta);
}

export function getCompetitor(id: CompetitorId): { meta: CompetitorMeta; listings: CompetitorListing[] } | null {
  return REGISTRY[id] ?? null;
}
