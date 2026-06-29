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

/** Stay Cape Ann's public Instagram handle, appended as a soft CTA to the
 *  Airbnb/Guesty summary. Single source of truth so the handle is trivial to
 *  change. Confirm it is correct before relying on the generated copy. */
const SCA_INSTAGRAM = '@staycapeann';

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

export type ListingCopyFormat = 'airbnb' | 'editorial' | 'sca';

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
        `The Guesty/Airbnb "Summary" field. STRICT 500 character maximum INCLUDING the Instagram line below (Airbnb truncates past 500). Structure:\n(1) 4 or 5 lines, each starting "✓ ", each pairing a concrete fact with the guest benefit it creates (not a bare fact). Lead the first line with the single most bookable fact (walk time to a named beach, direct water access, a dock). Across the lines cover: location, the build or condition ("newly built", "fully renovated"), sleeping capacity ("Sleeps N across N bedrooms and N full baths"), the primary suite or standout amenity, and the gathering or outdoor spaces.\n(2) A blank line, then this exact call to action on its own line: "Visit ${SCA_INSTAGRAM} on Instagram for a video property tour."\nTrim the bullets so the whole field, Instagram line included, stays under 500 characters. No street names. No exclamation points.`
      ),
      space: z.string().describe(
        `The Guesty "The space" field: a warm, flowing, editorial description, NOT a terse spec list. In this exact order:\n(1) TWO short opening paragraphs. Paragraph 1 grounds the home (what it is, where it sits; lead with the build when supported, e.g. "Newly built" or "Recently renovated"; use a specific year ONLY if the operator brief gives one, never invent one). Paragraph 2 paints the guest experience in full sentences, e.g. "Whether you are enjoying coffee on the covered porch, preparing dinner in the open kitchen, or unwinding in the primary suite, every space was designed with comfort in mind."\n(2) A blank line, then "★★★ HIGHLIGHTS ★★★" and 4 to 6 "→ " lines, each one concrete top selling point.\n(3) A blank line, then floor-by-floor sections. Header lines like "★★★ MAIN LEVEL ★★★", then "★★★ SECOND FLOOR ★★★", "★★★ THIRD FLOOR ★★★", "★★★ OUTDOORS ★★★", "★★★ GUEST HOUSE ★★★" as applicable. Under each, "→ <Room>: <one warm, complete sentence>" lines. Room names in Title Case ("Living Room", "Primary Suite"). Each line frames the grounded detail as part of the stay, e.g. "Custom kitchen with a large center island, premium appliances, and room to cook for a crowd" (not "white cabinetry, dark backsplash"). Only include floors and rooms the photos or property data support.\n(4) A blank line, then a closing paragraph of 2 to 4 sentences tying the location and the stay together (the beach by day, the nearby Cape Ann spots, coming home to the house).\n250 to 450 words total. Plain text only: NO markdown and NO ** asterisks (they show as literal characters in Guesty and Airbnb). No em dashes. No street names.`
      ),
      guest_access: z.string().describe(
        'The Guesty "Guest access" field. 1-3 short sentences: how guests get in (smart lock, keypad), what they have access to (whole home, which outdoor areas), parking. Only state what the property data or operator notes support. No codes, no street names.'
      ),
      neighborhood: z.string().describe(
        'The Guesty "The neighborhood" field. One short paragraph (2-4 sentences): the immediate area as a guest walks it — named beaches, galleries, restaurants, harbor. Use real Cape Ann place names from the property data or operator notes. No street names for the property itself.'
      ),
    });
  }
  if (format === 'sca') {
    // The staycapeann.com launch form: one output per editable field on
    // /properties/[id]/stay-cape-ann, so "Pull from Guesty" fills the whole
    // form in the SCA editorial voice rather than dumping raw Guesty copy.
    return z.object({
      title: z.string().describe(
        'Public listing name. Format: "Stay at <Place>". <Place> is a short, evocative micro-location (a beach, harbor, cove, neighborhood). 2-5 words after "Stay at". Must NOT duplicate any title in the taken-titles list. No address, no street name or number.'
      ),
      pitch: z.string().describe(
        'A 4-8 word hook shown on the home-page map. Concrete and place-anchored: "Waterfront on Granite Point", "Steps from Good Harbor Beach", "Harbor views in Rocky Neck". Title Case, no trailing punctuation, no street names, no adjectives like "stunning".'
      ),
      tagline: z.string().describe(
        'The italic subhead on the listing page: ONE line of 8-15 words. Concrete physical detail, not adjectives. No em dashes, no exclamation marks, no street names, no checkmarks.'
      ),
      description: z.string().describe(
        'The staycapeann.com "About the home" body, in our warm editorial house format, IDENTICAL in shape to the Guesty/Airbnb "The space" field so the two surfaces match (the separate highlights field below carries the bullet perks, so do NOT add a HIGHLIGHTS block here). In this order:\n(1) TWO short opening paragraphs: paragraph 1 grounds the home (lead with the build when supported; a specific year only if the brief gives one), paragraph 2 paints the guest experience in full sentences.\n(2) A blank line, then floor-by-floor sections: "★★★ MAIN LEVEL ★★★" (then "★★★ SECOND FLOOR ★★★", "★★★ THIRD FLOOR ★★★", "★★★ OUTDOORS ★★★", "★★★ GUEST HOUSE ★★★" as applicable) with "→ <Room>: <one warm, complete sentence>" lines under each, Title-Case room names. Only include floors and rooms the source supports.\n(3) A blank line, then a closing paragraph of 2 to 4 sentences tying location and stay together.\n250 to 450 words. Plain text only, no markdown, no ** asterisks. No em dashes. No "perfect". No street names.'
      ),
      highlights: z
        .array(
          z.string().describe(
            'One concrete selling point, 4-12 words, no leading bullet glyph, no trailing period. E.g. "Private deck overlooking the cove", "Walk to galleries and the working harbor".'
          ),
        )
        .min(3)
        .max(5)
        .describe(
          '3 to 5 highlight bullets. Each is one concrete feature or location perk, distinct from the tagline. No street names. No duplicates. No checkmark glyphs.'
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
  /** sca format: the home-page map hook (4-8 words). */
  pitch?: string;
  /** sca format: 3-5 highlight bullets. */
  highlights?: string[];
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

  const text = Object.values(draft)
    .flatMap((v) => (Array.isArray(v) ? v : [v]))
    .filter((v): v is string => typeof v === 'string' && !!v)
    .join('\n');
  const found = new Set<string>();
  for (const re of patterns) {
    for (const m of text.matchAll(re)) found.add(m[0]);
  }
  return [...found];
}

/** Trim + scrub every populated field of a generated object into the
 *  flat ListingCopy shape. */
function cleanCopy(raw: Record<string, unknown>): ListingCopy {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string' && v.trim()) {
      out[k] = stripEmDashes(v.trim());
    } else if (Array.isArray(v)) {
      // sca highlights: keep as a trimmed, scrubbed string[].
      const arr = v
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => stripEmDashes(x.trim()));
      if (arr.length) out[k] = arr;
    }
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
    .filter(([, v]) => (typeof v === 'string' && v) || (Array.isArray(v) && v.length))
    .map(([k, v]) => `${k}:\n${Array.isArray(v) ? v.map((x) => `- ${x}`).join('\n') : v}`)
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
    ...(format === 'sca' ? [SCA_FORMAT_RULES] : []),
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

const SCA_FORMAT_RULES = `
STAY CAPE ANN LAUNCH-FORM RULES (in addition to the editorial rules above):

You are filling the staycapeann.com launch form. The source material is the home's existing Guesty copy (a checkmark "summary", a "The space" description, an amenity list, and bed/bath counts). Rewrite it into our voice. Keep every concrete, verifiable detail; discard OTA brochure-speak, exclamation marks, and "✓" bullets.

- pitch: a 4-8 word map hook. Lead with the single most place-defining fact (the water, the beach, the neighborhood). No trailing punctuation.
- tagline: ONE line, 8-15 words. Not a paragraph. The single most evocative true sentence about being there.
- description: our warm editorial house format, IDENTICAL in shape to the Guesty/Airbnb "The space" field. Two short opening paragraphs (ground the home, then paint the stay), then "★★★ <FLOOR/AREA> ★★★" headers (MAIN LEVEL, SECOND FLOOR, THIRD FLOOR, OUTDOORS, GUEST HOUSE as applicable) with "→ <Room>: <full warm sentence>" lines under each (Title-Case room names), then a short closing paragraph. Do NOT add a HIGHLIGHTS block here (the highlights field below carries those). Group every room under its floor; only include floors the source supports.
- highlights: 3-5 short bullets, each a distinct concrete perk. Do not restate the tagline. No "✓".
- Use the supplied bedroom / bathroom / sleeps counts exactly. Do not exaggerate or invent finishes, views, or amenities not in the source.
- Never include the street name or street number anywhere.`;

const AIRBNB_FORMAT_RULES = `
GUESTY / AIRBNB LISTING RULES (in addition to the brand voice rules above):

You are filling the five fields of Guesty's description editor; each output maps 1:1 onto a Guesty field. The copy should read like a warm, confident, editorial listing a guest wants to book, while staying grounded in real, supported detail. Fuller and warmer than a spec sheet, but never hype.

LISTING VOICE (this layers on the brand rules above):
- Write in warm, flowing, full sentences. Frame specifics as guest benefits: "a center island with room to cook for a crowd", "soaring ceilings and oversized windows that fill the rooms with light".
- These descriptors are welcome WHEN the data or photos support them: newly built, recently renovated, custom, thoughtfully designed, open-concept, soaring ceilings, abundant natural light, high-end finishes, refined finishes, spa-inspired, water views, covered porch.
- Still banned (empty hype): stunning, breathtaking, luxurious, paradise, gem, perfect, must-see. Use the word "luxury" at most once, and only when new construction plus high-end finishes genuinely warrant it; never "luxurious".
- Ground every concrete detail in the property data, operator notes, or the attached photos. Do not invent finishes, appliance brands, views, or a year built.

FIELDS:
- title: "Stay at <Place>". A micro-location, never a street name or number. Maximum 50 characters (Airbnb hard limit).
- summary: 4 to 5 "✓ " benefit-led lines (each a fact plus the benefit it creates), then a blank line, then exactly: "Visit ${SCA_INSTAGRAM} on Instagram for a video property tour." Keep the whole field under 500 characters. No exclamation points.
- space: the warm editorial body. Two opening paragraphs (ground the home, then paint the stay), then "★★★ HIGHLIGHTS ★★★" with "→" bullets, then floor-by-floor sections, then a closing lifestyle paragraph. 250 to 450 words. Plain text only, no ** markdown (asterisks show as literal characters in Guesty/Airbnb). Title-Case room names. Example shape:

    Newly built and a short walk from the beach, this home pairs custom design with an easy, open layout.

    Whether you are having coffee on the porch, cooking for a crowd, or unwinding upstairs, every space was made for a relaxed stay.

    ★★★ HIGHLIGHTS ★★★
    → Three-minute walk to the beach
    → Open-concept living filled with natural light

    ★★★ MAIN LEVEL ★★★
    → Living Room: Open great room with comfortable seating and oversized windows
    → Kitchen: Custom kitchen with a large island and room to cook together

    ★★★ SECOND FLOOR ★★★
    → Primary Suite: King bedroom with water views and a spa-inspired bath

    Spend your days at the beach and your evenings back at the house.

- guest_access: 1 to 3 sentences. Entry method, what guests can use, parking. Never include actual codes.
- neighborhood: one warm paragraph on the immediate area as a guest walks it, using real Cape Ann place names.

- Use the photos when attached: reference what is actually visible.
- Use the supplied bedroom and bathroom counts exactly; derive "Sleeps N" sensibly. Do not exaggerate.
- Never include the street name or street number anywhere. No em dashes anywhere.
- Write for a GUEST staying a few nights to a few weeks, never for a buyer or long-term resident. Never mention potential ("room to grow", "space for a garden"), ownership concerns (HOA, taxes, utilities), or renovation opportunity.
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
