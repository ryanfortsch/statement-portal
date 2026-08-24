import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { OrderedCard } from './inspections-types';
import { loadPropertyDeckItemIds } from './inspection-cards';
import { PULLOUT_BED_ITEM_ID, loadPulloutContext, pulloutCardNote } from './pullout-beds';

/**
 * Generates the deck for a property's next inspection.
 *
 * The deck is the property's explicit, ordered card layout (see
 * lib/inspection-cards.ts): exactly the cards laid out on the inspection-
 * layout editor, in that order. A property that hasn't been customized
 * falls back to the standard default deck. No zone fan-out, no rotation —
 * what's laid out is what gets inspected, every visit.
 *
 * On top of the laid-out deck sit AUTO cards: cards a condition puts in
 * front of the inspector rather than the layout. Today there is one -- the
 * Pullout Bed + Linens card, for homes with a pullout sofa -- and it
 * carries a note with the linen location plus any live guest request to
 * have the bed made up (see lib/pullout-beds.ts). An AUTO card is appended
 * rather than woven in, so the laid-out walk order is untouched and the
 * situational card is the last thing done before the review screen.
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

  // Pullout homes get the pullout card with this walk's note on it. If the
  // operator already laid the card into the deck by hand, annotate it in
  // place instead of showing it twice. A failure in here must never cost a
  // walk its deck, so it degrades to the plain deck.
  try {
    const pullout = await loadPulloutContext(sb, args.propertyId);
    const card = pulloutCardNote(pullout);
    if (card) {
      const existing = cards.find((c) => c.itemId === PULLOUT_BED_ITEM_ID);
      if (existing) {
        existing.note = card.note;
        existing.noteLevel = card.level;
      } else {
        cards.push({
          itemId: PULLOUT_BED_ITEM_ID,
          zoneId: null,
          note: card.note,
          noteLevel: card.level,
        });
      }
    }
  } catch {
    // no pullout card this walk
  }

  return {
    cards,
    itemIds: cards.map((c) => c.itemId),
    composition: { cardCount: cards.length, isCustomized },
  };
}

function defaultClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  return createClient(url, key);
}
