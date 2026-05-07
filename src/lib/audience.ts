/**
 * Server-side query helpers for the Audience module.
 */

import { supabase, isConfigured } from './supabase';
import type {
  AudienceContact,
  AudienceSegment,
  AudienceCampaign,
  AudienceStatus,
} from './audience-types';

export type AudienceStats = {
  totalContacts: number;
  subscribers: number;
  unsubscribed: number;
  bounced: number;
  recentSignups: number;        // last 30 days
  topTags: Array<{ tag: string; count: number }>;
  configured: boolean;
};

export async function getAudienceStats(): Promise<AudienceStats> {
  const empty: AudienceStats = {
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
  status?: AudienceStatus | 'all';
  limit?: number;
};

export async function listContacts(params: ContactListParams = {}): Promise<AudienceContact[]> {
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
  return (data ?? []) as AudienceContact[];
}

export async function listSegments(): Promise<AudienceSegment[]> {
  if (!isConfigured) return [];
  const { data } = await supabase
    .from('audience_segments')
    .select('*')
    .order('is_system', { ascending: false })
    .order('name');
  return (data ?? []) as AudienceSegment[];
}

export async function listCampaigns(): Promise<AudienceCampaign[]> {
  if (!isConfigured) return [];
  const { data } = await supabase
    .from('audience_campaigns')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  return (data ?? []) as AudienceCampaign[];
}

export async function getContact(id: string): Promise<AudienceContact | null> {
  if (!isConfigured) return null;
  const { data } = await supabase
    .from('audience_contacts')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return (data as AudienceContact | null) ?? null;
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
