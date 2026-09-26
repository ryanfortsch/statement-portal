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
 * everything", never as "skip everything". The two loaders whose failure
 * would hurt a Helm-run home rather than a Guesty pass
 * (loadStrictDedupeHomes for the dedupe, loadAggregateFeedPropertyIds for
 * the importer) throw instead.
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

export { exportLiveSince, guestyEchoPropertyIds, type ListingScopeRow } from './listing-scope.ts';
import { exportLiveSince, guestyEchoPropertyIds, type ListingScopeRow } from './listing-scope.ts';

/**
 * The homes the dedupe runs on Helm-run rules (booking-dedupe
 * strictChannelPropertyIds), each mapped to its cutover moment
 * (cutoverAtByProperty). THROWS on a failed read.
 *
 * Two kinds of home: every Helm-run home, and every home an OTA already
 * reads Helm's export for (an active row ticked export_subscribed, runbook
 * step 7). The second is the cutover window: Guesty is disconnected, the
 * OTAs rely on Helm's export, and the flip may still be days away while
 * VRBO is re-onboarded. On Guesty rules there, a VRBO rebook of a cancelled
 * week was filed under the cancel and left the export Airbnb and Booking.com
 * were reading. The moment is the earlier of properties.cutover_at and the
 * first tick: Guesty stopped writing new bookings when it was disconnected.
 *
 * Throws rather than answer empty: a dedupe run on Guesty rules for these
 * homes would be written. A throw fails that run and the previous marks
 * stand.
 */
export async function loadStrictDedupeHomes(sb: SupabaseClient = supabaseAdmin): Promise<Map<string, string | null>> {
  if (!isServiceConfigured && sb === supabaseAdmin) throw new Error('Supabase service role is not configured.');
  const [props, listings] = await Promise.all([
    selectAllPaged<{ id: string; calendar_authority: string | null; cutover_at: string | null }>(
      (from, to) =>
        sb.from('properties').select('id, calendar_authority, cutover_at').order('id', { ascending: true }).range(from, to),
      { label: 'pms guards cutovers' },
    ),
    selectAllPaged<ListingScopeRow>(
      (from, to) =>
        sb
          .from('channel_listings')
          .select('property_id, channel, is_active, export_subscribed, export_subscribed_at')
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'pms guards export ticks' },
    ),
  ]);
  const live = exportLiveSince(listings);
  const out = new Map<string, string | null>();
  const earlier = (a: string | null, b: string | null): string | null => {
    if (!a) return b;
    if (!b) return a;
    return Date.parse(a) <= Date.parse(b) ? a : b;
  };
  for (const p of props) {
    if (p.calendar_authority === 'helm') out.set(p.id, earlier(p.cutover_at ?? null, live.get(p.id) ?? null));
    else if (live.has(p.id)) out.set(p.id, live.get(p.id) ?? null);
  }
  return out;
}

/**
 * Property ids whose direct-feed closures are Guesty's echoes, dropped at
 * import: the home carries an ACTIVE Guesty aggregate feed
 * (channel_listings.channel = 'guesty') and no OTA on it imports Helm's
 * export yet (no active row ticked export_subscribed).
 *
 * The first half is the fleet as it has always been: while Guesty pushes a
 * home's availability to every OTA, a closure on an OTA's own feed is that
 * push, and Guesty's own holds arrive on the aggregate feed. The second half
 * is the cutover window. From the moment the operator pastes Helm's line
 * into an OTA and ticks it (runbook step 7), Guesty is disconnected and the
 * aggregate feed is dead or dying while the flip that retires it may still
 * be a day away; dropping closures then hid every Booking.com reservation
 * made in that window from the export Airbnb and VRBO were already reading.
 *
 * THROWS on a failed read. It used to answer "every home" on a failure,
 * which dropped every closure on every Helm-run home too, and three failed
 * reads in a row cancelled every Booking.com reservation on file. A thrown
 * read fails the sync run instead; the next beat retries.
 */
export async function loadAggregateFeedPropertyIds(sb: SupabaseClient = supabaseAdmin): Promise<Set<string>> {
  if (!isServiceConfigured && sb === supabaseAdmin) return new Set();
  const rows = await selectAllPaged<ListingScopeRow>(
    (from, to) =>
      sb
        .from('channel_listings')
        .select('property_id, channel, is_active, export_subscribed')
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'aggregate feeds' },
  );
  return guestyEchoPropertyIds(rows);
}

/** True when this property's direct-feed closures are dropped at import. */
export function hasAggregateFeed(set: ReadonlySet<string>, propertyId: string): boolean {
  return set.has(propertyId);
}
