/**
 * Free-form house description → fully-mapped inspection layout
 * (zones in walk order, each pre-populated with the right items from the
 * Helm Core template). The operator never has to click an item checkbox.
 *
 * Input:
 *   - prose: "Main floor kitchen, living room, half-bath; upstairs primary
 *     with ensuite, two more bedrooms, shared bath; basement laundry."
 *   - templateItems: the inspection_items for this property's template.
 *
 * Output: zones in physical walking order, each with the `itemTitles` that
 * belong to that room type. The server action maps titles back to ids and
 * inserts property_zones + property_zone_items in one shot.
 */

import { generateObject } from 'ai';
import { z } from 'zod';

export type LayoutTemplateItem = {
  id: string;
  category: string;
  title: string;
  description: string | null;
};

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
  itemTitles: z
    .array(z.string())
    .describe(
      'Exact titles of inspection_items (from the provided list) that belong in this zone. Must match the provided titles exactly — do not invent items. Empty array allowed for general/transition zones with nothing to check.',
    ),
});

export const ParsedLayoutSchema = z.object({
  zones: z
    .array(ParsedZoneSchema)
    .describe('Inspection zones in physical walking order, from first to last.'),
});

export type ParsedZone = z.infer<typeof ParsedZoneSchema>;
export type ParsedLayout = z.infer<typeof ParsedLayoutSchema>;

const SYSTEM_PROMPT = `You convert a free-form description of a vacation-rental house into a fully-mapped inspection layout: zones in physical walking order, each pre-populated with the right inspection items from a fixed template.

Inputs:
1. A house description in prose ("Main floor has a kitchen, living room, …").
2. A fixed list of inspection items (id, category, title, description). The operator NEVER edits these — they are the checklist for every property in the team's standard.

Output rules:
- ONE ZONE per distinct room or check-able area. A house with three bathrooms produces three bathroom zones, NOT one. A house with three bedrooms produces three bedroom zones.
- Preserve walking order from the prose. If main floor is described first then upstairs, the zone list goes main floor → upstairs. Do not alphabetize.
- name = short label, title-case, no floor baked in. ("Primary bedroom", not "Upstairs primary bedroom".)
- floor = the floor label the operator used ("Main floor", "Second floor", "Basement"), or null if not specified.
- itemTitles per zone = the EXACT titles (verbatim) of inspection items from the provided list that belong in that room type. Match by category and meaning:
    * Kitchen zone → kitchen-category items
    * Bathroom zone → bathroom-category items
    * Bedroom zone → bedroom-category items
    * Living/family room → living-category items
    * Entry / foyer / mudroom → entry-category items
    * Outdoor / deck / patio / yard → outdoor-category items
    * Laundry / utility → laundry/utility-category items
    * Safety items (smoke alarms etc.) → attach to the first zone the inspector walks (typically the entry) so they get checked once, not per-room.
- Each general-purpose item (Floors + Hidden Areas Scan, etc.) goes on a zone where it's most useful (e.g. living room or each bedroom).
- DO NOT invent items. Use only titles from the provided list, copied verbatim.
- If the prose mentions a room type the template has no items for (e.g. "wine cellar"), include the zone with an empty itemTitles array — better to surface the zone than drop it.`;

/**
 * Parse prose + the property's template items into a fully-mapped layout.
 * Throws on AI failure; calling server action should catch.
 */
export async function parseLayoutProse(
  prose: string,
  templateItems: LayoutTemplateItem[],
): Promise<ParsedZone[]> {
  const trimmed = prose.trim();
  if (!trimmed) return [];
  if (templateItems.length === 0) return [];

  // Pass the available items so Claude can match by title verbatim.
  // Grouped by category for legibility; the model still has to pick by exact title.
  const itemsByCategory = new Map<string, LayoutTemplateItem[]>();
  for (const it of templateItems) {
    const arr = itemsByCategory.get(it.category) ?? [];
    arr.push(it);
    itemsByCategory.set(it.category, arr);
  }
  const itemsBlock = Array.from(itemsByCategory.entries())
    .map(([cat, items]) => {
      const lines = items.map((it) => `  - "${it.title}"${it.description ? ` — ${it.description}` : ''}`);
      return `${cat}:\n${lines.join('\n')}`;
    })
    .join('\n\n');

  const { object } = await generateObject({
    model: 'anthropic/claude-haiku-4.5',
    schema: ParsedLayoutSchema,
    system: SYSTEM_PROMPT,
    prompt: `Available inspection items (use these exact titles):\n\n${itemsBlock}\n\nHouse description:\n\n${trimmed}\n\nReturn zones in walking order, each with the itemTitles that belong to that zone.`,
  });

  return object.zones;
}
