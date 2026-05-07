/**
 * Server-side data access for the Channels module.
 *
 * Helm uses Google SSO via Auth.js (no Supabase Auth) so all of these
 * call through the anon-key client and rely on Helm route gating. The
 * iCal sync also writes via the service-role key from the cron route.
 */

import { supabase, isConfigured } from '@/lib/supabase';
import type {
  Booking,
  ChannelListing,
  IcalSyncRun,
  BookingChannel,
} from '@/lib/channels-types';

export type ListingWithRecentRuns = ChannelListing & {
  recent_runs: IcalSyncRun[];
};

export async function listChannelListings(): Promise<ChannelListing[]> {
  if (!isConfigured) return [];
  const { data, error } = await supabase
    .from('channel_listings')
    .select('*')
    .order('property_id')
    .order('channel');
  if (error) throw new Error(`channel_listings: ${error.message}`);
  return (data ?? []) as ChannelListing[];
}

export async function listChannelListingsByProperty(): Promise<Record<string, ChannelListing[]>> {
  const all = await listChannelListings();
  const map: Record<string, ChannelListing[]> = {};
  for (const l of all) {
    (map[l.property_id] ??= []).push(l);
  }
  return map;
}

export async function getChannelListing(id: string): Promise<ChannelListing | null> {
  if (!isConfigured) return null;
  const { data, error } = await supabase
    .from('channel_listings')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as ChannelListing | null;
}

export async function listBookings(opts: {
  propertyId?: string;
  channel?: BookingChannel;
  fromDate?: string;       // YYYY-MM-DD inclusive (filter on check_in)
  toDate?: string;         // YYYY-MM-DD inclusive
  limit?: number;
} = {}): Promise<Booking[]> {
  if (!isConfigured) return [];
  let q = supabase.from('bookings').select('*').order('check_in', { ascending: true });

  if (opts.propertyId) q = q.eq('property_id', opts.propertyId);
  if (opts.channel) q = q.eq('channel', opts.channel);
  if (opts.fromDate) q = q.gte('check_in', opts.fromDate);
  if (opts.toDate) q = q.lte('check_in', opts.toDate);
  q = q.limit(opts.limit ?? 500);

  const { data, error } = await q;
  if (error) throw new Error(`bookings: ${error.message}`);
  return (data ?? []) as Booking[];
}

export async function listUpcomingBookings(daysAhead = 14): Promise<Booking[]> {
  if (!isConfigured) return [];
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + daysAhead * 86400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .gte('check_in', today)
    .lte('check_in', end)
    .neq('status', 'cancelled')
    .order('check_in', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Booking[];
}

export async function listRecentSyncRuns(limit = 50): Promise<IcalSyncRun[]> {
  if (!isConfigured) return [];
  const { data, error } = await supabase
    .from('ical_sync_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as IcalSyncRun[];
}

export type ChannelStats = {
  totalListings: number;
  activeListings: number;
  withFeedConfigured: number;
  syncedListings: number;
  feedsErroring: number;
  upcomingBookings: number;
  bookingsThisMonth: number;
};

export async function getChannelStats(): Promise<ChannelStats> {
  if (!isConfigured) {
    return {
      totalListings: 0,
      activeListings: 0,
      withFeedConfigured: 0,
      syncedListings: 0,
      feedsErroring: 0,
      upcomingBookings: 0,
      bookingsThisMonth: 0,
    };
  }

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const monthStart = `${todayIso.slice(0, 7)}-01`;
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1).toISOString().slice(0, 10);

  const [listingsRes, upcomingRes, monthRes] = await Promise.all([
    supabase.from('channel_listings').select('id, is_active, ical_import_url, last_import_status, last_imported_at'),
    supabase.from('bookings').select('id', { count: 'exact', head: true }).gte('check_in', todayIso).neq('status', 'cancelled'),
    supabase.from('bookings').select('id', { count: 'exact', head: true }).gte('check_in', monthStart).lt('check_in', nextMonth).neq('status', 'cancelled'),
  ]);

  const listings = (listingsRes.data ?? []) as Array<{
    id: string;
    is_active: boolean;
    ical_import_url: string | null;
    last_import_status: string | null;
    last_imported_at: string | null;
  }>;

  return {
    totalListings: listings.length,
    activeListings: listings.filter((l) => l.is_active).length,
    withFeedConfigured: listings.filter((l) => !!l.ical_import_url).length,
    syncedListings: listings.filter((l) => !!l.last_imported_at).length,
    feedsErroring: listings.filter((l) => l.last_import_status === 'error').length,
    upcomingBookings: upcomingRes.count ?? 0,
    bookingsThisMonth: monthRes.count ?? 0,
  };
}
