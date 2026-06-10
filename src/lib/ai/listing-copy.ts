/**
 * AI-assisted listing copy generator for the Stay Cape Ann brand.
 *
 * Pulls Helm's property row + a handful of sister-listing descriptions
 * from the bundled SCA snapshot, threads them through a system prompt
 * grounded in BRAND_VOICE_RULES from `./brand-voice`, then asks Claude
 * (via the Vercel AI Gateway) to draft a {title, tagline, description}
 * triplet that matches the existing listing voice.
 *
 * Optional photo input: the operator can attach up to ~6 images. Each
 * one is forwarded as a base64 part inside the user prompt so the model
 * can ground its language in the actual physical details (dock,
 * fireplace, bunk room, view) instead of generic vacation-rental copy.
 *
 * No save-back yet. The generator returns the draft so the operator can
 * copy it into Guesty / Airbnb / VRBO. Saving onto the property row is
 * a follow-up once the team agrees on the structure.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { BRAND_VOICE_RULES } from './brand-voice';
import scaListings from '@/data/sca-listings.json';
import type { HelmPropertyRow } from '@/lib/properties';

type ScaListing = {
  id: string;
  title: string;
  tagline: string | null;
  description: string | null;
  bedrooms: number;
  bathrooms: number;
  accommodates: number;
  town?: string;
};

type ListingExample = Pick<ScaListing, 'title' | 'tagline' | 'description' | 'town' | 'bedrooms' | 'bathrooms'>;

export type ListingCopyFormat = 'airbnb' | 'editorial';

/** Per-format Zod schemas. The shape is the same triplet either way;
 *  the .describe() strings are the model's strongest formatting signal
 *  with generateObject, so they're format-specific. */
function buildSchema(format: ListingCopyFormat) {
  if (format === 'airbnb') {
    return z.object({
      title: z.string().describe(
        'Public listing name. Format: "Stay at <Place>". <Place> is a short, evocative micro-location (a beach, cove, neighborhood). Maximum 50 characters total (Airbnb limit). No address, no street name or number. Must NOT duplicate any title in the taken-titles list.'
      ),
      tagline: z.string().describe(
        'The opening hook line of the Airbnb description. Short, concrete, ends with an exclamation point only if natural. Pattern from our existing listings: "4-Minute Walk to Good Harbor Beach!". 5-10 words.'
      ),
      description: z.string().describe(
        'The full Airbnb "About this space" body in our house structure, in this exact order:\n(1) 3-5 summary lines each starting with "✓ " covering location, renovation/condition, sleeping capacity, standout finish or amenity.\n(2) A blank line, then "The space" on its own line, then one grounded 2-4 sentence paragraph.\n(3) A blank line, then "☆☆☆ HIGHLIGHTS ☆☆☆" on its own line, then 4-6 lines each starting with "→ ".\n(4) Optional sections titled like "☆☆☆ MAIN HOUSE – LIVING SPACES ☆☆☆" with more "→ " lines, one section per area, only where the photos or property data support specifics.\n250-450 words total. No em dashes. Never include the street name or number. Ground every claim in the property data, operator notes, or photos.'
      ),
    });
  }
  return z.object({
    title: z.string().describe(
      'Public listing name. Format: "Stay at <Place>". <Place> is a short, evocative micro-location (a beach, harbor, cove, neighborhood). 2-5 words after "Stay at". Must NOT duplicate any title in the taken-titles list. No address, no street name or number.'
    ),
    tagline: z.string().describe(
      'A single sentence (15-25 words) that reads like the opening line of an editorial blurb. Concrete physical detail, not adjectives. No em dashes. No street names. No count of properties or "homes".'
    ),
    description: z.string().describe(
      '2-3 short paragraphs separated by blank lines. First paragraph is a grounded scene (specific physical details from the photos and property data, never adjectives like "beautiful" or "stunning"). Subsequent paragraphs cover the practical (rooms, sleeping arrangements, walkability, what is nearby). 100-220 words total. No em dashes. No "luxurious". No "perfect". No count of properties. No street names. Sentence-case throughout.'
    ),
  });
}

export type ListingCopy = { title: string; tagline: string; description: string };

export type GenerateListingCopyArgs = {
  property: HelmPropertyRow;
  /** Operator-supplied notes ("what makes it special", quirks, vibe). */
  operatorBrief: string;
  /** Optional images as base64 data URLs. Up to ~6. */
  photoDataUrls?: string[];
  /** Output style: Airbnb structured (default) or staycapeann.com editorial. */
  format?: ListingCopyFormat;
};

export async function generateListingCopy(args: GenerateListingCopyArgs): Promise<ListingCopy> {
  const format: ListingCopyFormat = args.format ?? 'airbnb';
  const examples = pickExamples(args.property);
  const system = composeSystemPrompt(examples, format, takenTitles(args.property));
  const userText = formatUserContext(args.property, args.operatorBrief);

  // Multimodal user prompt: text first, then any photos. AI SDK v6
  // accepts the multi-part shape via `messages` (richer than the
  // string-only `prompt` field).
  const photos = (args.photoDataUrls ?? []).slice(0, 6);
  const userContent: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; image: string }
  > = [{ type: 'text', text: userText }];
  for (const url of photos) {
    userContent.push({ type: 'image', image: url });
  }

  const { object } = await generateObject({
    model: 'anthropic/claude-sonnet-4.5',
    schema: buildSchema(format),
    system,
    messages: [{ role: 'user', content: userContent }],
  });

  return {
    title: stripEmDashes(object.title.trim()),
    tagline: stripEmDashes(object.tagline.trim()),
    description: stripEmDashes(object.description.trim()),
  };
}

/**
 * Pick 3 sister listings as voice examples. Prefer same town (Rockport
 * vs Gloucester reads differently), then closest by bedroom count.
 * Falls back to any listing with non-empty tagline + description.
 */
function pickExamples(property: HelmPropertyRow): ListingExample[] {
  const all = (scaListings as { listings: ScaListing[] }).listings.filter(
    (l) => l.tagline && l.description,
  );
  const targetTown = (property.city || '').split(',')[0].trim().toLowerCase();
  const targetBedrooms = property.bedrooms ?? 3;

  const scored = all.map((l) => {
    const sameTown = (l.town || '').toLowerCase() === targetTown ? 0 : 1;
    const bedroomDistance = Math.abs((l.bedrooms ?? 3) - targetBedrooms);
    return { l, score: sameTown * 10 + bedroomDistance };
  });
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, 3).map((s) => ({
    title: s.l.title,
    tagline: s.l.tagline,
    description: s.l.description,
    town: s.l.town,
    bedrooms: s.l.bedrooms,
    bathrooms: s.l.bathrooms,
  }));
}

/**
 * Every title already in use across the catalog. The generator must
 * not reuse one — "Stay at Rocky Neck" got generated for 19 Rackliffe
 * on 2026-06-10 because the model had no idea 21 Horton already owns
 * it. Excludes the property's own current title so a regenerate isn't
 * forbidden from keeping its existing name.
 */
function takenTitles(property: HelmPropertyRow): string[] {
  const all = (scaListings as { listings: ScaListing[] }).listings
    .map((l) => l.title?.trim())
    .filter((t): t is string => !!t);
  const own = (property.title ?? '').trim().toLowerCase();
  return [...new Set(all)].filter((t) => t.toLowerCase() !== own);
}

function composeSystemPrompt(
  examples: ListingExample[],
  format: ListingCopyFormat,
  taken: string[],
): string {
  const intro =
    format === 'airbnb'
      ? 'You are drafting an Airbnb listing for a Stay Cape Ann home. The body uses our structured Airbnb house format (checkmark summary, "The space", HIGHLIGHTS sections) but the sentences inside stay grounded and concrete — never hype.'
      : 'You are drafting public listing copy for staycapeann.com. The brand is editorial, grounded, and quiet — never promotional. Match the voice of the example listings below.';

  const parts = [
    intro,
    BRAND_VOICE_RULES,
    format === 'airbnb' ? AIRBNB_FORMAT_RULES : LISTING_SPECIFIC_RULES,
    `TAKEN TITLES — these are live listings in the same catalog. Your title must not duplicate or closely echo any of them:\n${taken.map((t) => `- ${t}`).join('\n')}`,
    'EXAMPLES OF EXISTING STAY CAPE ANN LISTING COPY (voice reference — sentence texture, named places, concrete details):',
    examples
      .map(
        (e, i) =>
          `Example ${i + 1} (${e.town ?? 'unknown'}, ${e.bedrooms ?? '?'}bd / ${e.bathrooms ?? '?'}ba):\nTitle: ${e.title}\nTagline: ${e.tagline}\nDescription:\n${e.description}`,
      )
      .join('\n\n---\n\n'),
  ];
  return parts.join('\n\n');
}

const AIRBNB_FORMAT_RULES = `
AIRBNB LISTING RULES (in addition to the brand voice rules above):

- Title is "Stay at <Place>". <Place> is a micro-location, never a street name or number. Maximum 50 characters.
- The tagline is the opening hook line. Lead with the single most bookable fact (walk time to a named beach, direct water access, dock). Example from our live listings: "4-Minute Walk to Good Harbor Beach!".
- The description follows our exact Airbnb house structure:
  1. A block of 3-5 "✓ " summary lines. One fact each: location, renovation state, sleeping capacity ("Sleeps N across ..."), standout amenity or finish.
  2. "The space" section header, then one 2-4 sentence grounded paragraph.
  3. "☆☆☆ HIGHLIGHTS ☆☆☆" header, then 4-6 "→ " lines with the strongest specifics.
  4. Optional per-area sections headed "☆☆☆ <AREA NAME> ☆☆☆" (e.g. MAIN HOUSE – LIVING SPACES, BEDROOMS, OUTDOOR) with "→ " lines. Only include an area when the photos or property data give real specifics for it.
- Use the photos when attached. Reference what's actually visible. Do not invent finishes, appliance brands, or views that are not supported.
- Use the supplied bedroom / bathroom / sleeps counts exactly. Do not exaggerate.
- Never include the street name or street number anywhere.
- No em dashes anywhere. No "luxurious", "stunning", "breathtaking", "paradise", "gem".
- Concrete nouns over adjectives. "Wolf range" beats "high-end appliances" when the data supports it.
`;

const LISTING_SPECIFIC_RULES = `
LISTING COPY RULES (in addition to the brand voice rules above):

- Title is "Stay at <Place>". <Place> is a micro-location, not an address. Pick something concrete from the area (a beach name, a cove, a neighborhood, a landmark). Never the property's own street.
- Tagline is one sentence. Lead with the place, then a concrete physical or sensory detail. Aim for 15 to 25 words.
- Description is 2 to 3 short paragraphs. First paragraph grounds the reader in the scene with specific, visible details (use the uploaded photos when present). Second paragraph covers the practical: rooms, sleeping arrangements, walkability, what's nearby. Optional third paragraph for a special note (boat house, dock, fireplace, garden).
- Use the photos if attached. Reference what's actually visible: the deck angle, the fireplace, the kitchen layout, the view. Do not invent details.
- Use the property's bedroom + bathroom + accommodates counts as supplied. Do not exaggerate.
- Do not use the words: luxurious, perfect, stunning, beautiful, amazing, paradise, breathtaking, gem.
- Do not use any em dashes. Period and start a new sentence instead.
- Never count properties or refer to "our homes". This is a single-listing description.
- Never include the property's street name or street number anywhere in the copy. The brand rule is "no address until they book". Coves, beaches, neighborhoods, and landmarks are fine; the listing's own street is not.
- Sentence case throughout. Proper nouns stay capitalized.
`;

function formatUserContext(p: HelmPropertyRow, brief: string): string {
  const lines: string[] = [];
  lines.push('Draft listing copy for the following property.');
  lines.push('');
  lines.push('Property data:');
  lines.push(`- Internal name: ${p.name}`);
  if (p.title) lines.push(`- Existing public title (may keep or revise): ${p.title}`);
  lines.push(`- Town / city: ${p.city || 'unknown'}`);
  if (p.type_of_unit) lines.push(`- Property type: ${p.type_of_unit}`);
  if (p.bedrooms != null) lines.push(`- Bedrooms: ${p.bedrooms}`);
  if (p.bathrooms != null) lines.push(`- Bathrooms: ${p.bathrooms}`);
  if (p.square_feet != null) lines.push(`- Square feet: ${p.square_feet}`);
  if (p.parking) lines.push(`- Parking: ${p.parking}`);
  if (p.basement) lines.push(`- Basement: ${p.basement}`);
  if (p.hoa) lines.push(`- HOA: ${p.hoa}`);
  lines.push('');
  lines.push('Operator notes about what makes this property special:');
  lines.push(brief.trim() ? brief.trim() : '(operator left blank)');
  lines.push('');
  lines.push(
    'Return JSON with {title, tagline, description}. Ground every concrete detail in the property data, operator notes, or the attached photos. Do not invent specifics that are not supported.',
  );
  return lines.join('\n');
}

function stripEmDashes(s: string): string {
  if (!s) return s;
  return s.replace(/\s*—\s*/g, '. ').replace(/\.\s+\./g, '.');
}
