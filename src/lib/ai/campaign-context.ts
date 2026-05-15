/**
 * Build the dynamic context block injected into the system prompt at
 * draft-time. Keeps the AI grounded in real properties, real audience
 * segments, and the right recipient count instead of hallucinating
 * "Sunset Cottage" or "your subscribers" generically.
 */

import { supabase } from '@/lib/supabase';
import { PROPERTIES, type Property } from '@/lib/properties';
import { heroUrlForProperty, pageUrlForGuestyListing } from './property-cards';

export type CampaignDraftContext = {
  /** Compact list of the homes for the model to pick from. NO ADDRESSES. */
  properties: Array<{
    /** Guest-facing marketing title, e.g. "Stay at Rocky Neck". May be null when no title is set. */
    title: string | null;
    /** Neighborhood / town flavor, e.g. "Rocky Neck, Gloucester". */
    neighborhood: string;
    /** Public page URL on staycapeann.com. */
    pageUrl: string | null;
    /** Public hero image URL, or null if we don't have one yet. */
    heroUrl: string | null;
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

const NEIGHBORHOOD: Record<string, string> = {
  '3_south_st': 'Old Garden Beach, Rockport',
  '21_horton': 'Rocky Neck, Gloucester',
  '53_rocky_neck': 'Rocky Neck, Gloucester',
  '4_brier_neck': 'Brier Neck, Gloucester',
  '30_woodward': 'Little River, Gloucester',
  '20_hammond': 'East Gloucester',
  '20_enon': 'Beverly',
  '73_rocky_neck': 'Smith Cove, Gloucester',
  '17_beach_rd': 'Niles Beach, Gloucester',
  '3_locust': 'Niles Beach, Gloucester',
};

export async function loadDraftContext(args: { segmentId?: string | null }): Promise<CampaignDraftContext> {
  // Marketing titles live in Helm DB (e.g. "Stay at Rocky Neck") so fetch
  // them once and merge with the local PROPERTIES map. We also pull
  // guesty_listing_id off the same row because staycapeann.com's
  // /stays/[id] route uses the Guesty listing ID as the slug.
  const { data: dbProps } = await supabase
    .from('properties')
    .select('id, title, guesty_listing_id')
    .eq('is_active', true);
  const titleById = new Map<string, string | null>();
  const guestyIdById = new Map<string, string | null>();
  for (const row of (dbProps ?? []) as Array<{ id: string; title: string | null; guesty_listing_id: string | null }>) {
    titleById.set(row.id, row.title);
    guestyIdById.set(row.id, row.guesty_listing_id);
  }

  const properties = Object.values(PROPERTIES)
    .filter((p) => p.id !== '65_calderwood' && p.id !== '3246_ne_27th') // Ryan's personal, not guest-facing
    .map((p: Property) => ({
      title: titleById.get(p.id) ?? null,
      neighborhood: NEIGHBORHOOD[p.id] ?? p.city,
      pageUrl: pageUrlForGuestyListing(guestyIdById.get(p.id) ?? null),
      heroUrl: heroUrlForProperty(p.id),
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

  lines.push('Homes we manage. Refer to each home ONLY by its guest-facing title');
  lines.push('and neighborhood. NEVER use a street address or internal name. When a home');
  lines.push('has no title (null), use the neighborhood phrase ("the home on the Neck").');
  lines.push('');
  for (const p of ctx.properties) {
    const titlePart = p.title ? `"${p.title}"` : '(no guest-facing title set)';
    const pagePart = p.pageUrl ? `  page: ${p.pageUrl}` : '  page: (none)';
    const heroPart = p.heroUrl ? `  hero: ${p.heroUrl}` : '  hero: (not available, use heading + link only)';
    lines.push(`  - ${titlePart}, ${p.neighborhood}`);
    lines.push(pagePart);
    lines.push(heroPart);
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
