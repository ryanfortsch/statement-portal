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

/**
 * Per-format Zod schemas. The .describe() strings are the model's
 * strongest formatting signal with generateObject, so they're
 * format-specific.
 *
 * The airbnb format emits ONE OUTPUT PER GUESTY DESCRIPTION FIELD,
 * matching the edit form at guesty.com/properties/<id>/descriptions/
 * edit: Title / Summary / The space / Guest access / The neighborhood.
 * Field conventions reverse-engineered from our own live listings via
 * the stay-cape-ann repo's snapshot parser (lib/guesty.ts:
 * cleanHighlights + cleanTagline document the authoring style):
 *
 *   summary  = headline + ✓ checkmark block, Airbnb caps at 500 chars
 *   space    = intro paragraph + ★★★ 1ST FLOOR ★★★ section headers
 *              with "→ Room: detail" lines, floor by floor
 */
function buildSchema(format: ListingCopyFormat) {
  if (format === 'airbnb') {
    return z.object({
      title: z.string().describe(
        'Public listing name. Format: "Stay at <Place>". <Place> is a short, evocative micro-location (a beach, cove, neighborhood). Maximum 50 characters total (Airbnb limit). No address, no street name or number. Must NOT duplicate any title in the taken-titles list.'
      ),
      summary: z.string().describe(
        'The Guesty/Airbnb Summary field. STRICT 500 character maximum (Airbnb truncates beyond that). Structure: one hook headline line (pattern: "4-Minute Walk to Good Harbor Beach!"), then a blank line, then 3-5 lines each starting with "✓ " covering location, renovation/condition, sleeping capacity ("Sleeps N across ..."), standout amenity. One fact per line. No street names.'
      ),
      space: z.string().describe(
        'The Guesty "The space" field. Structure, in this exact order:\n(1) One grounded 2-4 sentence intro paragraph describing the property as a guest experiences it.\n(2) A blank line, then floor-by-floor sections. Each section is a header line like "★★★ 1ST FLOOR ★★★" (also "★★★ 2ND FLOOR ★★★", "★★★ OUTDOOR ★★★", "★★★ GUEST HOUSE ★★★" as applicable), followed by "→ <Room>: <detail>" lines, one per room or feature, e.g. "→ Kitchen: Fully-stocked with essentials" / "→ Primary bedroom: king bed, ensuite bath".\nOnly include floors/areas the photos or property data support. 150-350 words total. No em dashes. No street names.'
      ),
      guest_access: z.string().describe(
        'The Guesty "Guest access" field. 1-3 short sentences: how guests get in (smart lock, keypad), what they have access to (whole home, which outdoor areas), parking. Only state what the property data or operator notes support. No codes, no street names.'
      ),
      neighborhood: z.string().describe(
        'The Guesty "The neighborhood" field. One short paragraph (2-4 sentences): the immediate area as a guest walks it — named beaches, galleries, restaurants, harbor. Use real Cape Ann place names from the property data or operator notes. No street names for the property itself.'
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

/**
 * Union result shape. Editorial fills {title, tagline, description};
 * airbnb fills {title, summary, space, guest_access, neighborhood} —
 * one entry per field in Guesty's description editor so the operator
 * pastes 1:1. All non-title fields optional so one type serves both.
 */
export type ListingCopy = {
  title: string;
  tagline?: string;
  description?: string;
  summary?: string;
  space?: string;
  guest_access?: string;
  neighborhood?: string;
};

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

  let draft = cleanCopy(object as Record<string, unknown>);

  // Deterministic street-name check. The system rules ban the property's
  // own street, but the operator's brief often mentions it naturally
  // ("at the end of Rackliffe Street") and the model echoes the brief
  // harder than it obeys the rule — observed twice on 2026-06-10. When
  // the draft leaks the street, run one focused corrective pass that
  // rewrites the offending phrases against a nearby landmark instead.
  const violations = findStreetViolations(draft, args.property);
  if (violations.length > 0) {
    draft = await rewriteWithoutStreet(draft, violations, format);
  }

  return draft;
}

/**
 * Find occurrences of the property's own street in the draft. Only
 * "<StreetName> <Suffix>" phrases ("Rackliffe Street", "Beach Rd") and
 * the full "<number> <street>" head ("19 Rackliffe") count — a bare
 * street-name token is too false-positive-prone ("granite countertops"
 * would trip on 36 Granite, "south-facing" on 3 South).
 */
function findStreetViolations(draft: ListingCopy, property: HelmPropertyRow): string[] {
  const head = (property.address || '').split(',')[0]?.trim() ?? '';
  if (!head) return [];
  const nameOnly = head
    .replace(/^\s*\d+\s*/, '')
    .replace(/\b(st|street|rd|road|ave|avenue|ln|lane|dr|drive|blvd|boulevard|way|cir|circle|ct|court|pl|place|ter|terrace)\b\.?\s*$/i, '')
    .trim();
  if (!nameOnly) return [];

  const streetNumber = (head.match(/^\s*(\d+)\s/) ?? [])[1] ?? null;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    // "<Name> <Suffix>": "Rackliffe Street", "Beach Rd"
    new RegExp(`\\b${esc(nameOnly)}\\s+(street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd|way|circle|cir|court|ct|place|pl|terrace|ter)\\b\\.?`, 'gi'),
  ];
  // "<Number> <Name>": "19 Rackliffe" — catches the suffix-less form
  // without the false positives a bare name-token match would cause
  // ("granite countertops" on 36 Granite, "south-facing" on 3 South).
  if (streetNumber) {
    patterns.push(new RegExp(`\\b${esc(streetNumber)}\\s+${esc(nameOnly)}\\b`, 'gi'));
  }

  const text = Object.values(draft).filter(Boolean).join('\n');
  const found = new Set<string>();
  for (const re of patterns) {
    for (const m of text.matchAll(re)) found.add(m[0]);
  }
  return [...found];
}

/** Trim + scrub every populated field of a generated object into the
 *  flat ListingCopy shape. */
function cleanCopy(raw: Record<string, unknown>): ListingCopy {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string' && v.trim()) out[k] = stripEmDashes(v.trim());
  }
  return out as unknown as ListingCopy;
}

/** One focused edit pass: keep everything, remove the street mentions. */
async function rewriteWithoutStreet(
  draft: ListingCopy,
  violations: string[],
  format: ListingCopyFormat,
): Promise<ListingCopy> {
  const draftBlock = Object.entries(draft)
    .filter(([, v]) => typeof v === 'string' && v)
    .map(([k, v]) => `${k}:\n${v}`)
    .join('\n\n');
  const { object } = await generateObject({
    model: 'anthropic/claude-sonnet-4.5',
    schema: buildSchema(format),
    system:
      'You are editing listing copy. Apply ONLY the requested removal. Keep every other word, line break, and structural element exactly as given.',
    prompt: `This listing draft violates the brand rule "never name the property's own street". Remove every mention of: ${violations.join(
      ', ',
    )}. Rephrase those spots against a nearby landmark, cove, beach, or neighborhood that already appears in the copy. Change nothing else.\n\n${draftBlock}`,
  });
  return cleanCopy(object as Record<string, unknown>);
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
GUESTY / AIRBNB LISTING RULES (in addition to the brand voice rules above):

You are filling the five fields of Guesty's description editor. Each output field maps 1:1 onto a Guesty field, so respect each field's own structure and length limit.

- title: "Stay at <Place>". <Place> is a micro-location, never a street name or number. Maximum 50 characters (Airbnb hard limit).
- summary: STRICT 500 character maximum (Airbnb truncates beyond it). One hook headline line leading with the single most bookable fact (walk time to a named beach, direct water access, dock) — pattern: "4-Minute Walk to Good Harbor Beach!". Then a blank line, then 3-5 "✓ " lines, one fact each: location, renovation state, sleeping capacity ("Sleeps N across ..."), standout amenity.
- space: one grounded 2-4 sentence intro paragraph, then floor-by-floor sections in our exact house style:
    ★★★ 1ST FLOOR ★★★
    → Kitchen: Fully-stocked with essentials
    → Dining: Kitchen bar and dining table
    ★★★ 2ND FLOOR ★★★
    → Primary bedroom: king bed, ensuite bath
  Use "★★★ <FLOOR/AREA> ★★★" headers (1ST FLOOR, 2ND FLOOR, 3RD FLOOR, OUTDOOR, GUEST HOUSE as applicable) and "→ <Room>: <detail>" lines. Group every room under its floor. Only include floors/areas the photos, operator notes, or property data support.
- guest_access: 1-3 short sentences. Entry method, what guests can use, parking. Never include actual codes.
- neighborhood: one short paragraph on the immediate area as a guest walks it. Real Cape Ann place names.
- Use the photos when attached. Reference what's actually visible. Do not invent finishes, appliance brands, or views that are not supported.
- Use the supplied bedroom / bathroom / sleeps counts exactly. Do not exaggerate.
- Never include the street name or street number anywhere.
- No em dashes anywhere. No "luxurious", "stunning", "breathtaking", "paradise", "gem".
- Concrete nouns over adjectives. "Wolf range" beats "high-end appliances" when the data supports it.
- Write for a GUEST staying a few nights to a few weeks, never for a buyer or long-term resident. Every line describes what a guest experiences during the stay. Never mention potential ("space for a garden if you want one", "room to grow", "could be converted"), ownership concerns (HOA, taxes, utilities), or renovation opportunity. A lawn is where a guest plays with their kids, not a future garden bed.
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
- Write for a GUEST staying a few nights to a few weeks, never for a buyer or long-term resident. Every line describes what a guest experiences during the stay. Never mention potential ("space for a garden if you want one"), ownership concerns, or renovation opportunity.
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
  // p.hoa intentionally NOT passed — it's owner data, and feeding it in
  // nudges the model toward real-estate-buyer copy (the "space for a
  // garden" incident, 2026-06-10).
  lines.push('');
  lines.push('Operator notes about what makes this property special:');
  lines.push(brief.trim() ? brief.trim() : '(operator left blank)');
  lines.push('');
  lines.push(
    'Fill every field of the response schema. Ground every concrete detail in the property data, operator notes, or the attached photos. Do not invent specifics that are not supported. The operator notes above may mention the street name — your output still must not. Translate any street reference into the nearest cove, beach, neighborhood, or landmark.',
  );
  return lines.join('\n');
}

function stripEmDashes(s: string): string {
  if (!s) return s;
  return s.replace(/\s*—\s*/g, '. ').replace(/\.\s+\./g, '.');
}
