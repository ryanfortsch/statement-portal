/**
 * The export pull log: which OTA fetched a property's Helm feed, and when.
 *
 * An OTA's pull of /api/channels/ical/<token> is the only evidence that the
 * OTA is actually subscribed, and the gap between pulls IS the
 * double-booking window on a Guesty-free home. The route records every GET
 * here and stopped sending s-maxage, so the CDN can no longer answer a pull
 * without this row being written. `lastPullsByProperty` feeds the channels
 * grid ("Airbnb pulled 2h ago, VRBO never"); `exportPullState` in
 * lib/ical-export turns its map into pulled / never / unknown.
 *
 * IO half of the export: the builder (ical-export.ts) stays pure and tested.
 */
import 'server-only';
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { guessChannelFromUserAgent } from '@/lib/ical-export';

export type ExportPull = {
  channel_guess: 'airbnb' | 'vrbo' | 'booking_com' | 'other' | null;
  pulled_at: string;
  user_agent: string | null;
  /** The channel the URL named (for= or listing=); null for a bare URL. */
  requested_for?: string | null;
  /** The user agent's own guess, independent of the URL. */
  ua_guess?: string | null;
  /** The URL named one OTA and the user agent another: the wrong line was
   *  pasted into that OTA. The feed was served unfiltered. */
  mismatch?: boolean;
};

/** The OTAs a pull's user agent can be credited to (guessChannelFromUserAgent). */
// 'other' is read too: a platform given its own ?listing= URL is credited
// to 'other'.
const OTA_GUESSES = ['airbnb', 'vrbo', 'booking_com', 'other'] as const;
/** Newest pulls read per OTA per property. The grid reads only the newest. */
const PULLS_PER_CHANNEL = 3;
/** Newest pulls read per property from agents no OTA was credited for. */
const ANONYMOUS_PULLS_PER_PROPERTY = 12;
/** Properties read at once; each is four small indexed reads. */
const PROPERTY_READ_CONCURRENCY = 6;

/**
 * Record one pull. Never throws: a failed log line must not fail the feed
 * the OTA is reading (a 500 here would be the double-booking, not the log).
 */
export async function recordExportPull(
  propertyId: string,
  opts: { userAgent: string | null | undefined; channel?: string | null; requestedFor?: string | null; uaGuess?: string | null },
): Promise<void> {
  if (!isServiceConfigured) return;
  const userAgent = opts.userAgent ? String(opts.userAgent).slice(0, 500) : null;
  const uaGuess = opts.uaGuess === undefined ? guessChannelFromUserAgent(userAgent) : opts.uaGuess;
  try {
    const { error } = await supabaseAdmin.from('ical_export_pulls').insert({
      property_id: propertyId,
      user_agent: userAgent,
      // Who pulled. The URL's own for= / listing= when the user agent does
      // not contradict it (the caller resolves that); else the user agent.
      channel_guess: opts.channel ?? uaGuess,
      requested_for: opts.requestedFor ?? null,
      ua_guess: uaGuess,
    });
    if (error) console.error('[ical-export-pulls] insert failed:', error.message);
  } catch (err) {
    console.error('[ical-export-pulls] insert threw:', err);
  }
}

/**
 * The most recent pulls per property, newest first: up to PULLS_PER_CHANNEL
 * per OTA plus up to ANONYMOUS_PULLS_PER_PROPERTY the user agent did not
 * name, so a caller can show the last pull per OTA and the anonymous ones.
 *
 * Every property is read on its own, and every OTA within it. One shared
 * `limit(12 * ids.length)` over the whole set let a busy feed (an export URL
 * also subscribed in a calendar app, polling every few minutes) fill the
 * window, and every quieter property fell out of the map and rendered as
 * "has never pulled Helm's export"; within one property the same poller
 * pushed a slower OTA out of the newest twelve.
 *
 * A property whose read succeeded is ALWAYS in the map, with an empty array
 * when nothing has ever pulled it. A property absent from the map is
 * unknown (its read failed), never "never pulled": exportPullState in
 * lib/ical-export draws that line for a renderer. Never throws.
 */
export async function lastPullsByProperty(ids: readonly string[]): Promise<Map<string, ExportPull[]>> {
  const out = new Map<string, ExportPull[]>();
  if (!isServiceConfigured || ids.length === 0) return out;
  const unique = [...new Set(ids.filter(Boolean))];
  let next = 0;
  const worker = async () => {
    while (next < unique.length) {
      const id = unique[next++];
      const pulls = await pullsForProperty(id);
      if (pulls) out.set(id, pulls);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PROPERTY_READ_CONCURRENCY, unique.length) }, worker));
  return out;
}

type PullRow = { channel_guess: string | null; pulled_at: string; user_agent: string | null; requested_for?: string | null; ua_guess?: string | null };

/** One property's recent pulls, newest first, or null when any read failed. */
async function pullsForProperty(propertyId: string): Promise<ExportPull[] | null> {
  const base = () =>
    supabaseAdmin
      .from('ical_export_pulls')
      .select('channel_guess, pulled_at, user_agent, requested_for, ua_guess')
      .eq('property_id', propertyId);
  try {
    const results = await Promise.all([
      ...OTA_GUESSES.map((c) =>
        base().eq('channel_guess', c).order('pulled_at', { ascending: false }).limit(PULLS_PER_CHANNEL),
      ),
      base().is('channel_guess', null).order('pulled_at', { ascending: false }).limit(ANONYMOUS_PULLS_PER_PROPERTY),
    ]);
    const rows: PullRow[] = [];
    for (const { data, error } of results) {
      if (error) {
        console.error(`[ical-export-pulls] read failed for ${propertyId}:`, error.message);
        return null;
      }
      for (const r of (data ?? []) as PullRow[]) rows.push(r);
    }
    rows.sort((a, b) => (Date.parse(b.pulled_at) || 0) - (Date.parse(a.pulled_at) || 0));
    return rows.map((r) => ({
      channel_guess: (r.channel_guess as ExportPull['channel_guess']) ?? null,
      pulled_at: r.pulled_at,
      user_agent: r.user_agent ?? null,
      requested_for: r.requested_for ?? null,
      ua_guess: r.ua_guess ?? null,
      mismatch: !!r.requested_for && !!r.ua_guess && r.requested_for !== r.ua_guess,
    }));
  } catch (err) {
    console.error(`[ical-export-pulls] read threw for ${propertyId}:`, err);
    return null;
  }
}
