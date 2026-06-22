/**
 * Campaign-side query helpers and recipient resolution.
 *
 * The "compute recipients" piece is the bridge between an
 * audience_segment (a saved filter) and the actual list of contacts to
 * email. Segments filter by required_tags / excluded_tags / status_in;
 * we translate those into a contains/no-overlap/IN query.
 */

import { supabaseAdmin as supabase } from './supabase-admin';
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

  let q = supabase
    .from('audience_contacts')
    .select('*')
    .in('status', segment.status_in.length ? segment.status_in : ['subscribed'])
    .limit(limit);

  if (segment.required_tags.length > 0) {
    q = q.contains('tags', segment.required_tags);
  }
  if (segment.excluded_tags.length > 0) {
    // Postgres array overlap operator; we want NO overlap.
    // PostgREST exposes `&&` as `ov`. Negate via .not(...).
    q = q.not('tags', 'ov', '{' + segment.excluded_tags.join(',') + '}');
  }

  const { data, error } = await q;
  if (error) {
    console.error('[guests-campaigns] resolveSegmentRecipients failed', error);
    return [];
  }
  return (data ?? []) as GuestContact[];
}

export async function countSegmentRecipients(segment: GuestSegment): Promise<number> {
  const recipients = await resolveSegmentRecipients(segment, { emailOnly: true });
  return recipients.length;
}
