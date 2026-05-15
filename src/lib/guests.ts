/**
 * Server-side query helpers for the Guests module.
 *
 * Module is "Guests" user-facing; DB tables retain their legacy
 * audience_* prefix. Public types are "Guest*" to match the module
 * name.
 */

import { supabase, isConfigured } from './supabase';
import type {
  GuestContact,
  GuestSegment,
  GuestCampaign,
  GuestStatus,
} from './guests-types';

export type GuestStats = {
  totalContacts: number;
  subscribers: number;
  unsubscribed: number;
  bounced: number;
  recentSignups: number;        // last 30 days
  topTags: Array<{ tag: string; count: number }>;
  configured: boolean;
};

export async function getGuestStats(): Promise<GuestStats> {
  const empty: GuestStats = {
    totalContacts: 0,
    subscribers: 0,
    unsubscribed: 0,
    bounced: 0,
    recentSignups: 0,
    topTags: [],
    configured: isConfigured,
  };
  if (!isConfigured) return empty;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [{ count: total }, { count: subs }, { count: unsubs }, { count: bounced }, { count: recent }, { data: tagRows }] =
    await Promise.all([
      supabase.from('audience_contacts').select('*', { count: 'exact', head: true }),
      supabase.from('audience_contacts').select('*', { count: 'exact', head: true }).eq('status', 'subscribed'),
      supabase.from('audience_contacts').select('*', { count: 'exact', head: true }).eq('status', 'unsubscribed'),
      supabase.from('audience_contacts').select('*', { count: 'exact', head: true }).eq('status', 'bounced'),
      supabase.from('audience_contacts').select('*', { count: 'exact', head: true }).gte('subscribed_at', thirtyDaysAgo),
      supabase.from('audience_contacts').select('tags').limit(2000),
    ]);

  // Compute top tags client-side. (For 200-2k contacts this is fine; if we
  // grow past that we should push the aggregation into Postgres.)
  const tagCounts = new Map<string, number>();
  for (const row of (tagRows ?? []) as { tags: string[] | null }[]) {
    for (const tag of row.tags ?? []) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tag, count]) => ({ tag, count }));

  return {
    totalContacts: total ?? 0,
    subscribers: subs ?? 0,
    unsubscribed: unsubs ?? 0,
    bounced: bounced ?? 0,
    recentSignups: recent ?? 0,
    topTags,
    configured: true,
  };
}

export type ContactListParams = {
  search?: string;
  tag?: string;
  status?: GuestStatus | 'all';
  limit?: number;
};

export async function listContacts(params: ContactListParams = {}): Promise<GuestContact[]> {
  if (!isConfigured) return [];
  const { search, tag, status = 'all', limit = 200 } = params;

  let q = supabase
    .from('audience_contacts')
    .select('*')
    .order('subscribed_at', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (status !== 'all') q = q.eq('status', status);
  if (tag) q = q.contains('tags', [tag]);
  if (search) {
    const s = search.trim();
    q = q.or(`email.ilike.%${s}%,first_name.ilike.%${s}%,last_name.ilike.%${s}%`);
  }

  const { data } = await q;
  return (data ?? []) as GuestContact[];
}

export async function listSegments(): Promise<GuestSegment[]> {
  if (!isConfigured) return [];
  const { data } = await supabase
    .from('audience_segments')
    .select('*')
    .order('is_system', { ascending: false })
    .order('name');
  return (data ?? []) as GuestSegment[];
}

export async function listCampaigns(): Promise<GuestCampaign[]> {
  if (!isConfigured) return [];
  const { data } = await supabase
    .from('audience_campaigns')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  return (data ?? []) as GuestCampaign[];
}

export async function getContact(id: string): Promise<GuestContact | null> {
  if (!isConfigured) return null;
  const { data } = await supabase
    .from('audience_contacts')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return (data as GuestContact | null) ?? null;
}

export type ContactEvent = {
  id: string;
  event_type: string;
  occurred_at: string;
  campaign_id: string | null;
  metadata: Record<string, unknown> | null;
};

export async function listContactEvents(contactId: string, limit = 50): Promise<ContactEvent[]> {
  if (!isConfigured) return [];
  const { data } = await supabase
    .from('audience_events')
    .select('id, event_type, occurred_at, campaign_id, metadata')
    .eq('contact_id', contactId)
    .order('occurred_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as ContactEvent[];
}

export type ContactStay = {
  reservation_id: string;
  property_id: string | null;
  property_name: string | null;
  check_in: string | null;
  check_out: string | null;
  nights: number | null;
  channel: string | null;
  confirmation_code: string | null;
  status: string | null;
};

/**
 * Past + upcoming stays for a contact, looked up by guesty_guest_id.
 * Joined to properties for the short name (e.g. "21 Horton"). Internal
 * Helm UI, so showing the property name is fine here even though it
 * would be forbidden in guest-facing campaign copy.
 */
export async function listContactStays(guestyGuestId: string | null | undefined): Promise<ContactStay[]> {
  if (!isConfigured || !guestyGuestId) return [];

  const { data } = await supabase
    .from('guesty_reservations')
    .select(`
      guesty_reservation_id,
      property_id,
      check_in,
      check_out,
      nights,
      channel,
      confirmation_code,
      status,
      properties:property_id ( name )
    `)
    .eq('guest_id', guestyGuestId)
    .order('check_in', { ascending: false })
    .limit(100);

  return ((data ?? []) as Array<{
    guesty_reservation_id: string;
    property_id: string | null;
    check_in: string | null;
    check_out: string | null;
    nights: number | null;
    channel: string | null;
    confirmation_code: string | null;
    status: string | null;
    properties: { name: string } | { name: string }[] | null;
  }>).map((row) => {
    const prop = Array.isArray(row.properties) ? row.properties[0] : row.properties;
    return {
      reservation_id: row.guesty_reservation_id,
      property_id: row.property_id,
      property_name: prop?.name ?? null,
      check_in: row.check_in,
      check_out: row.check_out,
      nights: row.nights,
      channel: row.channel,
      confirmation_code: row.confirmation_code,
      status: row.status,
    };
  });
}
