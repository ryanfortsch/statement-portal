/**
 * Build the dynamic context block injected into the system prompt at
 * draft-time. Keeps the AI grounded in real properties, real audience
 * segments, and the right recipient count instead of hallucinating
 * "Sunset Cottage" or "your subscribers" generically.
 */

import { supabase } from '@/lib/supabase';
import { PROPERTIES, type Property } from '@/lib/properties';

export type CampaignDraftContext = {
  /** Compact list of the homes for the model to pick from. */
  properties: Array<{
    name: string;
    city: string;
    address: string;
    title: string | null;
  }>;
  /** Picked segment for this draft, or null if not picked yet. */
  segment: {
    name: string;
    description: string | null;
    recipientCount: number;
    isWeekly: boolean;
    isInsider: boolean;
  } | null;
};

export async function loadDraftContext(args: { segmentId?: string | null }): Promise<CampaignDraftContext> {
  // Marketing titles live in Helm DB (e.g. "Stay at Rocky Neck") so fetch
  // them once and merge with the local PROPERTIES map.
  const { data: dbProps } = await supabase
    .from('properties')
    .select('id, title')
    .eq('is_active', true);
  const titleById = new Map<string, string | null>();
  for (const row of (dbProps ?? []) as Array<{ id: string; title: string | null }>) {
    titleById.set(row.id, row.title);
  }

  const properties = Object.values(PROPERTIES)
    .filter((p) => p.id !== '65_calderwood' && p.id !== '3246_ne_27th') // Ryan's personal, not guest-facing
    .map((p: Property) => ({
      name: p.name,
      city: p.city,
      address: p.address,
      title: titleById.get(p.id) ?? null,
    }));

  let segment: CampaignDraftContext['segment'] = null;
  if (args.segmentId) {
    const { data: seg } = await supabase
      .from('audience_segments')
      .select('name, description, required_tags, excluded_tags, status_in')
      .eq('id', args.segmentId)
      .maybeSingle();

    if (seg) {
      // Count recipients live so the AI knows how big the send is.
      let q = supabase
        .from('audience_contacts')
        .select('id', { count: 'exact', head: true })
        .in('status', (seg.status_in as string[])?.length ? (seg.status_in as string[]) : ['subscribed']);
      const required = (seg.required_tags as string[]) || [];
      const excluded = (seg.excluded_tags as string[]) || [];
      if (required.length > 0) q = q.contains('tags', required);
      if (excluded.length > 0) q = q.not('tags', 'ov', '{' + excluded.join(',') + '}');
      const { count } = await q;

      segment = {
        name: seg.name as string,
        description: (seg.description as string) ?? null,
        recipientCount: count ?? 0,
        isWeekly: required.includes('weekly'),
        isInsider: required.includes('insider') || (seg.name as string).toLowerCase().includes('insider'),
      };
    }
  }

  return { properties, segment };
}

export function formatContextBlock(ctx: CampaignDraftContext): string {
  const lines: string[] = [];

  lines.push('Homes in the collection:');
  for (const p of ctx.properties) {
    const titlePart = p.title ? ` ("${p.title}")` : '';
    lines.push(`  - ${p.name}${titlePart}, ${p.city}. ${p.address}.`);
  }
  lines.push('');

  if (ctx.segment) {
    lines.push(`Sending to: ${ctx.segment.name} (${ctx.segment.recipientCount} recipients).`);
    if (ctx.segment.description) {
      lines.push(`Segment description: ${ctx.segment.description}`);
    }
    if (ctx.segment.isWeekly) {
      lines.push('These recipients opted in to The Weekly editorial cadence specifically.');
    } else if (ctx.segment.isInsider) {
      lines.push('These recipients signed up for new-home sneak peeks and members-only rates.');
    }
  } else {
    lines.push('Segment not picked yet. Write to a generic Stay Cape Ann subscriber.');
  }

  const now = new Date();
  const month = now.toLocaleDateString('en-US', { month: 'long' });
  const year = now.getFullYear();
  lines.push('');
  lines.push(`Today's date is ${month} ${now.getDate()}, ${year}.`);

  return lines.join('\n');
}
