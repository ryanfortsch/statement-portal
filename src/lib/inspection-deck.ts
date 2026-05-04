import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  InspectionItemRow,
  ItemCategory,
  SeasonMode,
} from './inspections-types';

/**
 * Helm-native port of Perfection's `inspectionOrdering.ts`. Generates the
 * 10-card deck for a property's next inspection.
 *
 * Composition (hard rules):
 *   - Exactly 10 cards (MAX_DECK_SIZE)
 *   - 7 EVERY_TIME items (always picked, in template sort_order)
 *   - 3 NICE_TO_HAVE items (rotated by priority then oldest-completed)
 *   - Optionally 1 INTERMITTENT item (replaces a NICE_TO_HAVE slot when
 *     all three conditions hold: at least one DUE based on interval_days
 *     since last completion; spacing of >= 4 inspections since last
 *     intermittent on this property; season_constraint allows it)
 */

const MAX_DECK_SIZE = 10;
const EVERY_TIME_TARGET = 7;
const NICE_TO_HAVE_TARGET = 3;
const MIN_INSPECTIONS_BETWEEN_INTERMITTENTS = 4;

type DeckItem = Pick<
  InspectionItemRow,
  'id' | 'template_id' | 'category' | 'title' | 'description' | 'sort_order'
> & {
  item_category: ItemCategory | null;
  interval_days: number | null;
  priority: number | null;
  season_constraint: 'ANY' | 'ACTIVE_ONLY' | null;
};

export type DeckResult = {
  itemIds: string[];
  items: DeckItem[];
  composition: {
    everyTimeCount: number;
    niceToHaveCount: number;
    intermittentCount: number;
  };
};

export async function generateDeck(args: {
  templateId: string;
  propertyId: string;
  client?: SupabaseClient;
}): Promise<DeckResult> {
  const sb = args.client ?? defaultClient();

  const [{ data: items }, { data: property }, { data: history }] = await Promise.all([
    sb
      .from('inspection_items')
      .select('id, template_id, category, title, description, sort_order, item_category, interval_days, priority, season_constraint')
      .eq('template_id', args.templateId)
      .order('sort_order'),
    sb
      .from('properties')
      .select('season_mode, inspections_since_last_intermittent')
      .eq('id', args.propertyId)
      .maybeSingle(),
    sb
      .from('property_inspection_item_history')
      .select('inspection_item_id, last_completed_at')
      .eq('property_id', args.propertyId),
  ]);

  if (!items || items.length === 0) {
    throw new Error(`Inspection deck underfilled: no items for template ${args.templateId}`);
  }

  const seasonMode: SeasonMode = (property?.season_mode as SeasonMode) || 'ACTIVE';
  const inspectionsSinceLastIntermittent: number = property?.inspections_since_last_intermittent ?? 999;

  const historyMap = new Map<string, Date>();
  for (const h of history ?? []) {
    historyMap.set(
      (h as { inspection_item_id: string }).inspection_item_id,
      new Date((h as { last_completed_at: string }).last_completed_at)
    );
  }

  const all = items as DeckItem[];
  const everyTime = all.filter((i) => (i.item_category ?? 'EVERY_TIME') === 'EVERY_TIME');
  const intermittent = all.filter((i) => i.item_category === 'INTERMITTENT');
  const niceToHave = all.filter((i) => i.item_category === 'NICE_TO_HAVE');

  const seasonOk = (item: DeckItem): boolean =>
    !(item.season_constraint === 'ACTIVE_ONLY' && seasonMode !== 'ACTIVE');

  const isDue = (item: DeckItem): boolean => {
    const last = historyMap.get(item.id);
    if (!last) return true;
    const days = Math.floor((Date.now() - last.getTime()) / 86400_000);
    return days >= (item.interval_days ?? 0);
  };

  const sortIntermittent = (xs: DeckItem[]): DeckItem[] =>
    [...xs].sort((a, b) => {
      const pa = a.priority ?? 999;
      const pb = b.priority ?? 999;
      if (pa !== pb) return pa - pb;
      const la = historyMap.get(a.id)?.getTime();
      const lb = historyMap.get(b.id)?.getTime();
      if (la == null && lb == null) return 0;
      if (la == null) return -1;
      if (lb == null) return 1;
      return la - lb;
    });

  const sortNiceToHave = (xs: DeckItem[]): DeckItem[] =>
    [...xs].sort((a, b) => {
      const pa = a.priority ?? 999;
      const pb = b.priority ?? 999;
      if (pa !== pb) return pa - pb;
      return a.sort_order - b.sort_order;
    });

  const deck: DeckItem[] = [];
  const seen = new Set<string>();
  const add = (item: DeckItem) => {
    if (deck.length >= MAX_DECK_SIZE) return false;
    if (seen.has(item.id)) return false;
    deck.push(item);
    seen.add(item.id);
    return true;
  };

  let everyTimeCount = 0;
  for (const it of everyTime) {
    if (everyTimeCount >= EVERY_TIME_TARGET) break;
    if (add(it)) everyTimeCount++;
  }

  let intermittentCount = 0;
  let intermittentSlot: DeckItem | null = null;
  if (inspectionsSinceLastIntermittent >= MIN_INSPECTIONS_BETWEEN_INTERMITTENTS) {
    const dueIntermittent = intermittent.filter(seasonOk).filter(isDue);
    if (dueIntermittent.length > 0) {
      intermittentSlot = sortIntermittent(dueIntermittent)[0];
    }
  }

  const niceToHaveNeeded = intermittentSlot ? NICE_TO_HAVE_TARGET - 1 : NICE_TO_HAVE_TARGET;
  let niceToHaveCount = 0;
  for (const it of sortNiceToHave(niceToHave.filter(seasonOk))) {
    if (niceToHaveCount >= niceToHaveNeeded) break;
    if (add(it)) niceToHaveCount++;
  }

  if (intermittentSlot) {
    if (add(intermittentSlot)) intermittentCount = 1;
  }

  return {
    itemIds: deck.map((i) => i.id),
    items: deck,
    composition: { everyTimeCount, niceToHaveCount, intermittentCount },
  };
}

function defaultClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  return createClient(url, key);
}
