'use server';

/**
 * Server actions for the property "inspection layout" page (/properties/[id]/layout).
 *
 * These manage the property_zones rows (rooms / areas of the property in
 * walking order) and the property_zone_items join (which template items get
 * checked in each zone).
 *
 * Nothing here touches inspections / inspection_results yet — Increment 2
 * will plumb zones into deck generation. This is pure CRUD over the zone
 * model so the inspector layout for each property can be authored.
 */

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';

type ActionResult<T = void> = { ok: true; data?: T } | { ok: false; error: string };

async function requireSession() {
  const session = await auth();
  if (!session?.user?.email) {
    return { ok: false as const, error: 'Not signed in' };
  }
  return { ok: true as const, email: session.user.email };
}

export async function createZone(args: {
  propertyId: string;
  name: string;
  floor_label: string | null;
  notes: string | null;
}): Promise<ActionResult<{ id: string }>> {
  const gate = await requireSession();
  if (!gate.ok) return gate;

  const name = args.name.trim();
  if (!name) return { ok: false, error: 'Zone needs a name' };

  // New zones land at the bottom of the walk: max(walk_order) + 1.
  const { data: existing } = await supabase
    .from('property_zones')
    .select('walk_order')
    .eq('property_id', args.propertyId)
    .order('walk_order', { ascending: false })
    .limit(1);
  const nextOrder =
    existing && existing.length > 0
      ? (existing[0] as { walk_order: number }).walk_order + 1
      : 1;

  const { data, error } = await supabase
    .from('property_zones')
    .insert({
      property_id: args.propertyId,
      name,
      floor_label: args.floor_label?.trim() || null,
      notes: args.notes?.trim() || null,
      walk_order: nextOrder,
    })
    .select('id')
    .single();

  if (error || !data) return { ok: false, error: error?.message || 'Insert failed' };

  revalidatePath(`/properties/${args.propertyId}/layout`);
  return { ok: true, data: { id: (data as { id: string }).id } };
}

export async function updateZone(args: {
  zoneId: string;
  name: string;
  floor_label: string | null;
  notes: string | null;
}): Promise<ActionResult> {
  const gate = await requireSession();
  if (!gate.ok) return gate;

  const name = args.name.trim();
  if (!name) return { ok: false, error: 'Zone needs a name' };

  const { data: zoneRow } = await supabase
    .from('property_zones')
    .select('property_id')
    .eq('id', args.zoneId)
    .maybeSingle();

  const { error } = await supabase
    .from('property_zones')
    .update({
      name,
      floor_label: args.floor_label?.trim() || null,
      notes: args.notes?.trim() || null,
    })
    .eq('id', args.zoneId);

  if (error) return { ok: false, error: error.message };

  if (zoneRow) {
    revalidatePath(`/properties/${(zoneRow as { property_id: string }).property_id}/layout`);
  }
  return { ok: true };
}

export async function deleteZone(zoneId: string): Promise<ActionResult> {
  const gate = await requireSession();
  if (!gate.ok) return gate;

  const { data: zoneRow } = await supabase
    .from('property_zones')
    .select('property_id')
    .eq('id', zoneId)
    .maybeSingle();

  const { error } = await supabase.from('property_zones').delete().eq('id', zoneId);
  if (error) return { ok: false, error: error.message };

  if (zoneRow) {
    revalidatePath(`/properties/${(zoneRow as { property_id: string }).property_id}/layout`);
  }
  return { ok: true };
}

/**
 * Swap a zone's walk_order with its neighbor in the requested direction.
 * No-op if the zone is already at the edge.
 */
export async function moveZone(args: {
  zoneId: string;
  direction: 'up' | 'down';
}): Promise<ActionResult> {
  const gate = await requireSession();
  if (!gate.ok) return gate;

  const { data: zone } = await supabase
    .from('property_zones')
    .select('id, property_id, walk_order')
    .eq('id', args.zoneId)
    .maybeSingle();
  if (!zone) return { ok: false, error: 'Zone not found' };
  const z = zone as { id: string; property_id: string; walk_order: number };

  const base = supabase
    .from('property_zones')
    .select('id, walk_order')
    .eq('property_id', z.property_id);

  const { data: neighbor } =
    args.direction === 'up'
      ? await base
          .lt('walk_order', z.walk_order)
          .order('walk_order', { ascending: false })
          .limit(1)
          .maybeSingle()
      : await base
          .gt('walk_order', z.walk_order)
          .order('walk_order', { ascending: true })
          .limit(1)
          .maybeSingle();

  if (!neighbor) return { ok: true }; // already at edge
  const n = neighbor as { id: string; walk_order: number };

  // Straight swap — no unique constraint to dodge.
  await supabase.from('property_zones').update({ walk_order: n.walk_order }).eq('id', z.id);
  await supabase.from('property_zones').update({ walk_order: z.walk_order }).eq('id', n.id);

  revalidatePath(`/properties/${z.property_id}/layout`);
  return { ok: true };
}

/**
 * Replace this zone's assigned items in one shot. The form posts the full
 * desired set; we delete the existing rows and re-insert the new ones.
 * Two-step but small (Helm Core 12 has 12 items, so at most 12 inserts).
 */
export async function setZoneItems(args: {
  zoneId: string;
  inspectionItemIds: string[];
}): Promise<ActionResult> {
  const gate = await requireSession();
  if (!gate.ok) return gate;

  const { data: zoneRow } = await supabase
    .from('property_zones')
    .select('property_id')
    .eq('id', args.zoneId)
    .maybeSingle();

  const { error: delErr } = await supabase
    .from('property_zone_items')
    .delete()
    .eq('property_zone_id', args.zoneId);
  if (delErr) return { ok: false, error: delErr.message };

  if (args.inspectionItemIds.length > 0) {
    const rows = args.inspectionItemIds.map((id) => ({
      property_zone_id: args.zoneId,
      inspection_item_id: id,
    }));
    const { error: insErr } = await supabase.from('property_zone_items').insert(rows);
    if (insErr) return { ok: false, error: insErr.message };
  }

  if (zoneRow) {
    revalidatePath(`/properties/${(zoneRow as { property_id: string }).property_id}/layout`);
  }
  return { ok: true };
}

// ─── Form-shaped wrappers ──────────────────────────────────────────────
// The page uses `<form action={...}>` patterns to avoid client JS. These
// wrappers pull FormData payloads and delegate to the object-arg actions.
// Each returns void: `<form action>` in Next 16 strict typings only accepts
// `void | Promise<void>`, but the underlying object-arg actions return
// ActionResult for callable callers. Discard the ActionResult here; the
// actions themselves call revalidatePath / redirect for navigation.

export async function createZoneFromForm(propertyId: string, formData: FormData): Promise<void> {
  await createZone({
    propertyId,
    name: String(formData.get('name') || ''),
    floor_label: String(formData.get('floor_label') || '') || null,
    notes: String(formData.get('notes') || '') || null,
  });
}

export async function updateZoneFromForm(zoneId: string, formData: FormData): Promise<void> {
  await updateZone({
    zoneId,
    name: String(formData.get('name') || ''),
    floor_label: String(formData.get('floor_label') || '') || null,
    notes: String(formData.get('notes') || '') || null,
  });
}

export async function deleteZoneFromForm(zoneId: string): Promise<void> {
  await deleteZone(zoneId);
}

export async function moveZoneFromForm(zoneId: string, direction: 'up' | 'down'): Promise<void> {
  await moveZone({ zoneId, direction });
}

export async function setZoneItemsFromForm(zoneId: string, formData: FormData): Promise<void> {
  // Checkboxes share name 'item_id'; FormData.getAll returns all checked values.
  const ids = formData
    .getAll('item_id')
    .map((v) => String(v))
    .filter(Boolean);
  await setZoneItems({ zoneId, inspectionItemIds: ids });
}
