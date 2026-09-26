/**
 * The export pull log: which OTA fetched a property's Helm feed, and when.
 *
 * An OTA's pull of /api/channels/ical/<token> is the only evidence that the
 * OTA is actually subscribed, and the gap between pulls IS the
 * double-booking window on a Guesty-free home. The route records every GET
 * here and stopped sending s-maxage, so the CDN can no longer answer a pull
 * without this row being written. `lastPullsByProperty` feeds the channels
 * grid ("Airbnb pulled 2h ago, VRBO never").
 *
 * IO half of the export: the builder (ical-export.ts) stays pure and tested.
 */
import 'server-only';
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { guessChannelFromUserAgent } from '@/lib/ical-export';

export type ExportPull = {
  channel_guess: 'airbnb' | 'vrbo' | 'booking_com' | null;
  pulled_at: string;
  user_agent: string | null;
};

/** How many recent pulls lastPullsByProperty reads per property, at most. */
const PULLS_PER_PROPERTY = 12;

/**
 * Record one pull. Never throws: a failed log line must not fail the feed
 * the OTA is reading (a 500 here would be the double-booking, not the log).
 */
export async function recordExportPull(
  propertyId: string,
  opts: { userAgent: string | null | undefined },
): Promise<void> {
  if (!isServiceConfigured) return;
  const userAgent = opts.userAgent ? String(opts.userAgent).slice(0, 500) : null;
  try {
    const { error } = await supabaseAdmin.from('ical_export_pulls').insert({
      property_id: propertyId,
      user_agent: userAgent,
      channel_guess: guessChannelFromUserAgent(userAgent),
    });
    if (error) console.error('[ical-export-pulls] insert failed:', error.message);
  } catch (err) {
    console.error('[ical-export-pulls] insert threw:', err);
  }
}

/**
 * The most recent pulls per property, newest first, at most
 * PULLS_PER_PROPERTY each, so a caller can show the last pull per OTA.
 * Properties with no pulls are absent from the map. Empty on a failed read.
 */
export async function lastPullsByProperty(ids: readonly string[]): Promise<Map<string, ExportPull[]>> {
  const out = new Map<string, ExportPull[]>();
  if (!isServiceConfigured || ids.length === 0) return out;
  try {
    // One bounded read: the newest N * ids rows over the requested set, then
    // trimmed per property. The index on (property_id, pulled_at desc) makes
    // this cheap, and a property that is pulled every three hours by three
    // OTAs produces a day's rows within the bound.
    const { data, error } = await supabaseAdmin
      .from('ical_export_pulls')
      .select('property_id, channel_guess, pulled_at, user_agent')
      .in('property_id', [...ids])
      .order('pulled_at', { ascending: false })
      .limit(PULLS_PER_PROPERTY * ids.length);
    if (error) {
      console.error('[ical-export-pulls] read failed:', error.message);
      return out;
    }
    for (const r of data ?? []) {
      const pid = r.property_id as string;
      const arr = out.get(pid) ?? [];
      if (arr.length >= PULLS_PER_PROPERTY) continue;
      arr.push({
        channel_guess: (r.channel_guess as ExportPull['channel_guess']) ?? null,
        pulled_at: r.pulled_at as string,
        user_agent: (r.user_agent as string | null) ?? null,
      });
      out.set(pid, arr);
    }
  } catch (err) {
    console.error('[ical-export-pulls] read threw:', err);
  }
  return out;
}
