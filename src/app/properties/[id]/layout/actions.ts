'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { HELM_CORE_TEMPLATE_ID } from '@/lib/inspections-types';

type Card = { id: string; title: string; description: string | null; category: string };
type ActionResult<T = void> = { ok: true; data?: T } | { ok: false; error: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validIds = (ids: string[]) => Array.isArray(ids) && ids.length > 0 && ids.every(id => typeof id === 'string' && uuid.test(id)) && new Set(ids).size === ids.length;

/** One transaction validates and replaces the full order; errors preserve the previous deck. */
export async function saveLayout(propertyId: string, itemIds: string[]): Promise<ActionResult> {
  if (!(await auth())?.user?.email) return { ok: false, error: 'Not signed in' };
  if (!validIds(itemIds)) return { ok: false, error: 'Choose at least one valid card, with no duplicates.' };
  const { error } = await supabaseAdmin.rpc('helm_save_inspection_layout', { p_property_id: propertyId, p_item_ids: itemIds });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/properties/${propertyId}/layout`);
  return { ok: true };
}

/** Creation and attachment share a transaction. A retained request ID makes a lost response retryable. */
export async function createCustomItem(args: {
  propertyId: string; title: string; description: string | null; requestId: string; itemIds: string[];
}): Promise<ActionResult<Card>> {
  if (!(await auth())?.user?.email) return { ok: false, error: 'Not signed in' };
  const title = args.title.trim();
  if (!title || title.length > 120) return { ok: false, error: 'Give the card a title of 1 to 120 characters.' };
  if (!uuid.test(args.requestId || '') || !validIds(args.itemIds)) return { ok: false, error: 'Invalid card or checklist. Refresh and try again.' };
  const { data, error } = await supabaseAdmin.rpc('helm_create_inspection_card', {
    p_property_id: args.propertyId, p_item_ids: args.itemIds, p_request_id: args.requestId,
    p_template_id: HELM_CORE_TEMPLATE_ID, p_title: title, p_description: args.description?.trim() || null,
  });
  if (error || !data) return { ok: false, error: error?.message || 'Could not confirm the card save.' };
  revalidatePath(`/properties/${args.propertyId}/layout`);
  return { ok: true, data: data as Card };
}
