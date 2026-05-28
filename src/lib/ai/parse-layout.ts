/**
 * Free-form house description → structured inspection zones in walk order.
 *
 * The /properties/[id]/layout page has a manual "Add Zone" form, but
 * typing 10-15 rooms one at a time is painful for a fresh property.
 * This helper lets an operator describe the house in prose ("Main floor
 * has a kitchen, living room, half-bath; upstairs there's the primary
 * bedroom with an ensuite, two more bedrooms, and a shared bath; basement
 * has a laundry and a media room") and gets back an ordered list of
 * (name, floor) zones the server action can insert directly.
 *
 * Walking order is critical — inspectors do a physical walk and the
 * deck renders in the order zones are listed. We instruct the model to
 * preserve the order implied by the prose ("first the main floor, then
 * upstairs, then basement") rather than alphabetize.
 */

import { generateObject } from 'ai';
import { z } from 'zod';

export const ParsedZoneSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      'Short label for the room or area, e.g. "Kitchen", "Primary bedroom", "Upstairs bath". Title-case. No floor in the name.',
    ),
  floor: z
    .string()
    .nullable()
    .describe(
      'Floor label like "Main floor", "Second floor", "Basement", "Upstairs". null if the prose does not say.',
    ),
});

export const ParsedLayoutSchema = z.object({
  zones: z
    .array(ParsedZoneSchema)
    .describe('Inspection zones in physical walking order, from first to last.'),
});

export type ParsedZone = z.infer<typeof ParsedZoneSchema>;
export type ParsedLayout = z.infer<typeof ParsedLayoutSchema>;

const SYSTEM_PROMPT = `You convert a free-form description of a vacation-rental house into a structured list of inspection zones in physical walking order.

Rules:
- One zone per distinct room or check-able area (kitchen, living room, each bedroom separately, each bathroom separately, deck/patio, basement laundry, etc.). A property with three bathrooms produces three zone entries, not one.
- Preserve the walking order implied by the prose. If the operator describes the main floor first then upstairs, list main-floor zones first. Do not alphabetize.
- name = short label, title-case, no floor included (good: "Primary bedroom"; bad: "Upstairs primary bedroom").
- floor = the floor label the operator used ("Main floor", "Second floor", "Basement", "Upstairs"), or null if not specified.
- Skip non-zone content (notes about the property, owner preferences, supplies, codes). Only include actual physical zones to walk.
- If a room appears with no clear name, infer the cleanest one (e.g. "kitchen / dining area" → "Kitchen", or split into two zones if they are clearly distinct).
- Output at least one zone; if the prose is too vague to extract anything, return a single best-guess zone rather than empty.`;

/**
 * Parse a free-form house description into an ordered list of zones.
 * Throws on AI failure; the calling server action should catch and
 * return a user-friendly error.
 */
export async function parseLayoutProse(prose: string): Promise<ParsedZone[]> {
  const trimmed = prose.trim();
  if (!trimmed) return [];

  const { object } = await generateObject({
    model: 'anthropic/claude-haiku-4.5',
    schema: ParsedLayoutSchema,
    system: SYSTEM_PROMPT,
    prompt: `Convert this house description into ordered inspection zones:\n\n${trimmed}`,
  });

  return object.zones;
}
