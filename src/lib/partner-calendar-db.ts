/**
 * A partner home's own calendars: the feeds, their reads, and the nights
 * they hold (the rules are src/lib/partner-calendar.ts).
 *
 * The office adds each of the host's calendar export links on the home's
 * property page. /api/cron/channels-sync reads them every 30 minutes and
 * Accept on /guests/requests reads the home's again before it books, so a
 * night the host sold on Airbnb a minute ago stops the yes.
 *
 * This module never touches bookings or channel_listings, and never imports
 * the PMS bridge: the bridge reads the holds from here.
 */

import { supabaseAdmin, isServiceConfigured } from './supabase-admin.ts';
import { selectAllPaged } from './paged-select.ts';
import { parseIcal } from './ical.ts';
import { todayInEastern } from './sca-quotes-types.ts';
import {
  asAvailability,
  emptyFeedSuspicious,
  holdsFromEvents,
  maskFeedUrl,
  MAX_FEED_BYTES,
  type PartnerFeedChannel,
} from './partner-calendar.ts';

const FEEDS = 'partner_calendar_feeds';
const HOLDS = 'partner_calendar_holds';
const FEED_COLS = 'id, property_id, channel, url, added_by, last_synced_at, last_tried_at, last_error, hold_count, created_at';
const FETCH_TIMEOUT_MS = 20_000;

export type PartnerFeed = {
  id: string;
  property_id: string;
  channel: PartnerFeedChannel;
  url: string;
  added_by: string | null;
  last_synced_at: string | null;
  last_tried_at: string | null;
  last_error: string | null;
  hold_count: number | null;
  created_at: string;
};

function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === '42P01' || err.code === 'PGRST205' || /could not find the table|does not exist/i.test(err.message ?? '');
}

/** One home's feeds, oldest first. Null when the table cannot be read. */
export async function listPartnerFeeds(propertyId: string): Promise<PartnerFeed[] | null> {
  if (!isServiceConfigured) return null;
  const { data, error } = await supabaseAdmin.from(FEEDS).select(FEED_COLS).eq('property_id', propertyId).order('created_at', { ascending: true });
  if (error) {
    if (!isMissingTable(error)) console.error('[partner-calendar] feeds read failed', error.message);
    return null;
  }
  return (data ?? []) as PartnerFeed[];
}

export async function addPartnerFeed(propertyId: string, url: string, channel: PartnerFeedChannel, by: string): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  if (!isServiceConfigured) return { ok: false, reason: 'Helm is not connected to its database.' };
  const { data, error } = await supabaseAdmin
    .from(FEEDS)
    .insert({ property_id: propertyId, url, channel, added_by: by })
    .select('id')
    .maybeSingle();
  if (error) {
    if (error.code === '23505') return { ok: false, reason: 'That calendar is already added.' };
    if (error.code === '23514') return { ok: false, reason: 'Only a partner home reads its calendars here.' };
    return { ok: false, reason: error.message };
  }
  return { ok: true, id: String((data as { id: string }).id) };
}

/** Removing a feed drops the nights it held (the holds cascade). */
export async function removePartnerFeed(propertyId: string, feedId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isServiceConfigured) return { ok: false, reason: 'Helm is not connected to its database.' };
  const { error } = await supabaseAdmin.from(FEEDS).delete().eq('id', feedId).eq('property_id', propertyId);
  return error ? { ok: false, reason: error.message } : { ok: true };
}

export type FeedReadResult = { feed_id: string; property_id: string; ok: boolean; holds?: number; error?: string };

async function fetchFeedText(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: 'text/calendar, text/plain;q=0.8, */*;q=0.5' },
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '';
    if (name === 'TimeoutError' || name === 'AbortError') throw new Error(`no answer from ${maskFeedUrl(url)} in ${FETCH_TIMEOUT_MS / 1000}s`);
    throw new Error(`could not reach ${maskFeedUrl(url)}`);
  }
  if (!res.ok) throw new Error(`${maskFeedUrl(url)} answered ${res.status}`);
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_FEED_BYTES) throw new Error(`${maskFeedUrl(url)} sent more than a calendar`);
  const text = await res.text();
  if (text.length > MAX_FEED_BYTES) throw new Error(`${maskFeedUrl(url)} sent more than a calendar`);
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error(`${maskFeedUrl(url)} did not send a calendar`);
  return text;
}

async function futureHoldCount(feedId: string, todayIso: string): Promise<number> {
  const { count, error } = await supabaseAdmin.from(HOLDS).select('id', { count: 'exact', head: true }).eq('feed_id', feedId).eq('kind', 'stay').gt('check_out', todayIso);
  if (error) throw new Error(`partner holds count failed: ${error.message}`);
  return count ?? 0;
}

async function recordFailure(feedId: string, message: string, at: string): Promise<void> {
  await supabaseAdmin.from(FEEDS).update({ last_tried_at: at, last_error: message.slice(0, 300) }).eq('id', feedId);
}

/** Read one feed and replace its nights, or keep the last good read and say why. Never throws. */
export async function readPartnerFeed(feed: Pick<PartnerFeed, 'id' | 'property_id' | 'channel' | 'url'>, now: Date = new Date()): Promise<FeedReadResult> {
  const at = now.toISOString();
  const today = todayInEastern(now);
  try {
    const text = await fetchFeedText(feed.url);
    const holds = holdsFromEvents(parseIcal(text), feed.channel, today);
    if (emptyFeedSuspicious(holds, await futureHoldCount(feed.id, today))) {
      const msg = 'came back empty; kept the last good read';
      await recordFailure(feed.id, msg, at);
      return { feed_id: feed.id, property_id: feed.property_id, ok: false, error: msg };
    }
    const { data, error } = await supabaseAdmin.rpc('replace_partner_calendar_holds', { p_feed_id: feed.id, p_holds: holds, p_read_at: at });
    if (error) throw new Error(`saving the nights failed: ${error.message}`);
    return { feed_id: feed.id, property_id: feed.property_id, ok: true, holds: Number(data ?? holds.length) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await recordFailure(feed.id, msg, at);
    } catch {
      // the next read records it
    }
    return { feed_id: feed.id, property_id: feed.property_id, ok: false, error: msg };
  }
}

/**
 * Read every partner feed, or one home's. Sequential: a handful of homes,
 * each a few feeds, and an OTA that throttles a burst answers slower.
 */
export async function syncPartnerFeeds(opts: { propertyId?: string; now?: Date } = {}): Promise<{ total: number; ok: number; failed: number; results: FeedReadResult[] } | { skipped: string }> {
  if (!isServiceConfigured) return { skipped: 'not_configured' };
  let q = supabaseAdmin.from(FEEDS).select('id, property_id, channel, url').order('property_id', { ascending: true }).order('created_at', { ascending: true });
  if (opts.propertyId) q = q.eq('property_id', opts.propertyId);
  const { data, error } = await q;
  if (error) {
    if (isMissingTable(error)) return { skipped: 'migration_not_applied' };
    return { skipped: `feeds read failed: ${error.message}` };
  }
  const results: FeedReadResult[] = [];
  for (const f of (data ?? []) as Array<Pick<PartnerFeed, 'id' | 'property_id' | 'channel' | 'url'>>) {
    results.push(await readPartnerFeed(f, opts.now));
  }
  return { total: results.length, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}

/**
 * The nights a partner home's own calendars hold in [start, endExclusive),
 * as the availability engine reads them. Throws on a failed read: a calendar
 * that cannot see the host's stays must not sell them again.
 */
export async function partnerHoldsInWindow(propertyId: string, start: string, endExclusive: string): Promise<Array<{ status: string; check_in: string; check_out: string; source: string }>> {
  const rows = await selectAllPaged<{ kind: 'stay' | 'block'; check_in: string; check_out: string }>(
    (from, to) =>
      supabaseAdmin
        .from(HOLDS)
        .select('kind, check_in, check_out, id')
        .eq('property_id', propertyId)
        .lt('check_in', endExclusive)
        .gt('check_out', start)
        .order('check_in', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    { label: `partner holds ${propertyId}` },
  );
  return rows.map(asAvailability);
}

/** Accepted staycapeann.com stays at a partner home from `fromIso`, for its export. Throws on a failed read. */
export async function acceptedStaysForExport(propertyId: string, fromIso: string): Promise<Array<{ id: string; check_in: string; check_out: string }>> {
  return selectAllPaged<{ id: string; check_in: string; check_out: string }>(
    (from, to) =>
      supabaseAdmin
        .from('booking_requests')
        .select('id, check_in, check_out')
        .eq('property_id', propertyId)
        .eq('status', 'accepted')
        .gt('check_out', fromIso)
        .order('check_in', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    { label: `partner export ${propertyId}` },
  );
}
