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
- ONE ZONE per distinct room or check-able area. A house with three bathrooms produces three bathroom zones; three bedrooms → three bedroom zones.
- Preserve walking order from the prose. Do not alphabetize.
- name = short label, title-case, no floor baked in. ("Primary bedroom", not "Upstairs primary bedroom".)
- floor = the floor label the operator used ("Main floor", "Second floor", "Basement"), or null if not specified.
- itemTitles per zone = EXACT titles from the provided list, copied CHARACTER-FOR-CHARACTER (including \`+\`, "(All Baths)" suffixes, casing, spacing). Do NOT paraphrase. If the list says "Kitchen Surfaces + Sink", write exactly that.
- DO NOT invent items. Use only titles from the provided list.
- If the prose mentions a room type the template has no items for, include the zone with an empty itemTitles array.

CRITICAL: GLOBAL ITEMS ATTACH TO ONLY ONE ZONE.
A house with three bedrooms doesn't need three copies of every item. Some items are "global" — they're checked once for the whole property, not per-room — and attaching them to multiple zones balloons the card count and creates pointless duplicate work.

A title is a GLOBAL ITEM if any of the following is true:
  - the title contains "(All …)" or "(Every …)" (e.g. "Bathroom Reset (All Baths)" is checked once across every bath, not per-bath)
  - the title mentions "Hidden Areas" or "Scan" or "Quick Confirm" (whole-house glance)
  - the category is "Safety" (one safety pass covers the whole house)
  - the item name says "Reset" without naming a specific room

For each GLOBAL ITEM, pick ONE zone — the most natural place an inspector would actually do that check — and attach it there. Do NOT attach it to other zones of the same room type. Examples:
  - "Bathroom Reset (All Baths)" → attach to the FIRST bathroom zone in walk order. Do not attach to the second or third bathroom.
  - "Floors + Hidden Areas Scan" → attach to ONE zone where the inspector glances under furniture (typically the primary bedroom or living room). Not every room.
  - "Safety Quick Confirm" → attach to a Kitchen zone if present, otherwise a Utility/Laundry zone, otherwise the LAST zone in the walk. NEVER the entry/hallway — checking smoke alarms in a bare hallway is awkward.

Per-instance items (which DO repeat per zone):
  - "Beds + Linens Presentation" — every bedroom needs its bed checked separately.
  - "Kitchen Surfaces + Sink" — only one kitchen typically, so just one attachment.
  - "Toiletries + Toilet Paper" in a bathroom — yes, each bathroom needs toiletries checked (this is per-bath, not "(All Baths)").

CARD COUNT TARGET: aim for 10–14 total cards across the whole layout. If you're over 16, something is duplicated that shouldn't be. Re-check the global-item rule above.`;

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
