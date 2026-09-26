/**
 * Server-side data access for the Channels module.
 *
 * Service role throughout: channel_listings and ical_sync_runs are RLS-locked
 * to the service role (20260926200000_helm_pms_plumbing.sql), so an anon read
 * would silently see zero rows. Helm's own Google SSO gate (src/proxy.ts) is
 * what keeps these pages private; the iCal sync writes from the cron route.
 *
 * The new per-property reads at the bottom (listBookingsForProperty,
 * loadFeedHealth, listAutomationSends, ...) feed the property hub, the two
 * calendars and the booking record. Reads that can grow page through
 * selectAllPaged; the rest are bounded by a property or a booking id.
 */

import { supabaseAdmin as supabase, isServiceConfigured as isConfigured } from '@/lib/supabase-admin';
import type {
  Booking,
  BookingFinance,
  ChannelListing,
  IcalSyncRun,
  BookingChannel,
} from '@/lib/channels-types';
import { selectAllPaged } from '@/lib/paged-select';
import { STAY_STATUSES, findDoubleBookings, type DoubleBooking } from '@/lib/booking-conflicts';
import { lastPullsByProperty, type ExportPull } from '@/lib/ical-export-pulls';

/**
 * channel_listings gained four columns in the PMS plumbing migration that
 * channels-types.ts (kept in sync with the 20260507b DDL) does not carry yet.
 * select('*') returns them; this type names them for the pages.
 */
export type ChannelListingEx = ChannelListing & {
  external_room_id: string | null;
  rates_managed_by: 'guesty' | 'pricelabs' | 'ota_ui' | 'helm';
  export_subscribed: boolean;
  export_subscribed_at: string | null;
};

/** Likewise for the bookings columns the plumbing added. */
export type BookingEx = Booking & {
  guest_id: string | null;
  hold_kind: 'owner' | 'maintenance' | 'ota' | 'other' | null;
  booked_at: string | null;
  created_by: string | null;
  cancel_reason: string | null;
  cancelled_by: string | null;
  source_ref: string | null;
};

export type ListingWithRecentRuns = ChannelListing & {
  recent_runs: IcalSyncRun[];
};

export async function listChannelListings(): Promise<ChannelListingEx[]> {
  if (!isConfigured) return [];
  const { data, error } = await supabase
    .from('channel_listings')
    .select('*')
    .order('property_id')
    .order('channel');
  if (error) throw new Error(`channel_listings: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map(shapeListing);
}

/** Older rows (or a row written before the plumbing migration) get the column defaults. */
export function shapeListing(raw: Record<string, unknown>): ChannelListingEx {
  const r = raw as unknown as ChannelListing & Partial<ChannelListingEx>;
  const rm = String(r.rates_managed_by ?? 'guesty');
  return {
    ...r,
    external_room_id: r.external_room_id ?? null,
    rates_managed_by: (['guesty', 'pricelabs', 'ota_ui', 'helm'].includes(rm) ? rm : 'guesty') as ChannelListingEx['rates_managed_by'],
    export_subscribed: !!r.export_subscribed,
    export_subscribed_at: r.export_subscribed_at ?? null,
  };
}

export async function listChannelListingsByProperty(): Promise<Record<string, ChannelListingEx[]>> {
  const all = await listChannelListings();
  const map: Record<string, ChannelListingEx[]> = {};
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

// ── Per-property reads for the hub, the calendars and the record ────────────

/**
 * Every canonical row of one property that touches [start, end] (inclusive
 * dates), any status, ordered by check-in. Paged: a home with years of
 * Guesty history can exceed PostgREST's silent 1000-row cap.
 */
export async function listBookingsForProperty(propertyId: string, start: string, end: string): Promise<BookingEx[]> {
  if (!isConfigured || !propertyId) return [];
  return selectAllPaged<BookingEx>(
    (from, to) =>
      supabase
        .from('bookings')
        .select('*')
        .eq('property_id', propertyId)
        .is('duplicate_of', null)
        .lte('check_in', end.slice(0, 10))
        .gt('check_out', start.slice(0, 10))
        .order('check_in', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    { label: `bookings ${propertyId}` },
  );
}

/**
 * Canonical, non-cancelled rows across a set of properties that touch the
 * window: the multi-calendar's one read. Inquiries and pendings come along
 * (the grid dims them) so the operator sees a request over a vacant week.
 */
export async function listBookingsInWindow(propertyIds: readonly string[], start: string, end: string): Promise<BookingEx[]> {
  if (!isConfigured || propertyIds.length === 0) return [];
  return selectAllPaged<BookingEx>(
    (from, to) =>
      supabase
        .from('bookings')
        .select('*')
        .in('property_id', [...propertyIds])
        .is('duplicate_of', null)
        .neq('status', 'cancelled')
        .lte('check_in', end.slice(0, 10))
        .gt('check_out', start.slice(0, 10))
        .order('property_id', { ascending: true })
        .order('check_in', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'bookings window' },
  );
}

/** One booking by id, with the plumbing columns. */
export async function getBookingEx(id: string): Promise<BookingEx | null> {
  if (!isConfigured || !id) return null;
  const { data, error } = await supabase.from('bookings').select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return data as BookingEx;
}

/** id -> number of rows marked duplicate_of it (the echoes the dedupe folded in). */
export async function countEchoes(bookingIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!isConfigured || bookingIds.length === 0) return out;
  const ids = [...new Set(bookingIds)];
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    const { data, error } = await supabase.from('bookings').select('duplicate_of').in('duplicate_of', slice);
    if (error || !data) continue;
    for (const r of data as Array<{ duplicate_of: string | null }>) {
      if (!r.duplicate_of) continue;
      out.set(r.duplicate_of, (out.get(r.duplicate_of) ?? 0) + 1);
    }
  }
  return out;
}

/** The rows the dedupe folded into this stay (same physical stay, other sources). */
export async function listEchoesOf(bookingId: string): Promise<BookingEx[]> {
  if (!isConfigured || !bookingId) return [];
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('duplicate_of', bookingId)
    .order('first_seen_at', { ascending: true });
  if (error || !data) return [];
  return data as BookingEx[];
}

export type FeedHealth = ChannelListingEx & {
  /** The OTA's most recent pull of Helm's export, when the user agent named this channel. */
  last_pull: ExportPull | null;
};

/**
 * Every channel_listings row of a property with its import state and the
 * last time that OTA pulled Helm's export. The pull is matched by the user
 * agent's channel guess; a pull the agent did not identify is not credited
 * to any channel (it shows on the hub as an anonymous pull instead).
 */
export async function loadFeedHealth(propertyId: string): Promise<FeedHealth[]> {
  if (!isConfigured || !propertyId) return [];
  const [{ data, error }, pulls] = await Promise.all([
    supabase.from('channel_listings').select('*').eq('property_id', propertyId).order('channel'),
    lastPullsByProperty([propertyId]),
  ]);
  if (error) throw new Error(`channel_listings ${propertyId}: ${error.message}`);
  const propertyPulls = pulls.get(propertyId) ?? [];
  return ((data ?? []) as Array<Record<string, unknown>>).map((raw) => {
    const l = shapeListing(raw);
    const last_pull = propertyPulls.find((p) => p.channel_guess === l.channel) ?? null;
    return { ...l, last_pull };
  });
}

/** Pulls for a property the user agent did not attribute to a channel, newest first. */
export async function anonymousPulls(propertyId: string): Promise<ExportPull[]> {
  if (!isConfigured || !propertyId) return [];
  const pulls = await lastPullsByProperty([propertyId]);
  return (pulls.get(propertyId) ?? []).filter((p) => p.channel_guess == null);
}

export type AutomationSendRow = {
  id: string;
  booking_id: string;
  automation_id: string;
  property_id: string;
  fire_at: string;
  status: string;
  delivery_used: string | null;
  to_address: string | null;
  subject_rendered: string | null;
  body_rendered: string | null;
  missing_fields: string[];
  error: string | null;
  planned_check_in: string;
  planned_check_out: string;
  approved_by: string | null;
  approved_at: string | null;
  sent_at: string | null;
  /** From message_automations. */
  automation_key: string | null;
  audience: string | null;
  trigger: string | null;
};

const SEND_COLS =
  'id, booking_id, automation_id, property_id, fire_at, status, delivery_used, to_address, subject_rendered, body_rendered, missing_fields, error, planned_check_in, planned_check_out, approved_by, approved_at, sent_at';

async function decorateSends(rows: Array<Record<string, unknown>>): Promise<AutomationSendRow[]> {
  const ids = [...new Set(rows.map((r) => String(r.automation_id)))];
  const byId = new Map<string, { key: string; audience: string; trigger: string }>();
  if (ids.length > 0) {
    const { data } = await supabase.from('message_automations').select('id, key, audience, trigger').in('id', ids);
    for (const a of (data ?? []) as Array<{ id: string; key: string; audience: string; trigger: string }>) byId.set(a.id, a);
  }
  return rows.map((r) => {
    const a = byId.get(String(r.automation_id));
    return {
      id: String(r.id),
      booking_id: String(r.booking_id),
      automation_id: String(r.automation_id),
      property_id: String(r.property_id),
      fire_at: String(r.fire_at),
      status: String(r.status),
      delivery_used: (r.delivery_used as string | null) ?? null,
      to_address: (r.to_address as string | null) ?? null,
      subject_rendered: (r.subject_rendered as string | null) ?? null,
      body_rendered: (r.body_rendered as string | null) ?? null,
      missing_fields: Array.isArray(r.missing_fields) ? (r.missing_fields as string[]) : [],
      error: (r.error as string | null) ?? null,
      planned_check_in: String(r.planned_check_in ?? '').slice(0, 10),
      planned_check_out: String(r.planned_check_out ?? '').slice(0, 10),
      approved_by: (r.approved_by as string | null) ?? null,
      approved_at: (r.approved_at as string | null) ?? null,
      sent_at: (r.sent_at as string | null) ?? null,
      automation_key: a?.key ?? null,
      audience: a?.audience ?? null,
      trigger: a?.trigger ?? null,
    };
  });
}

/** automation_sends for a property firing in [from, to], with the rule's key. Empty on a failed read. */
export async function listAutomationSendsForProperty(propertyId: string, fromIso: string, toIso: string): Promise<AutomationSendRow[]> {
  if (!isConfigured || !propertyId) return [];
  const { data, error } = await supabase
    .from('automation_sends')
    .select(SEND_COLS)
    .eq('property_id', propertyId)
    .gte('fire_at', fromIso)
    .lte('fire_at', toIso)
    .order('fire_at', { ascending: true })
    .limit(200);
  if (error || !data) return [];
  return decorateSends(data as Array<Record<string, unknown>>);
}

/** Every automation send planned or made for one stay. Empty on a failed read. */
export async function listAutomationSendsForBooking(bookingId: string): Promise<AutomationSendRow[]> {
  if (!isConfigured || !bookingId) return [];
  const { data, error } = await supabase
    .from('automation_sends')
    .select(SEND_COLS)
    .eq('booking_id', bookingId)
    .order('fire_at', { ascending: true })
    .limit(100);
  if (error || !data) return [];
  return decorateSends(data as Array<Record<string, unknown>>);
}

/** The booking_finance sub-record, or null when none has been written. */
export async function getBookingFinance(bookingId: string): Promise<BookingFinance | null> {
  if (!isConfigured || !bookingId) return null;
  const { data, error } = await supabase.from('booking_finance').select('*').eq('booking_id', bookingId).maybeSingle();
  if (error || !data) return null;
  return data as BookingFinance;
}

export type GuestThreadLite = {
  id: string;
  channel: string;
  external_thread_url: string | null;
  status: string;
  last_preview: string | null;
  last_guest_at: string | null;
  last_host_at: string | null;
  updated_at: string;
};

/** Helm inbox threads keyed to a stay. Empty on a failed read. */
export async function listThreadsForBooking(bookingId: string): Promise<GuestThreadLite[]> {
  if (!isConfigured || !bookingId) return [];
  const { data, error } = await supabase
    .from('guest_threads')
    .select('id, channel, external_thread_url, status, last_preview, last_guest_at, last_host_at, updated_at')
    .eq('booking_id', bookingId)
    .order('updated_at', { ascending: false });
  if (error || !data) return [];
  return data as GuestThreadLite[];
}

export type GuestLite = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
};

export async function getGuestLite(guestId: string): Promise<GuestLite | null> {
  if (!isConfigured || !guestId) return null;
  const { data, error } = await supabase.from('guests').select('id, first_name, last_name, email, phone').eq('id', guestId).maybeSingle();
  if (error || !data) return null;
  return data as GuestLite;
}

export type IcalSyncSummary = {
  last_synced_at: string | null;
  last_status: string | null;
  last_error: string | null;
  succeeded: number;
  failed: number;
  total: number;
  deferred: number;
  reclassified: number;
  guarded: number;
};

/**
 * The fleet-wide iCal sync watchdog row (sync_status source 'ical'): the
 * deferred-cancel and mass-cancel guard counts the per-listing run log does
 * not carry. Null when the row is missing or unreadable.
 */
export async function getIcalSyncSummary(): Promise<IcalSyncSummary | null> {
  if (!isConfigured) return null;
  const { data, error } = await supabase
    .from('sync_status')
    .select('last_synced_at, last_status, last_error, last_result')
    .eq('source', 'ical')
    .maybeSingle();
  if (error || !data) return null;
  const r = (data.last_result ?? {}) as Record<string, unknown>;
  const n = (k: string) => {
    const v = Number(r[k]);
    return Number.isFinite(v) ? v : 0;
  };
  return {
    last_synced_at: (data.last_synced_at as string | null) ?? null,
    last_status: (data.last_status as string | null) ?? null,
    last_error: (data.last_error as string | null) ?? null,
    succeeded: n('succeeded'),
    failed: n('failed'),
    total: n('total'),
    deferred: n('deferred'),
    reclassified: n('reclassified'),
    guarded: n('guarded'),
  };
}

/** Recent sync runs joined to their listing's channel and property. */
export type SyncRunWithListing = IcalSyncRun & { channel: string | null; property_id: string | null; display_name: string | null };

export async function listRecentSyncRunsWithListing(limit = 12): Promise<SyncRunWithListing[]> {
  const runs = await listRecentSyncRuns(limit);
  if (runs.length === 0) return [];
  const ids = [...new Set(runs.map((r) => r.channel_listing_id))];
  const { data } = await supabase.from('channel_listings').select('id, channel, property_id, display_name').in('id', ids);
  const byId = new Map<string, { channel: string; property_id: string; display_name: string | null }>();
  for (const l of (data ?? []) as Array<{ id: string; channel: string; property_id: string; display_name: string | null }>) byId.set(l.id, l);
  return runs.map((r) => {
    const l = byId.get(r.channel_listing_id);
    return { ...r, channel: l?.channel ?? null, property_id: l?.property_id ?? null, display_name: l?.display_name ?? null };
  });
}
