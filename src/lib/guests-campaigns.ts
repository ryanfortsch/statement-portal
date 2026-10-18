/**
 * Campaign-side query helpers and recipient resolution.
 *
 * The "compute recipients" piece is the bridge between an
 * audience_segment (a saved filter) and the actual list of contacts to
 * email. Segments filter by required_tags / excluded_tags / status_in;
 * we translate those into a contains/no-overlap/IN query.
 */

import { supabaseAdmin as supabase } from './supabase-admin';
import { selectAllPaged } from './paged-select';
import type { GuestCampaign, GuestContact, GuestSegment } from './guests-types';

export async function getCampaign(id: string): Promise<GuestCampaign | null> {
  const { data } = await supabase
    .from('audience_campaigns')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return (data as GuestCampaign | null) ?? null;
}

export async function getSegment(id: string): Promise<GuestSegment | null> {
  const { data } = await supabase
    .from('audience_segments')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return (data as GuestSegment | null) ?? null;
}

/**
 * Resolve a segment to the actual list of subscribed contacts that
 * match it. Used at send time, and by the composer to show a live
 * recipient count. Always selects all columns; emailOnly is a no-op
 * left here as a future hint if we move to a leaner shape.
 */
export async function resolveSegmentRecipients(
  segment: GuestSegment,
  options: { limit?: number; emailOnly?: boolean } = {},
): Promise<GuestContact[]> {
  const { limit = 5000 } = options;

  // Paged: PostgREST caps one response at 1,000 rows whatever .limit() asks
  // for, so a bare select silently dropped everyone past the thousandth from
  // both the send and the count the composer shows.
  const page = (from: number, to: number) => {
    let q = supabase
      .from('audience_contacts')
      .select('*')
      .in('status', segment.status_in.length ? segment.status_in : ['subscribed']);
    if (segment.required_tags.length > 0) {
      q = q.contains('tags', segment.required_tags);
    }
    if (segment.excluded_tags.length > 0) {
      // Postgres array overlap operator; we want NO overlap.
      // PostgREST exposes `&&` as `ov`. Negate via .not(...).
      q = q.not('tags', 'ov', '{' + segment.excluded_tags.join(',') + '}');
    }
    return q.order('id').range(from, to);
  };

  try {
    const rows = await selectAllPaged<GuestContact>(page, { label: 'segment recipients' });
    return rows.slice(0, limit);
  } catch (error) {
    console.error('[guests-campaigns] resolveSegmentRecipients failed', error);
    return [];
  }
}

/**
 * How far a real send of this campaign got: the contacts it has gone to (one
 * `sent` event each; test sends carry no contact) and when the last one went.
 * Reads the events, not the campaign row, because the send loop writes the
 * row only at the start and the end.
 */
export async function campaignSendProgress(
  campaignId: string,
): Promise<{ sentCount: number; lastSentAt: string | null }> {
  const [{ count }, { data: last }] = await Promise.all([
    supabase
      .from('audience_events')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('event_type', 'sent')
      .not('contact_id', 'is', null),
    supabase
      .from('audience_events')
      .select('created_at')
      .eq('campaign_id', campaignId)
      .eq('event_type', 'sent')
      .not('contact_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1),
  ]);
  return { sentCount: count ?? 0, lastSentAt: (last?.[0]?.created_at as string | undefined) ?? null };
}

/** The contacts a real send of this campaign already reached, so a resumed send skips them. */
export async function campaignSentContactIds(campaignId: string): Promise<Set<string>> {
  const rows = await selectAllPaged<{ contact_id: string }>(
    (from, to) =>
      supabase
        .from('audience_events')
        .select('contact_id')
        .eq('campaign_id', campaignId)
        .eq('event_type', 'sent')
        .not('contact_id', 'is', null)
        .order('id')
        .range(from, to),
    { label: 'campaign sent contacts' },
  );
  return new Set(rows.map((r) => r.contact_id));
}

/**
 * How many subscribed contacts a segment reaches right now: the count the
 * new-campaign Audience select prints beside each segment. A head count, so
 * it reads past PostgREST's 1,000-row page. Null when the count could not be
 * read, so the select says nothing rather than a wrong zero.
 */
export async function countSegmentRecipients(segment: GuestSegment): Promise<number | null> {
  let q = supabase
    .from('audience_contacts')
    .select('id', { count: 'exact', head: true })
    .in('status', segment.status_in.length ? segment.status_in : ['subscribed']);
  if (segment.required_tags.length > 0) q = q.contains('tags', segment.required_tags);
  if (segment.excluded_tags.length > 0) q = q.not('tags', 'ov', '{' + segment.excluded_tags.join(',') + '}');
  const { count, error } = await q;
  if (error) {
    console.error('[guests-campaigns] countSegmentRecipients failed', error);
    return null;
  }
  return count ?? 0;
}
