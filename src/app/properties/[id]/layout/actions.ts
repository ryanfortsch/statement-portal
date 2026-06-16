'use server';

/**
 * Server actions for the property inspection-layout editor
 * (/properties/[id]/layout).
 *
 * The layout is a per-property ordered list of inspection cards in
 * `property_inspection_cards`. Two mutations cover everything the editor
 * does:
 *   - saveLayout: persist the full ordered card list (reorder / delete /
 *     add-standard all reduce to "save the new order").
 *   - createCustomItem: mint a property-scoped inspection_items row for a
 *     card the operator wrote themselves; the client then appends it and
 *     calls saveLayout.
 *
 * A card always points at a real inspection_items row, so results, notes,
 * work-slips, the summary, and the emailed report keep keying on
 * inspection_items.id with no downstream change.
 */

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';
import { HELM_CORE_TEMPLATE_ID } from '@/lib/inspections-types';

type ActionResult<T = void> = { ok: true; data?: T } | { ok: false; error: string };

async function requireSession() {
  const session = await auth();
  if (!session?.user?.email) {
    return { ok: false as const, error: 'Not signed in' };
  }
  return { ok: true as const, email: session.user.email };
}

/**
 * Replace this property's entire inspection-card layout with the given
 * ordered item ids. Wipe-and-reinsert keeps `position` dense and in sync
 * with the array order. Validates that every id is a real item that's
 * either a shared standard card or scoped to THIS property (so one
 * property can't pull another's custom cards into its deck).
 */
export async function saveLayout(
  propertyId: string,
  itemIds: string[],
): Promise<ActionResult> {
  const gate = await requireSession();
  if (!gate.ok) return gate;

  // De-dupe while preserving order.
  const ordered = Array.from(new Set(itemIds.filter(Boolean)));
  if (ordered.length === 0) {
    return { ok: false, error: 'An inspection needs at least one card.' };
  }

  const { data: itemRows, error: itemsErr } = await supabase
    .from('inspection_items')
    .select('id, property_id')
    .in('id', ordered);
  if (itemsErr) return { ok: false, error: itemsErr.message };

  const valid = new Set(
    ((itemRows ?? []) as { id: string; property_id: string | null }[])
      .filter((r) => r.property_id === null || r.property_id === propertyId)
      .map((r) => r.id),
  );
  const finalIds = ordered.filter((id) => valid.has(id));
  if (finalIds.length === 0) {
    return { ok: false, error: 'No valid cards to save.' };
  }

  const { error: delErr } = await supabase
    .from('property_inspection_cards')
    .delete()
    .eq('property_id', propertyId);
  if (delErr) return { ok: false, error: delErr.message };

  const rows = finalIds.map((id, i) => ({
    property_id: propertyId,
    inspection_item_id: id,
    position: i,
  }));
  const { error: insErr } = await supabase.from('property_inspection_cards').insert(rows);
  if (insErr) return { ok: false, error: insErr.message };

  revalidatePath(`/properties/${propertyId}/layout`);
  return { ok: true };
}

/**
 * Mint a custom, property-scoped inspection card. Returns the new item so
 * the editor can drop it into the deck and persist via saveLayout. This
 * only creates the item row — it does NOT add it to the layout; the client
 * orchestrates the append so the deck is saved in one atomic ordering pass.
 */
export async function createCustomItem(args: {
  propertyId: string;
  title: string;
  description: string | null;
}): Promise<ActionResult<{ id: string; title: string; description: string | null; category: string }>> {
  const gate = await requireSession();
  if (!gate.ok) return gate;

  const title = args.title.trim();
  if (!title) return { ok: false, error: 'Card needs a title.' };
  if (title.length > 120) return { ok: false, error: 'Title is too long (120 char max).' };
  const description = args.description?.trim() || null;

  const { data, error } = await supabase
    .from('inspection_items')
    .insert({
      template_id: HELM_CORE_TEMPLATE_ID,
      property_id: args.propertyId,
      category: 'Custom',
      title,
      description,
      // sort_order high so custom cards trail standard ones in any
      // sort_order-keyed view (summary/report group by category + sort).
      sort_order: 1000,
      item_category: 'EVERY_TIME',
    })
    .select('id, title, description, category')
    .single();

  if (error || !data) return { ok: false, error: error?.message || 'Could not create the card.' };

  revalidatePath(`/properties/${args.propertyId}/layout`);
  return {
    ok: true,
    data: data as { id: string; title: string; description: string | null; category: string },
  };
}
