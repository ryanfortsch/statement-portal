import { supabase, isConfigured as isHelmConfigured } from '@/lib/supabase';
import type { CompetitorId } from './types';

export type CompetitorEvent = {
  id: string;
  competitorId: CompetitorId;
  listingSlug: string;
  listingName: string;
  eventType: 'added' | 'dropped' | 'returned' | 'changed' | 'renamed';
  changes: Record<string, { from: unknown; to: unknown }> | null;
  detectedAt: string;
};

/**
 * Recent inventory events for a competitor — what's been added, dropped,
 * or returned since we started tracking. Surfaced as the "Recent changes"
 * feed on the detail page.
 */
export async function getRecentCompetitorEvents(
  competitorId: CompetitorId,
  limit = 25,
): Promise<CompetitorEvent[]> {
  if (!isHelmConfigured) return [];
  const { data, error } = await supabase
    .from('competitor_listing_events')
    .select('*')
    .eq('competitor_id', competitorId)
    .order('detected_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[competitors/events] read failed', error);
    return [];
  }
  return (data ?? []).map((row) => ({
    id: row.id as string,
    competitorId: row.competitor_id as CompetitorId,
    listingSlug: row.listing_slug as string,
    listingName: row.listing_name as string,
    eventType: row.event_type as CompetitorEvent['eventType'],
    changes: row.changes as CompetitorEvent['changes'],
    detectedAt: row.detected_at as string,
  }));
}

/** When the most recent sync ran for this competitor — used for the
 *  "Last synced X ago" footer. Returns null when there are no events
 *  yet (table seeded but never diffed) or no row tracked at all. */
export async function getLastSyncAt(competitorId: CompetitorId): Promise<string | null> {
  if (!isHelmConfigured) return null;
  // Cheapest signal we have: the max last_seen_at on the current table
  // for this competitor. Updated on every successful sync, including
  // syncs that detected zero changes.
  const { data, error } = await supabase
    .from('competitor_listings_current')
    .select('last_seen_at')
    .eq('competitor_id', competitorId)
    .order('last_seen_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('[competitors/events] last sync read failed', error);
    return null;
  }
  return (data?.last_seen_at as string | undefined) ?? null;
}
