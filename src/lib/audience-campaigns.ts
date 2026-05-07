/**
 * Campaign-side query helpers and recipient resolution.
 *
 * The "compute recipients" piece is the bridge between an
 * audience_segment (a saved filter) and the actual list of contacts to
 * email. Segments filter by required_tags / excluded_tags / status_in;
 * we translate those into a contains/no-overlap/IN query.
 */

import { supabase } from './supabase';
import type { AudienceCampaign, AudienceContact, AudienceSegment } from './audience-types';

export async function getCampaign(id: string): Promise<AudienceCampaign | null> {
  const { data } = await supabase
    .from('audience_campaigns')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return (data as AudienceCampaign | null) ?? null;
}

export async function getSegment(id: string): Promise<AudienceSegment | null> {
  const { data } = await supabase
    .from('audience_segments')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return (data as AudienceSegment | null) ?? null;
}

/**
 * Resolve a segment to the actual list of subscribed contacts that
 * match it. Used at send time, and by the composer to show a live
 * recipient count. Always selects all columns; emailOnly is a no-op
 * left here as a future hint if we move to a leaner shape.
 */
export async function resolveSegmentRecipients(
  segment: AudienceSegment,
  options: { limit?: number; emailOnly?: boolean } = {},
): Promise<AudienceContact[]> {
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
    console.error('[audience-campaigns] resolveSegmentRecipients failed', error);
    return [];
  }
  return (data ?? []) as AudienceContact[];
}

export async function countSegmentRecipients(segment: AudienceSegment): Promise<number> {
  const recipients = await resolveSegmentRecipients(segment, { emailOnly: true });
  return recipients.length;
}
