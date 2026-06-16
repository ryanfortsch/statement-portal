import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Per-property inspection card layout — the source of truth for "which
 * cards, in what order, does this property's inspection run."
 *
 * The model is WYSIWYG: a property's deck is the explicit, ordered list in
 * `property_inspection_cards`. What the operator lays out on the layout
 * editor is exactly what the inspection runs, in that order, every visit.
 * No rotation, no zone fan-out.
 *
 * Until a property is customized it has no rows; in that case the deck
 * falls back to the standard default below (the 7 EVERY_TIME items + enough
 * NICE_TO_HAVE items, by sort order, to reach DEFAULT_DECK_SIZE). The first
 * time the operator edits the layout, the full ordered list is persisted,
 * after which the default no longer applies.
 */

export const DEFAULT_DECK_SIZE = 10;

type ItemRow = {
  id: string;
  item_category: string | null;
  sort_order: number;
};

/**
 * The standard default deck for a property that hasn't been customized.
 * All EVERY_TIME items, then NICE_TO_HAVE items in sort order, capped at
 * DEFAULT_DECK_SIZE. Only shared/standard items (property_id IS NULL) — a
 * property's own custom items never leak into another property's default.
 */
export async function defaultDeckItemIds(
  sb: SupabaseClient,
  templateId: string,
): Promise<string[]> {
  const { data } = await sb
    .from('inspection_items')
    .select('id, item_category, sort_order')
    .eq('template_id', templateId)
    .is('property_id', null)
    .order('sort_order', { ascending: true });

  const items = (data ?? []) as ItemRow[];
  const everyTime = items.filter((i) => (i.item_category ?? 'EVERY_TIME') === 'EVERY_TIME');
  const niceToHave = items.filter((i) => i.item_category === 'NICE_TO_HAVE');

  const picked: string[] = everyTime.map((i) => i.id);
  for (const n of niceToHave) {
    if (picked.length >= DEFAULT_DECK_SIZE) break;
    picked.push(n.id);
  }
  return picked;
}

/**
 * The property's effective ordered deck (item ids in walk order). Persisted
 * layout if one exists, else the standard default. Shared by the deck
 * generator (at Start) and the layout editor (to seed the initial view).
 */
export async function loadPropertyDeckItemIds(
  sb: SupabaseClient,
  propertyId: string,
  templateId: string,
): Promise<{ itemIds: string[]; isCustomized: boolean }> {
  const { data } = await sb
    .from('property_inspection_cards')
    .select('inspection_item_id, position')
    .eq('property_id', propertyId)
    .order('position', { ascending: true });

  const rows = (data ?? []) as { inspection_item_id: string; position: number }[];
  if (rows.length > 0) {
    return { itemIds: rows.map((r) => r.inspection_item_id), isCustomized: true };
  }
  return { itemIds: await defaultDeckItemIds(sb, templateId), isCustomized: false };
}
