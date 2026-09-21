/**
 * Server-side data access for the Channels module.
 *
 * Helm uses Google SSO via Auth.js (no Supabase Auth) so all of these
 * call through the anon-key client and rely on Helm route gating. The
 * iCal sync also writes via the service-role key from the cron route.
 */

import { supabaseAdmin as supabase, isServiceConfigured as isConfigured } from '@/lib/supabase-admin';
import type {
  Booking,
  ChannelListing,
  IcalSyncRun,
  BookingChannel,
} from '@/lib/channels-types';
import { selectAllPaged } from '@/lib/paged-select';
import { STAY_STATUSES, findDoubleBookings, type DoubleBooking } from '@/lib/booking-conflicts';

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

export async function listPropertyExportTokens(): Promise<Record<string, string>> {
  if (!isConfigured) return {};
  const { data, error } = await supabase
    .from('properties')
    .select('id, ical_export_token');
  if (error) return {};
  const map: Record<string, string> = {};
  for (const r of (data ?? []) as Array<{ id: string; ical_export_token: string | null }>) {
    if (r.ical_export_token) map[r.id] = r.ical_export_token;
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
  // Canonical rows only -- a stay deduped against another source is hidden.
  q = q.is('duplicate_of', null);
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
    .is('duplicate_of', null)
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

export async function listOpenInquiries(): Promise<Booking[]> {
  if (!isConfigured) return [];
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('status', 'inquiry')
    .is('duplicate_of', null)
    .order('created_at', { ascending: false });
  if (error) return [];
  return (data ?? []) as Booking[];
}

export type BookingConflict = DoubleBooking<Booking>;

/**
 * Pairs of stays on the same property whose nights overlap: the
 * double-booking detector. Only stays that actually happen take part
 * (confirmed or completed); inquiries, pending requests and blocks are not
 * parties to a double-booking, and booking-conflicts.ts says why. The pair
 * logic is pure and unit-tested there; this is the fetch. It runs in memory
 * because there are at most a few hundred canonical stays in the window,
 * and it pages so a growing fleet never trips PostgREST's silent 1000-row
 * cap.
 */
export async function findBookingConflicts(daysAhead = 365): Promise<BookingConflict[]> {
  if (!isConfigured) return [];
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + daysAhead * 86400_000).toISOString().slice(0, 10);
  let rows: Booking[];
  try {
    rows = await selectAllPaged<Booking>(
      (from, to) =>
        supabase
          .from('bookings')
          .select('*')
          .gte('check_out', today)
          .lte('check_in', end)
          .in('status', [...STAY_STATUSES])
          // Duplicates are the same physical stay, not a double-booking -- exclude
          // them so the dedup pass and the conflict detector never disagree.
          .is('duplicate_of', null)
          .order('property_id', { ascending: true })
          .order('check_in', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'double-bookings' },
    );
  } catch {
    return [];
  }
  return findDoubleBookings(rows);
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
    supabase.from('bookings').select('id', { count: 'exact', head: true }).gte('check_in', todayIso).neq('status', 'cancelled').is('duplicate_of', null),
    supabase.from('bookings').select('id', { count: 'exact', head: true }).gte('check_in', monthStart).lt('check_in', nextMonth).neq('status', 'cancelled').is('duplicate_of', null),
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
