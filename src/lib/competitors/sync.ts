import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { CompetitorId } from './types';
import { AVH_LISTINGS } from './avh-listings';
import { SHOREWAY_LISTINGS } from './shoreway-listings';
import { scrapeAvh, scrapeShoreway, type ScrapedListing, type ScrapeResult } from './scrape';

/**
 * Sync logic that turns a fresh scrape into:
 *   1. updates on competitor_listings_current
 *   2. new rows on competitor_listing_events
 *
 * On the very first run, competitor_listings_current is empty — we seed
 * it from the static AVH_LISTINGS / SHOREWAY_LISTINGS files so the first
 * real scrape can compare against the founding state instead of writing
 * 100+ "added" events.
 *
 * On subsequent runs:
 *   - listing in scrape AND in current(active)  → update last_seen_at
 *   - listing in scrape AND in current(dropped) → flip to active, write 'returned'
 *   - listing in scrape AND not in current      → insert active, write 'added'
 *   - listing in current(active) AND not in scrape → flip to dropped, write 'dropped'
 *
 * Field-level changes (bedroom count etc) aren't tracked in v1 — the
 * scrape only captures slug + name + url. Once the scrape fetches detail
 * pages we'll start logging 'changed' events with a JSON diff.
 */

type CurrentRow = {
  id: string;
  competitor_id: string;
  listing_slug: string;
  listing_name: string;
  url: string;
  status: 'active' | 'dropped';
  first_seen_at: string;
  last_seen_at: string;
  dropped_at: string | null;
};

export type SyncReport = {
  competitorId: CompetitorId;
  ok: boolean;
  error?: string;
  scraped: number;
  added: number;
  dropped: number;
  returned: number;
  unchanged: number;
  /** True when this run seeded competitor_listings_current from static
   *  data rather than diffing against an existing snapshot. */
  seeded: boolean;
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function adminClient(): SupabaseClient {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Helm Supabase env vars are not configured.');
  }
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function loadCurrent(client: SupabaseClient, competitorId: CompetitorId): Promise<CurrentRow[]> {
  const { data, error } = await client
    .from('competitor_listings_current')
    .select('*')
    .eq('competitor_id', competitorId);
  if (error) throw error;
  return (data ?? []) as CurrentRow[];
}

/** Seed competitor_listings_current from the static seed files. Used on
 *  first run only, when the table is empty for that competitor. No
 *  events written — this is the founding state, not a diff. */
async function seedFromStatic(
  client: SupabaseClient,
  competitorId: CompetitorId,
): Promise<number> {
  const source = competitorId === 'atlantic-vacation-homes' ? AVH_LISTINGS : SHOREWAY_LISTINGS;
  const now = new Date().toISOString();
  const rows = source.map((l) => ({
    competitor_id: competitorId,
    listing_slug: l.slug,
    listing_name: l.name,
    city: l.city,
    url: l.url,
    bedrooms: l.bedrooms,
    bathrooms: l.bathrooms,
    max_guests: l.maxGuests,
    pet_friendly: l.petFriendly,
    status: 'active' as const,
    first_seen_at: now,
    last_seen_at: now,
    updated_at: now,
  }));
  const { error } = await client
    .from('competitor_listings_current')
    .upsert(rows, { onConflict: 'competitor_id,listing_slug' });
  if (error) throw error;
  return rows.length;
}

async function diffAndPersist(
  client: SupabaseClient,
  competitorId: CompetitorId,
  scraped: ScrapedListing[],
  current: CurrentRow[],
): Promise<{ added: number; dropped: number; returned: number; unchanged: number }> {
  const now = new Date().toISOString();
  const currentBySlug = new Map(current.map((r) => [r.listing_slug, r]));
  const scrapedBySlug = new Map(scraped.map((l) => [l.slug, l]));

  let added = 0;
  let dropped = 0;
  let returned = 0;
  let unchanged = 0;

  type EventRow = {
    competitor_id: string;
    listing_slug: string;
    listing_name: string;
    event_type: 'added' | 'dropped' | 'returned';
    detected_at: string;
  };
  const events: EventRow[] = [];

  // Walk scraped listings
  for (const l of scraped) {
    const existing = currentBySlug.get(l.slug);
    const displayName = l.name ?? existing?.listing_name ?? l.slug;
    if (!existing) {
      // Brand new
      const { error } = await client.from('competitor_listings_current').insert({
        competitor_id: competitorId,
        listing_slug: l.slug,
        listing_name: displayName,
        url: l.url,
        status: 'active',
        first_seen_at: now,
        last_seen_at: now,
        updated_at: now,
      });
      if (error) throw error;
      events.push({
        competitor_id: competitorId,
        listing_slug: l.slug,
        listing_name: displayName,
        event_type: 'added',
        detected_at: now,
      });
      added++;
    } else if (existing.status === 'dropped') {
      // Returned
      const { error } = await client
        .from('competitor_listings_current')
        .update({
          status: 'active',
          last_seen_at: now,
          dropped_at: null,
          listing_name: displayName,
          url: l.url,
          updated_at: now,
        })
        .eq('id', existing.id);
      if (error) throw error;
      events.push({
        competitor_id: competitorId,
        listing_slug: l.slug,
        listing_name: displayName,
        event_type: 'returned',
        detected_at: now,
      });
      returned++;
    } else {
      // Active and still here — touch last_seen_at
      const { error } = await client
        .from('competitor_listings_current')
        .update({
          last_seen_at: now,
          listing_name: displayName,
          url: l.url,
          updated_at: now,
        })
        .eq('id', existing.id);
      if (error) throw error;
      unchanged++;
    }
  }

  // Walk current actives that didn't appear in the scrape → dropped
  for (const row of current) {
    if (row.status !== 'active') continue;
    if (scrapedBySlug.has(row.listing_slug)) continue;
    const { error } = await client
      .from('competitor_listings_current')
      .update({
        status: 'dropped',
        dropped_at: now,
        updated_at: now,
      })
      .eq('id', row.id);
    if (error) throw error;
    events.push({
      competitor_id: competitorId,
      listing_slug: row.listing_slug,
      listing_name: row.listing_name,
      event_type: 'dropped',
      detected_at: now,
    });
    dropped++;
  }

  if (events.length > 0) {
    const { error } = await client.from('competitor_listing_events').insert(events);
    if (error) throw error;
  }

  return { added, dropped, returned, unchanged };
}

async function syncOne(
  client: SupabaseClient,
  scrape: ScrapeResult,
): Promise<SyncReport> {
  const competitorId = scrape.competitorId;
  if (!scrape.ok) {
    return {
      competitorId,
      ok: false,
      error: scrape.error ?? 'scrape failed',
      scraped: 0,
      added: 0,
      dropped: 0,
      returned: 0,
      unchanged: 0,
      seeded: false,
    };
  }
  // Defensive: an empty scrape from a still-up site usually means a
  // selector/regex regression rather than the manager dropping their
  // entire portfolio. Bail rather than mass-flag everything dropped.
  if (scrape.listings.length === 0) {
    return {
      competitorId,
      ok: false,
      error: 'scrape returned 0 listings — refusing to mass-drop',
      scraped: 0,
      added: 0,
      dropped: 0,
      returned: 0,
      unchanged: 0,
      seeded: false,
    };
  }

  const current = await loadCurrent(client, competitorId);
  if (current.length === 0) {
    const seeded = await seedFromStatic(client, competitorId);
    return {
      competitorId,
      ok: true,
      scraped: scrape.listings.length,
      added: 0,
      dropped: 0,
      returned: 0,
      unchanged: seeded,
      seeded: true,
    };
  }

  const diff = await diffAndPersist(client, competitorId, scrape.listings, current);
  return {
    competitorId,
    ok: true,
    scraped: scrape.listings.length,
    ...diff,
    seeded: false,
  };
}

export async function syncAllCompetitors(): Promise<SyncReport[]> {
  const client = adminClient();
  const [avh, sw] = await Promise.all([scrapeAvh(), scrapeShoreway()]);
  return Promise.all([syncOne(client, avh), syncOne(client, sw)]);
}
