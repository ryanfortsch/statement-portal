// Supabase aggregations for the /marketing dashboard. All queries take
// a site filter ('all' | site_id) and a window in days, and aggregate
// across the rows in marketing_*_daily tables. Reads only -- the cron
// (sync.ts) is the sole writer.
//
// For 'all', metrics sum across both sites; for charts the time series
// is also summed (one combined line). For per-site mode we filter to
// that site_id. Top-N tables are summed by their dimension(s) over the
// window, then sorted desc and sliced.

import { supabase } from '@/lib/supabase';
import { findScaListingByGuestyId } from '@/lib/sca-listings';

export type SiteFilter = 'all' | string;

export type RangeBounds = {
  /** YYYY-MM-DD inclusive lower bound */
  start: string;
  /** YYYY-MM-DD inclusive upper bound (d-1, since GA4 finalizes the prior day) */
  end: string;
};

export function rangeForDays(days: number): RangeBounds {
  const dayMs = 24 * 3600 * 1000;
  const end = new Date(Date.now() - dayMs).toISOString().slice(0, 10);
  const start = new Date(Date.now() - days * dayMs).toISOString().slice(0, 10);
  return { start, end };
}

export function previousRange(days: number): RangeBounds {
  const dayMs = 24 * 3600 * 1000;
  const end = new Date(Date.now() - (days + 1) * dayMs).toISOString().slice(0, 10);
  const start = new Date(Date.now() - days * 2 * dayMs).toISOString().slice(0, 10);
  return { start, end };
}

// Generic helper: Supabase's chained query types are too deep for TS to
// infer through, so we widen and re-cast.
function applySiteFilter<T>(q: T, site: SiteFilter): T {
  if (site === 'all') return q;
  return (q as unknown as { eq: (col: string, val: string) => T }).eq('site_id', site);
}

// ── Stat totals ────────────────────────────────────────────────────────
export type StatTotals = {
  sessions: number;
  users: number;
  new_users: number;
  page_views: number;
  conversions: number;
};

export async function getStatTotals(site: SiteFilter, range: RangeBounds): Promise<StatTotals> {
  const trafficQ = applySiteFilter(
    supabase.from('marketing_traffic_daily').select('sessions, users, new_users, page_views'),
    site,
  )
    .gte('date', range.start)
    .lte('date', range.end);
  const convQ = applySiteFilter(
    supabase.from('marketing_conversions_daily').select('count'),
    site,
  )
    .gte('date', range.start)
    .lte('date', range.end);

  const [{ data: traffic }, { data: convs }] = await Promise.all([trafficQ, convQ]);
  const t = (traffic ?? []) as Array<Pick<StatTotals, 'sessions' | 'users' | 'new_users' | 'page_views'>>;
  const c = (convs ?? []) as Array<{ count: number }>;
  return {
    sessions: t.reduce((s, r) => s + (r.sessions ?? 0), 0),
    users: t.reduce((s, r) => s + (r.users ?? 0), 0),
    new_users: t.reduce((s, r) => s + (r.new_users ?? 0), 0),
    page_views: t.reduce((s, r) => s + (r.page_views ?? 0), 0),
    conversions: c.reduce((s, r) => s + (r.count ?? 0), 0),
  };
}

// ── Traffic time series (one point per date) ──────────────────────────
export type TrafficPoint = { date: string; sessions: number; users: number };

export async function getTrafficSeries(site: SiteFilter, range: RangeBounds): Promise<TrafficPoint[]> {
  const { data } = await applySiteFilter(
    supabase.from('marketing_traffic_daily').select('date, sessions, users'),
    site,
  )
    .gte('date', range.start)
    .lte('date', range.end)
    .order('date', { ascending: true });

  // Sum across sites for the same date when site === 'all'.
  const byDate = new Map<string, TrafficPoint>();
  for (const row of (data ?? []) as Array<{ date: string; sessions: number; users: number }>) {
    const cur = byDate.get(row.date) ?? { date: row.date, sessions: 0, users: 0 };
    cur.sessions += row.sessions ?? 0;
    cur.users += row.users ?? 0;
    byDate.set(row.date, cur);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ── Top sources ──────────────────────────────────────────────────────
export type SourceRow = { source: string; medium: string; sessions: number; users: number };

export async function getTopSources(
  site: SiteFilter,
  range: RangeBounds,
  limit = 10,
): Promise<SourceRow[]> {
  const { data } = await applySiteFilter(
    supabase.from('marketing_top_sources_daily').select('source, medium, sessions, users'),
    site,
  )
    .gte('date', range.start)
    .lte('date', range.end);

  const byKey = new Map<string, SourceRow>();
  for (const r of (data ?? []) as SourceRow[]) {
    const key = `${r.source}|${r.medium}`;
    const cur = byKey.get(key) ?? { source: r.source, medium: r.medium, sessions: 0, users: 0 };
    cur.sessions += r.sessions ?? 0;
    cur.users += r.users ?? 0;
    byKey.set(key, cur);
  }
  return [...byKey.values()].sort((a, b) => b.sessions - a.sessions).slice(0, limit);
}

// ── Top pages (by GA4 page views) ────────────────────────────────────
export type PageRow = {
  page_path: string;
  page_views: number;
  sessions: number;
  /** Friendly label: Helm internal property name for /stays/<id> paths, raw path otherwise. */
  display: string;
  /** True when the path is a recognized SCA listing (resolvable via Helm properties or the bundled snapshot). */
  is_listing: boolean;
};

// "21 Horton St, Gloucester, MA 01930, USA" -> "21 Horton"
// Used only as a fallback when a Guesty id isn't in the Helm properties
// table. Strips common US street suffixes from the first comma segment.
const STREET_SUFFIX_RE =
  /\s+(St|Street|Ave|Avenue|Rd|Road|Ln|Lane|Dr|Drive|Way|Ct|Court|Blvd|Boulevard|Pl|Place|Pkwy|Parkway|Cir|Circle|Hwy|Highway|Ter|Terrace)\.?$/i;

function internalNameFromAddress(addressFull: string): string {
  const firstSegment = addressFull.split(',')[0].trim();
  return firstSegment.replace(STREET_SUFFIX_RE, '');
}

// Map of Guesty listing id -> Helm internal property name. Loaded once
// per request from the properties table; absent ids fall back to the
// bundled SCA snapshot (address parse).
async function getGuestyIdToInternalName(): Promise<Map<string, string>> {
  const { data } = await supabase
    .from('properties')
    .select('guesty_listing_id, name')
    .not('guesty_listing_id', 'is', null);
  const m = new Map<string, string>();
  for (const r of (data ?? []) as { guesty_listing_id: string | null; name: string }[]) {
    if (r.guesty_listing_id) m.set(r.guesty_listing_id, r.name);
  }
  return m;
}

function resolvePagePath(
  path: string,
  helmNames: Map<string, string>,
): { display: string; is_listing: boolean } {
  const m = path.match(/^\/stays\/([a-f0-9]{24})\/?$/);
  if (m) {
    const guestyId = m[1];
    // Source of truth: Helm properties.name (e.g., "21 Horton").
    const helmName = helmNames.get(guestyId);
    if (helmName) return { display: helmName, is_listing: true };
    // Fallback: parse the address from the bundled SCA snapshot.
    const listing = findScaListingByGuestyId(guestyId);
    if (listing?.address?.full) {
      return { display: internalNameFromAddress(listing.address.full), is_listing: true };
    }
    if (listing) return { display: listing.title, is_listing: true };
  }
  return { display: path, is_listing: false };
}

export async function getTopPages(
  site: SiteFilter,
  range: RangeBounds,
  limit = 10,
): Promise<PageRow[]> {
  const [{ data }, helmNames] = await Promise.all([
    applySiteFilter(
      supabase.from('marketing_top_pages_daily').select('page_path, page_views, sessions'),
      site,
    )
      .gte('date', range.start)
      .lte('date', range.end),
    getGuestyIdToInternalName(),
  ]);

  const byPath = new Map<string, { page_path: string; page_views: number; sessions: number }>();
  for (const r of (data ?? []) as { page_path: string; page_views: number; sessions: number }[]) {
    const cur = byPath.get(r.page_path) ?? { page_path: r.page_path, page_views: 0, sessions: 0 };
    cur.page_views += r.page_views ?? 0;
    cur.sessions += r.sessions ?? 0;
    byPath.set(r.page_path, cur);
  }
  return [...byPath.values()]
    .sort((a, b) => b.page_views - a.page_views)
    .slice(0, limit)
    .map((r) => ({ ...r, ...resolvePagePath(r.page_path, helmNames) }));
}

// ── Unknown-source landing pages ─────────────────────────────────────
// Top landing pages for sessions GA couldn't attribute (source = "(not
// set)"). Aggregated over the date range. Resolves /stays/<guesty-id>
// paths to internal Helm property names where possible, same as the
// regular top-pages table.
export type UnknownLandingDisplayRow = {
  landing_page: string;
  display: string;
  sessions: number;
  users: number;
};

export async function getTopUnknownLandings(
  site: SiteFilter,
  range: RangeBounds,
  limit = 10,
): Promise<UnknownLandingDisplayRow[]> {
  const [{ data }, helmNames] = await Promise.all([
    applySiteFilter(
      supabase
        .from('marketing_unknown_landings_daily')
        .select('landing_page, sessions, users'),
      site,
    )
      .gte('date', range.start)
      .lte('date', range.end),
    getGuestyIdToInternalName(),
  ]);

  const byPath = new Map<string, { landing_page: string; sessions: number; users: number }>();
  for (const r of (data ?? []) as { landing_page: string; sessions: number; users: number }[]) {
    const cur = byPath.get(r.landing_page) ?? { landing_page: r.landing_page, sessions: 0, users: 0 };
    cur.sessions += r.sessions ?? 0;
    cur.users += r.users ?? 0;
    byPath.set(r.landing_page, cur);
  }
  return [...byPath.values()]
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, limit)
    .map((r) => ({ ...r, display: resolvePagePath(r.landing_page, helmNames).display }));
}

// ── Speed Insights (latest per site) ─────────────────────────────────
export type SpeedRow = {
  site_id: string;
  date: string;
  lcp_p75_ms: number | null;
  inp_p75_ms: number | null;
  cls_p75: number | null;
};

export async function getLatestSpeedInsights(site: SiteFilter): Promise<SpeedRow[]> {
  const { data } = await applySiteFilter(
    supabase
      .from('marketing_speed_insights_daily')
      .select('site_id, date, lcp_p75_ms, inp_p75_ms, cls_p75'),
    site,
  )
    .order('date', { ascending: false });

  // One row per site (the most recent date present).
  const seen = new Set<string>();
  const out: SpeedRow[] = [];
  for (const r of (data ?? []) as SpeedRow[]) {
    if (seen.has(r.site_id)) continue;
    seen.add(r.site_id);
    out.push(r);
  }
  return out;
}

// ── Last updated (max updated_at across the traffic table) ───────────
export async function getLastUpdated(): Promise<string | null> {
  const { data } = await supabase
    .from('marketing_traffic_daily')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1);
  return (data?.[0] as { updated_at?: string } | undefined)?.updated_at ?? null;
}

// ── Sites (for the selector) ─────────────────────────────────────────
export type SiteRow = { id: string; name: string };

export async function getSites(): Promise<SiteRow[]> {
  const { data } = await supabase
    .from('marketing_sites')
    .select('id, name')
    .order('name', { ascending: true });
  return (data ?? []) as SiteRow[];
}

// ── Delta helper (current vs previous, returns percent change) ───────
export function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}
