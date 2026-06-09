import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  InspectionItemRow,
  ItemCategory,
  OrderedCard,
  SeasonMode,
} from './inspections-types';

/**
 * Generates the deck for a property's next inspection.
 *
 * Two modes:
 *   - **Zone-driven** (preferred): if the property has zones with at
 *     least one item assignment, expand the deck as (zone, item) cards
 *     in walk_order. A single template item can repeat across zones,
 *     so a property with three bathrooms produces three bathroom cards
 *     in the order an inspector physically walks the property.
 *   - **Fallback (Helm Core 12)**: if the property isn't mapped yet,
 *     fall back to the original 7+3 composition:
 *       * 7 EVERY_TIME items (always picked, in template sort_order)
 *       * 3 NICE_TO_HAVE items (rotated by priority then oldest-completed)
 *       * Optionally 1 INTERMITTENT item (replaces a NICE_TO_HAVE slot
 *         when DUE + spacing + season constraints all hold)
 *
 * Both modes return the same DeckResult shape; zone-driven cards carry
 * a zoneId while fallback cards have zoneId: null.
 */

const MAX_DECK_SIZE = 10;
const EVERY_TIME_TARGET = 7;
const NICE_TO_HAVE_TARGET = 3;
const MIN_INSPECTIONS_BETWEEN_INTERMITTENTS = 4;

// Hard ceiling on zone-driven decks. A layout with 11 zones × 2 items per
// zone explodes to 22 cards, which is exhausting and undermines the whole
// "tight checklist" mental model. Cap at 14 — generous enough for houses
// with several real zones, tight enough to feel like a checklist instead
// of a chore list. If a layout exceeds this after global dedup, trailing
// items in walk order are dropped (the inspector still hits everything
// that matters early in the walk).
const MAX_ZONE_CARDS = 14;

/**
 * Global inspection items are checks done once for the whole property
 * (Safety pass, "Hidden Areas Scan", "Bathroom Reset (All Baths)",
 * "Outdoor Areas Reset"). They legitimately live on ONE zone in walk
 * order — even if the layout parser stamped them on three. Used to dedup
 * a noisy property_zone_items table on the fly.
 */
function isGlobalItem(meta: { title: string; category: string } | undefined): boolean {
  if (!meta) return false;
  if ((meta.category || '').toLowerCase() === 'safety') return true;
  const t = (meta.title || '').toLowerCase();
  return (
    /\(\s*(all|every)\b/.test(t) ||
    /hidden\s+areas/.test(t) ||
    /quick\s+confirm/.test(t) ||
    /\breset\b/.test(t)
  );
}

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
  cards: OrderedCard[];
  itemIds: string[]; // legacy column kept in sync for back-compat
  composition: {
    mode: 'zone-driven' | 'fallback';
    cardCount: number;
    zoneCount?: number;
    everyTimeCount?: number;
    niceToHaveCount?: number;
    intermittentCount?: number;
  };
};

export async function generateDeck(args: {
  templateId: string;
  propertyId: string;
  client?: SupabaseClient;
}): Promise<DeckResult> {
  const sb = args.client ?? defaultClient();

  // First check whether the property has a usable zone mapping. We
  // consider a mapping usable when at least one zone has at least one
  // item assigned; otherwise we drop straight to the fallback so an
  // empty layout page doesn't strand the inspector.
  const { data: zoneRows } = await sb
    .from('property_zones')
    .select('id, walk_order')
    .eq('property_id', args.propertyId)
    .order('walk_order', { ascending: true });
  const zones = (zoneRows ?? []) as Array<{ id: string; walk_order: number }>;

  if (zones.length > 0) {
    const { data: zoneItemRows } = await sb
      .from('property_zone_items')
      .select('property_zone_id, inspection_item_id')
      .in(
        'property_zone_id',
        zones.map((z) => z.id),
      );
    const zoneItems = (zoneItemRows ?? []) as Array<{
      property_zone_id: string;
      inspection_item_id: string;
    }>;

    if (zoneItems.length > 0) {
      // Pull the items so we can keep within-zone order stable (by
      // template sort_order) AND so we can identify global items for
      // on-the-fly dedup. The deck walks zones in walk_order; within
      // each zone, items are ordered by their template sort_order.
      const itemIds = Array.from(new Set(zoneItems.map((zi) => zi.inspection_item_id)));
      const { data: itemRows } = await sb
        .from('inspection_items')
        .select('id, sort_order, title, category')
        .in('id', itemIds);
      const sortByItem = new Map<string, number>(
        ((itemRows ?? []) as Array<{ id: string; sort_order: number }>).map((r) => [
          r.id,
          r.sort_order,
        ]),
      );
      const itemMeta = new Map<string, { title: string; category: string }>(
        ((itemRows ?? []) as Array<{ id: string; title: string; category: string }>).map((r) => [
          r.id,
          { title: r.title, category: r.category },
        ]),
      );

      const byZone = new Map<string, string[]>();
      for (const zi of zoneItems) {
        const list = byZone.get(zi.property_zone_id) ?? [];
        list.push(zi.inspection_item_id);
        byZone.set(zi.property_zone_id, list);
      }
      for (const [zoneId, items] of byZone) {
        items.sort((a, b) => (sortByItem.get(a) ?? 0) - (sortByItem.get(b) ?? 0));
        byZone.set(zoneId, items);
      }

      // Walk zones in order, emitting one card per (zone, item). Two
      // safety nets here, both enforced even when the layout data is
      // dirty: (a) any global item is placed at its first walk-order
      // occurrence and skipped on later zones, (b) the total card count
      // is hard-capped at MAX_ZONE_CARDS. This is the only thing standing
      // between an over-aggressive layout parse and a 22-card slog.
      const cards: OrderedCard[] = [];
      const globalSeen = new Set<string>();
      let droppedDupe = 0;
      let droppedCap = 0;
      for (const zone of zones) {
        if (cards.length >= MAX_ZONE_CARDS) {
          droppedCap += (byZone.get(zone.id) ?? []).length;
          continue;
        }
        const items = byZone.get(zone.id) ?? [];
        for (const itemId of items) {
          if (cards.length >= MAX_ZONE_CARDS) {
            droppedCap += 1;
            continue;
          }
          if (isGlobalItem(itemMeta.get(itemId))) {
            if (globalSeen.has(itemId)) {
              droppedDupe += 1;
              continue;
            }
            globalSeen.add(itemId);
          }
          cards.push({ itemId, zoneId: zone.id });
        }
      }
      if (droppedDupe > 0 || droppedCap > 0) {
        console.info(
          '[generateDeck] zone-driven trim:',
          droppedDupe,
          'duplicate globals dropped,',
          droppedCap,
          'items dropped at',
          MAX_ZONE_CARDS,
          'card cap',
        );
      }

      return {
        cards,
        itemIds: cards.map((c) => c.itemId),
        composition: {
          mode: 'zone-driven',
          cardCount: cards.length,
          zoneCount: zones.length,
        },
      };
    }
  }

  // ─── Fallback: Helm Core 12 deck ────────────────────────────────────
  const [{ data: items }, { data: property }, { data: history }] = await Promise.all([
    sb
      .from('inspection_items')
      .select(
        'id, template_id, category, title, description, sort_order, item_category, interval_days, priority, season_constraint',
      )
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
  const inspectionsSinceLastIntermittent: number =
    property?.inspections_since_last_intermittent ?? 999;

  const historyMap = new Map<string, Date>();
  for (const h of history ?? []) {
    historyMap.set(
      (h as { inspection_item_id: string }).inspection_item_id,
      new Date((h as { last_completed_at: string }).last_completed_at),
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

  const cards: OrderedCard[] = deck.map((it) => ({ itemId: it.id, zoneId: null }));

  return {
    cards,
    itemIds: cards.map((c) => c.itemId),
    composition: {
      mode: 'fallback',
      cardCount: cards.length,
      everyTimeCount,
      niceToHaveCount,
      intermittentCount,
    },
  };
}

function defaultClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  return createClient(url, key);
}
