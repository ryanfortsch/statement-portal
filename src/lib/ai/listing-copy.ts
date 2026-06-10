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

export const ListingCopySchema = z.object({
  title: z.string().describe(
    'Public listing name. Format: "Stay at <Place>". <Place> is a short, evocative micro-location (a beach, harbor, street, neighborhood). 2-5 words after "Stay at". Examples: "Stay at Rocky Neck", "Stay at Old Garden Beach", "Stay at Little River". No address, no street number.'
  ),
  tagline: z.string().describe(
    'A single sentence (15-25 words) that reads like the opening line of an editorial blurb. Concrete physical detail, not adjectives. No em dashes. No count of properties or "homes". Examples: "Rocky Neck, harbor-side, with a 30-foot dock and the boats going by.", "Old Garden Beach is across the street."'
  ),
  description: z.string().describe(
    '2-3 short paragraphs separated by blank lines. First paragraph is a grounded scene (specific physical details from the photos and property data, never adjectives like "beautiful" or "stunning"). Subsequent paragraphs cover the practical (rooms, sleeping arrangements, walkability, what is nearby). 100-220 words total. No em dashes. No "luxurious". No "perfect". No count of properties. Sentence-case throughout.'
  ),
});

export type ListingCopy = z.infer<typeof ListingCopySchema>;

export type GenerateListingCopyArgs = {
  property: HelmPropertyRow;
  /** Operator-supplied notes ("what makes it special", quirks, vibe). */
  operatorBrief: string;
  /** Optional images as base64 data URLs. Up to ~6. */
  photoDataUrls?: string[];
};

export async function generateListingCopy(args: GenerateListingCopyArgs): Promise<ListingCopy> {
  const examples = pickExamples(args.property);
  const system = composeSystemPrompt(examples);
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
    schema: ListingCopySchema,
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

function composeSystemPrompt(examples: ListingExample[]): string {
  const parts = [
    'You are drafting public listing copy for a Stay Cape Ann home. The brand is editorial, grounded, and quiet — never promotional. Match the voice of the example listings below.',
    BRAND_VOICE_RULES,
    LISTING_SPECIFIC_RULES,
    'EXAMPLES OF EXISTING STAY CAPE ANN LISTING COPY:',
    examples
      .map(
        (e, i) =>
          `Example ${i + 1} (${e.town ?? 'unknown'}, ${e.bedrooms ?? '?'}bd / ${e.bathrooms ?? '?'}ba):\nTitle: ${e.title}\nTagline: ${e.tagline}\nDescription:\n${e.description}`,
      )
      .join('\n\n---\n\n'),
  ];
  return parts.join('\n\n');
}

const LISTING_SPECIFIC_RULES = `
LISTING COPY RULES (in addition to the brand voice rules above):

- Title is "Stay at <Place>". <Place> is a micro-location, not an address. Pick something concrete from the area (a beach name, a cove, a street that means something locally, a neighborhood). Never include a street number.
- Tagline is one sentence. Lead with the place, then a concrete physical or sensory detail. Aim for 15 to 25 words.
- Description is 2 to 3 short paragraphs. First paragraph grounds the reader in the scene with specific, visible details (use the uploaded photos when present). Second paragraph covers the practical: rooms, sleeping arrangements, walkability, what's nearby. Optional third paragraph for a special note (boat house, dock, fireplace, garden).
- Use the photos if attached. Reference what's actually visible: the deck angle, the fireplace, the kitchen layout, the view. Do not invent details.
- Use the property's bedroom + bathroom + accommodates counts as supplied. Do not exaggerate.
- Do not use the words: luxurious, perfect, stunning, beautiful, amazing, paradise, breathtaking, gem.
- Do not use any em dashes. Period and start a new sentence instead.
- Never count properties or refer to "our homes". This is a single-listing description.
- Never include the street address or street number.
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
