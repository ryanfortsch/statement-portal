// Orchestrator: pull GA4 + Vercel Speed Insights for one site/date and
// upsert into Supabase. Each fetcher is wrapped in its own try so a
// single failing dimension doesn't sink the whole sync. Used by both
// the daily cron route and the 90-day backfill script.

import { createClient } from '@supabase/supabase-js';
import {
  fetchTraffic,
  fetchTopPages,
  fetchTopSources,
  fetchConversions,
  fetchUnknownSourceLandings,
} from './ga4';
import { fetchSpeedInsights } from './vercel-speed';

type Site = {
  id: string;
  ga4_property_id: string;
  vercel_project_id: string | null;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';
const supabase = createClient(supabaseUrl, supabaseKey);

export type SyncResult = {
  site_id: string;
  date: string;
  sessions?: number;
  top_pages?: number;
  top_sources?: number;
  conversions?: number;
  unknown_landings?: number;
  speed_insights?: 'ok' | 'no_data' | 'no_project_id';
  errors: string[];
};

export async function syncSiteForDate(site: Site, date: string): Promise<SyncResult> {
  const errors: string[] = [];
  const out: SyncResult = { site_id: site.id, date, errors };
  const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

  // ── Traffic totals ──────────────────────────────────────────────
  try {
    const traffic = await fetchTraffic(site.ga4_property_id, date);
    const { error } = await supabase
      .from('marketing_traffic_daily')
      .upsert({ site_id: site.id, date, ...traffic, updated_at: new Date().toISOString() });
    if (error) throw error;
    out.sessions = traffic.sessions;
  } catch (e) {
    errors.push(`traffic: ${errMsg(e)}`);
  }

  // ── Top pages ───────────────────────────────────────────────────
  try {
    const pages = await fetchTopPages(site.ga4_property_id, date);
    // Wipe + reinsert rather than upsert: top-N rankings can shift,
    // and we want the table to reflect the current list, not a union.
    await supabase.from('marketing_top_pages_daily').delete().eq('site_id', site.id).eq('date', date);
    if (pages.length > 0) {
      const { error } = await supabase
        .from('marketing_top_pages_daily')
        .insert(pages.map((p) => ({ site_id: site.id, date, ...p })));
      if (error) throw error;
    }
    out.top_pages = pages.length;
  } catch (e) {
    errors.push(`top_pages: ${errMsg(e)}`);
  }

  // ── Top sources ─────────────────────────────────────────────────
  try {
    const sources = await fetchTopSources(site.ga4_property_id, date);
    await supabase.from('marketing_top_sources_daily').delete().eq('site_id', site.id).eq('date', date);
    if (sources.length > 0) {
      const { error } = await supabase
        .from('marketing_top_sources_daily')
        .insert(sources.map((s) => ({ site_id: site.id, date, ...s })));
      if (error) throw error;
    }
    out.top_sources = sources.length;
  } catch (e) {
    errors.push(`top_sources: ${errMsg(e)}`);
  }

  // ── Conversions ─────────────────────────────────────────────────
  try {
    const convs = await fetchConversions(site.ga4_property_id, date);
    await supabase.from('marketing_conversions_daily').delete().eq('site_id', site.id).eq('date', date);
    if (convs.length > 0) {
      const { error } = await supabase
        .from('marketing_conversions_daily')
        .insert(convs.map((c) => ({ site_id: site.id, date, ...c })));
      if (error) throw error;
    }
    out.conversions = convs.length;
  } catch (e) {
    errors.push(`conversions: ${errMsg(e)}`);
  }

  // ── Unknown-source landings ─────────────────────────────────────
  // Landing pages for sessions GA couldn't attribute (source = "(not set)").
  // Drives the "where does the unknown traffic land" answer in the dashboard.
  try {
    const unknowns = await fetchUnknownSourceLandings(site.ga4_property_id, date);
    await supabase
      .from('marketing_unknown_landings_daily')
      .delete()
      .eq('site_id', site.id)
      .eq('date', date);
    if (unknowns.length > 0) {
      const { error } = await supabase
        .from('marketing_unknown_landings_daily')
        .insert(unknowns.map((u) => ({ site_id: site.id, date, ...u })));
      if (error) throw error;
    }
    out.unknown_landings = unknowns.length;
  } catch (e) {
    errors.push(`unknown_landings: ${errMsg(e)}`);
  }

  // ── Speed Insights (Vercel) ─────────────────────────────────────
  if (site.vercel_project_id) {
    try {
      const si = await fetchSpeedInsights(site.vercel_project_id, date);
      if (si) {
        const { error } = await supabase
          .from('marketing_speed_insights_daily')
          .upsert({ site_id: site.id, date, ...si, updated_at: new Date().toISOString() });
        if (error) throw error;
        out.speed_insights = 'ok';
      } else {
        out.speed_insights = 'no_data';
      }
    } catch (e) {
      errors.push(`speed_insights: ${errMsg(e)}`);
    }
  } else {
    out.speed_insights = 'no_project_id';
  }

  return out;
}

export async function syncAllSitesForDate(date: string): Promise<SyncResult[]> {
  const { data: sites, error } = await supabase
    .from('marketing_sites')
    .select('id, ga4_property_id, vercel_project_id');
  if (error) throw new Error(`Failed to load sites: ${error.message}`);

  const results: SyncResult[] = [];
  for (const site of (sites ?? []) as Site[]) {
    results.push(await syncSiteForDate(site, date));
  }
  return results;
}

// YYYY-MM-DD for "yesterday" in UTC. Used by the cron to pull the
// most recently finalized day of GA4 data.
export function yesterdayUTC(): string {
  return new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
}
