import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { OrderedCard } from './inspections-types';
import { loadPropertyDeckItemIds } from './inspection-cards';

/**
 * Generates the deck for a property's next inspection.
 *
 * The deck is the property's explicit, ordered card layout (see
 * lib/inspection-cards.ts): exactly the cards laid out on the inspection-
 * layout editor, in that order. A property that hasn't been customized
 * falls back to the standard default deck. No zone fan-out, no rotation —
 * what's laid out is what gets inspected, every visit.
 *
 * The result is snapshotted onto inspections.ordered_cards at Start, so
 * later edits to the layout don't change an in-progress walk. zoneId is
 * always null now (the zone model is retired); the field is kept on
 * OrderedCard for back-compat with historical zone-mapped inspections.
 */

export type DeckResult = {
  cards: OrderedCard[];
  itemIds: string[]; // legacy column kept in sync for back-compat
  composition: {
    cardCount: number;
    isCustomized: boolean;
  };
};

export async function generateDeck(args: {
  templateId: string;
  propertyId: string;
  client?: SupabaseClient;
}): Promise<DeckResult> {
  const sb = args.client ?? defaultClient();

  const { itemIds, isCustomized } = await loadPropertyDeckItemIds(
    sb,
    args.propertyId,
    args.templateId,
  );

  if (itemIds.length === 0) {
    throw new Error(
      `Inspection deck underfilled: no cards for property ${args.propertyId} (template ${args.templateId})`,
    );
  }

  const cards: OrderedCard[] = itemIds.map((itemId) => ({ itemId, zoneId: null }));

  return {
    cards,
    itemIds,
    composition: { cardCount: cards.length, isCustomized },
  };
}

function defaultClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  return createClient(url, key);
}
