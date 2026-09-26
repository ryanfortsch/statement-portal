/**
 * The one way every Guesty pass, the Helm calendar mirror and the iCal
 * importer learn which homes Helm runs.
 *
 * A home whose properties.calendar_authority is 'helm' must be invisible to
 * sync-guesty's listing map, the calendar-days mirror, the guesty_legacy
 * backfill, the reservation-gap probe, the ghost and stale reconcilers and
 * the finance backfill, or Guesty's stale view of the listing (until it is
 * deleted there) competes with Helm's own rows. Each of those passes filters
 * its property set through one of these loaders.
 *
 * Fail-safe direction: a failed read returns an EMPTY set from
 * loadHelmRunPropertyIds (nothing is skipped, today's behaviour) and every
 * known id from loadGuestyRunPropertyIds only when the read succeeded;
 * callers that gate on "guesty-run" treat null as "cannot tell, keep
 * everything", never as "skip everything".
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { selectAllPaged } from '@/lib/paged-select';

type Row = { id: string; calendar_authority: string | null };

async function loadRows(sb: SupabaseClient): Promise<Row[]> {
  return selectAllPaged<Row>(
    (from, to) => sb.from('properties').select('id, calendar_authority').order('id', { ascending: true }).range(from, to),
    { label: 'pms guards' },
  );
}

/** Ids Helm is the calendar authority for. Empty on a failed read. */
export async function loadHelmRunPropertyIds(sb: SupabaseClient = supabaseAdmin): Promise<Set<string>> {
  if (!isServiceConfigured && sb === supabaseAdmin) return new Set();
  try {
    const rows = await loadRows(sb);
    return new Set(rows.filter((r) => r.calendar_authority === 'helm').map((r) => r.id));
  } catch (err) {
    console.error('[pms-guards] helm-run read failed; skipping nothing:', err);
    return new Set();
  }
}

/**
 * Ids Guesty still runs (every registry row that is not helm-run). Returns
 * null when the read failed so a caller can keep its existing "known
 * properties" behaviour instead of skipping the whole fleet.
 */
export async function loadGuestyRunPropertyIds(sb: SupabaseClient = supabaseAdmin): Promise<Set<string> | null> {
  if (!isServiceConfigured && sb === supabaseAdmin) return null;
  try {
    const rows = await loadRows(sb);
    return new Set(rows.filter((r) => r.calendar_authority !== 'helm').map((r) => r.id));
  } catch (err) {
    console.error('[pms-guards] guesty-run read failed:', err);
    return null;
  }
}

/**
 * Property ids that still carry an ACTIVE Guesty aggregate feed
 * (channel_listings.channel = 'guesty'). While a home has one, direct-feed
 * block events are echoes of the availability Guesty pushed and are dropped
 * at import, exactly as before the classifier learned to see them.
 */
export async function loadAggregateFeedPropertyIds(sb: SupabaseClient = supabaseAdmin): Promise<Set<string>> {
  if (!isServiceConfigured && sb === supabaseAdmin) return new Set();
  try {
    const rows = await selectAllPaged<{ property_id: string }>(
      (from, to) =>
        sb
          .from('channel_listings')
          .select('property_id')
          .eq('channel', 'guesty')
          .eq('is_active', true)
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'aggregate feeds' },
    );
    return new Set(rows.map((r) => r.property_id));
  } catch (err) {
    console.error('[pms-guards] aggregate feed read failed; treating every home as aggregate-fed:', err);
    // Fail towards today's behaviour: drop direct-feed blocks everywhere.
    return new Set(['*']);
  }
}

/** True when the aggregate-feed set says this property still rides Guesty's feed. */
export function hasAggregateFeed(set: Set<string>, propertyId: string): boolean {
  return set.has('*') || set.has(propertyId);
}
