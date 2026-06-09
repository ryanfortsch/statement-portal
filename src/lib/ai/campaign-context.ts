/**
 * Build the dynamic context block injected into the system prompt at
 * draft-time. Keeps the AI grounded in real properties, real audience
 * segments, and the right recipient count instead of hallucinating
 * "Sunset Cottage" or "your subscribers" generically.
 */

import { supabase } from '@/lib/supabase';
import { PROPERTIES, type Property } from '@/lib/properties';
import { findScaListingByAddress } from '@/lib/sca-listings';
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
    /** Marketing memory: how we actually sell this home. */
    marketing: {
      tagline: string | null;
      primarySellingPoint: string | null;
      sellingPoints: string[];
      onWater: boolean;
      bedrooms: number | null;
      sleeps: number | null;
      bestFor: string | null;
      notes: string | null;
    } | null;
    /** Free windows in the next ~60 days computed from the bookings
     *  table. The model is allowed to mention these specific dates
     *  verbatim; everything else about availability is hallucination
     *  and must be avoided. */
    openings: Array<{ start: string; end: string; nights: number; label: string }>;
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

type MarketingRow = {
  property_id: string;
  tagline: string | null;
  primary_selling_point: string | null;
  selling_points: string[] | null;
  on_water: boolean;
  bedrooms: number | null;
  sleeps: number | null;
  best_for: string | null;
  notes: string | null;
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
  '17_beach_rd': 'Good Harbor Beach, Gloucester',
  '3_locust': 'Niles Beach, Gloucester',
};

export async function loadDraftContext(args: { segmentId?: string | null }): Promise<CampaignDraftContext> {
  // Marketing titles live in Helm DB (e.g. "Stay at Rocky Neck"). The
  // Guesty listing ID (used as the slug on staycapeann.com's /stays/[id]
  // route) is the source-of-truth in the `guesty_listings` table,
  // populated by /api/sync-guesty. That's more reliable than
  // properties.guesty_listing_id which is a denormalized snapshot that
  // can be null for properties that haven't had it set manually.
  // 60-day forward window for opening calculation. Today inclusive,
  // 60 days out exclusive. Wide enough to cover "this month + next month"
  // briefs without dragging in long-tail bookings.
  const today = new Date();
  const windowStart = today.toISOString().slice(0, 10);
  const windowEndDate = new Date(today.getTime() + 60 * 24 * 3600 * 1000);
  const windowEnd = windowEndDate.toISOString().slice(0, 10);

  const [propsResult, listingsResult, marketingResult, bookingsResult] = await Promise.all([
    supabase.from('properties').select('id, title').eq('is_active', true),
    supabase.from('guesty_listings').select('property_id, listing_id'),
    supabase.from('property_marketing').select('*'),
    supabase
      .from('bookings')
      .select('property_id, check_in, check_out, status')
      .in('status', ['confirmed', 'tentative'])
      .lt('check_in', windowEnd)
      .gt('check_out', windowStart),
  ]);

  const titleById = new Map<string, string | null>();
  for (const row of (propsResult.data ?? []) as Array<{ id: string; title: string | null }>) {
    titleById.set(row.id, row.title);
  }

  const guestyIdById = new Map<string, string>();
  for (const row of (listingsResult.data ?? []) as Array<{ property_id: string; listing_id: string }>) {
    // Multiple listings per property is rare; first one wins.
    if (!guestyIdById.has(row.property_id)) {
      guestyIdById.set(row.property_id, row.listing_id);
    }
  }

  const marketingById = new Map<string, MarketingRow>();
  for (const row of (marketingResult.data ?? []) as MarketingRow[]) {
    marketingById.set(row.property_id, row);
  }

  const bookingsByProperty = new Map<string, Array<{ check_in: string; check_out: string }>>();
  for (const row of (bookingsResult.data ?? []) as Array<{
    property_id: string;
    check_in: string;
    check_out: string;
  }>) {
    const arr = bookingsByProperty.get(row.property_id) ?? [];
    arr.push({ check_in: row.check_in, check_out: row.check_out });
    bookingsByProperty.set(row.property_id, arr);
  }

  const properties = Object.values(PROPERTIES)
    .filter((p) => p.id !== '65_calderwood' && p.id !== '3246_ne_27th') // Ryan's personal, not guest-facing
    .map((p: Property) => {
      const m = marketingById.get(p.id);
      const openings = computeOpenings(
        bookingsByProperty.get(p.id) ?? [],
        windowStart,
        windowEnd,
      );
      // Source 1 (preferred): guesty_listings table populated by
      // /api/sync-guesty. Source 2 (fallback): the bundled SCA listings
      // snapshot matched by street address -- catches properties that
      // haven't been synced into guesty_listings yet (17 Beach Rd today).
      // Without this fallback the model gets pageUrl=null and has
      // hallucinated plausible-looking Guesty IDs into the body in the
      // past, sending recipients to dead links.
      const guestyId =
        guestyIdById.get(p.id) ?? findScaListingByAddress(p.address)?.id ?? null;
      return {
        title: titleById.get(p.id) ?? null,
        neighborhood: NEIGHBORHOOD[p.id] ?? p.city,
        pageUrl: pageUrlForGuestyListing(guestyId),
        heroUrl: heroUrlForProperty(p.id),
        marketing: m
          ? {
              tagline: m.tagline,
              primarySellingPoint: m.primary_selling_point,
              sellingPoints: m.selling_points ?? [],
              onWater: m.on_water,
              bedrooms: m.bedrooms,
              sleeps: m.sleeps,
              bestFor: m.best_for,
              notes: m.notes,
            }
          : null,
        openings,
      };
    });

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

// Compute free windows from a property's confirmed/tentative bookings.
// Returns gaps of at least 2 nights inside [windowStart, windowEnd).
// Strings everywhere are YYYY-MM-DD.
function computeOpenings(
  bookings: Array<{ check_in: string; check_out: string }>,
  windowStart: string,
  windowEnd: string,
): Array<{ start: string; end: string; nights: number; label: string }> {
  // Sort by check_in so we can walk left to right.
  const sorted = [...bookings].sort((a, b) => a.check_in.localeCompare(b.check_in));

  // Clip each booking to the window for gap math.
  const blocks = sorted
    .map((b) => ({
      from: b.check_in < windowStart ? windowStart : b.check_in,
      to: b.check_out > windowEnd ? windowEnd : b.check_out,
    }))
    .filter((b) => b.from < b.to);

  // Walk left to right, emit gaps.
  const gaps: Array<{ start: string; end: string }> = [];
  let cursor = windowStart;
  for (const b of blocks) {
    if (b.from > cursor) gaps.push({ start: cursor, end: b.from });
    if (b.to > cursor) cursor = b.to;
  }
  if (cursor < windowEnd) gaps.push({ start: cursor, end: windowEnd });

  // Drop micro-gaps (< 2 nights) -- not useful to promote a 1-night opening.
  // Build display labels: "Jun 8-15" or "May 30 - Jun 4" across month boundary.
  return gaps
    .map((g) => {
      const nights = daysBetween(g.start, g.end);
      return { ...g, nights, label: formatRange(g.start, g.end) };
    })
    .filter((g) => g.nights >= 2);
}

function daysBetween(startISO: string, endISO: string): number {
  const a = Date.parse(startISO);
  const b = Date.parse(endISO);
  return Math.round((b - a) / (24 * 3600 * 1000));
}

const MONTH_SHORT_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function formatRange(startISO: string, endISO: string): string {
  // The end date is the check-out date (exclusive of the stay). Display
  // as inclusive last-night so the label reads naturally: a stay
  // check_in 2026-06-08 / check_out 2026-06-15 is "Jun 8-14" to the guest.
  const start = new Date(startISO + 'T00:00:00Z');
  const endExclusive = new Date(endISO + 'T00:00:00Z');
  const endInclusive = new Date(endExclusive.getTime() - 24 * 3600 * 1000);
  const sMonth = MONTH_SHORT_LABELS[start.getUTCMonth()];
  const eMonth = MONTH_SHORT_LABELS[endInclusive.getUTCMonth()];
  const sDay = start.getUTCDate();
  const eDay = endInclusive.getUTCDate();
  if (sMonth === eMonth) return `${sMonth} ${sDay}-${eDay}`;
  return `${sMonth} ${sDay} - ${eMonth} ${eDay}`;
}

export function formatContextBlock(ctx: CampaignDraftContext): string {
  const lines: string[] = [];

  lines.push('Homes we manage, with how we actually market each one. Refer to each home');
  lines.push('ONLY by its guest-facing title and neighborhood. NEVER use a street address');
  lines.push('or internal name. Write COMPLETE sentences using the selling points below;');
  lines.push('do not invent details or write fragments. Lead with the primary selling');
  lines.push('point. If a home is on the water, that is the headline.');
  lines.push('');
  lines.push('Each home has an "openings" line listing the actual free windows');
  lines.push('in the next 60 days, computed from the bookings table. If the brief');
  lines.push('asks for openings on a specific home, use these labels VERBATIM and');
  lines.push('only these. Do NOT invent dates, do NOT shift them by a day "to');
  lines.push('round," do NOT combine adjacent windows into a single range. If a');
  lines.push('home shows "fully booked," do not promote any window for it -- pick');
  lines.push('a different home or skip it.');
  lines.push('');
  for (const p of ctx.properties) {
    const titlePart = p.title ? `"${p.title}"` : '(no guest-facing title set)';
    lines.push(`  - ${titlePart}, ${p.neighborhood}`);
    lines.push(`    page: ${p.pageUrl ?? '(none, render card without a link)'}`);
    lines.push(`    hero: ${p.heroUrl ?? '(not available, use heading + link only)'}`);
    if (p.marketing) {
      const m = p.marketing;
      if (m.onWater) lines.push('    ON THE WATER (lead with this)');
      if (m.primarySellingPoint) lines.push(`    primary selling point: ${m.primarySellingPoint}`);
      if (m.tagline) lines.push(`    tagline: ${m.tagline}`);
      if (m.sleeps) lines.push(`    sleeps ${m.sleeps}${m.bedrooms ? `, ${m.bedrooms} bedrooms` : ''}`);
      if (m.bestFor) lines.push(`    best for: ${m.bestFor}`);
      if (m.sellingPoints.length > 0) {
        lines.push(`    selling points: ${m.sellingPoints.join('; ')}`);
      }
      if (m.notes) lines.push(`    notes: ${m.notes}`);
    } else {
      lines.push('    (no marketing memory yet, describe only from neighborhood)');
    }
    // Calendar openings -- the AI gets actual free windows pulled from
    // the bookings table. The drafter prompt requires it to use these
    // labels verbatim when talking about specific dates.
    if (p.openings.length > 0) {
      const labels = p.openings
        .slice(0, 6) // first six are plenty; later ones are too far out
        .map((o) => `${o.label} (${o.nights}n)`)
        .join('; ');
      lines.push(`    openings (next 60d, verbatim only): ${labels}`);
    } else {
      lines.push('    openings (next 60d): fully booked -- do not promote dates for this home');
    }
    lines.push('');
  }

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
