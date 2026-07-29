/**
 * Guest-gear inventory: which homes currently have which portable gear and
 * where it lives (per Ryan: "a very simple grid... pack 'n play and high chair
 * and their locations"). One row per (property, item); presence = a non-empty
 * location. Service-role only, same posture as every Field table.
 */
import 'server-only';
import { fieldDb } from '@/lib/field-db';

/** The fixed columns of the grid. Extend here when a new gear type matters. */
export const GEAR_ITEMS: Array<{ key: string; label: string }> = [
  { key: 'pack_n_play', label: "Pack 'n play" },
  { key: 'high_chair', label: 'High chair' },
];

export type GearRow = {
  propertyId: string;
  propertyName: string;
  /** item_key -> location ('' when the home doesn't have one). */
  cells: Record<string, string>;
};

export async function loadGearGrid(): Promise<GearRow[]> {
  const [{ data: props }, { data: gear }] = await Promise.all([
    fieldDb().from('properties').select('id, name').order('name'),
    fieldDb().from('property_gear').select('property_id, item_key, location'),
  ]);
  const byProp = new Map<string, Record<string, string>>();
  for (const g of (gear ?? []) as Array<{ property_id: string; item_key: string; location: string }>) {
    const cells = byProp.get(g.property_id) ?? {};
    cells[g.item_key] = g.location;
    byProp.set(g.property_id, cells);
  }
  return ((props ?? []) as Array<{ id: string; name: string | null }>).map((p) => ({
    propertyId: p.id,
    propertyName: p.name || p.id,
    cells: Object.fromEntries(GEAR_ITEMS.map((i) => [i.key, byProp.get(p.id)?.[i.key] ?? ''])),
  }));
}

/** Write one cell. Empty location deletes the row (the home no longer has one). */
export async function upsertGearCell(
  propertyId: string,
  itemKey: string,
  location: string,
  updatedBy: string,
): Promise<{ ok: boolean }> {
  if (!propertyId || !GEAR_ITEMS.some((i) => i.key === itemKey)) return { ok: false };
  const clean = location.trim().slice(0, 300);
  if (!clean) {
    const { error } = await fieldDb().from('property_gear').delete().eq('property_id', propertyId).eq('item_key', itemKey);
    return { ok: !error };
  }
  const { error } = await fieldDb()
    .from('property_gear')
    .upsert(
      { property_id: propertyId, item_key: itemKey, location: clean, updated_by: updatedBy, updated_at: new Date().toISOString() },
      { onConflict: 'property_id,item_key' },
    );
  return { ok: !error };
}
