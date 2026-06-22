import { supabase } from '@/lib/supabase';

/**
 * Internal per-property notes — the structured replacement for the
 * old freeform `properties.property_notes` text blob. Each row is one
 * note: title, body, optional tag, optional photos, optional
 * resolved-at timestamp for one-shot todos.
 *
 * Lives in `public.property_notes` (migration 20260528). Renders on
 * /properties/[id] inside the "Property Notes" accordion.
 *
 * NOT to be confused with `public.property_notices` (one-i) — those
 * are guest-facing 4×6 printed placards. Different concept, different
 * lifecycle, different audience.
 */

export type PropertyNote = {
  id: string;
  property_id: string;
  title: string;
  body: string;
  tag: string | null;
  /** true = part of the guest-messaging knowledge base; false = internal ops. */
  guest_facing: boolean;
  photo_urls: string[];
  author_email: string | null;
  resolved_at: string | null;
  resolved_by_email: string | null;
  created_at: string;
  updated_at: string;
};

/** All notes for a property, newest first. Includes resolved entries
 *  so the operator can review past quirks; the accordion summary
 *  filters to open-only for the closed-state count chip. */
export async function getPropertyNotes(propertyId: string): Promise<PropertyNote[]> {
  const { data, error } = await supabase
    .from('property_notes')
    .select('*')
    .eq('property_id', propertyId)
    .order('resolved_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as PropertyNote[] | null) ?? [];
}

/** Single note by id. Used by the edit page. */
export async function getPropertyNote(noteId: string): Promise<PropertyNote | null> {
  const { data, error } = await supabase
    .from('property_notes')
    .select('*')
    .eq('id', noteId)
    .maybeSingle();
  if (error) throw error;
  return (data as PropertyNote | null) ?? null;
}

/** Count of open (unresolved) notes for a property. Cheap call used
 *  on the property page to seed the accordion's closed-state summary
 *  without fetching every row. */
export async function countOpenPropertyNotes(propertyId: string): Promise<number> {
  const { count } = await supabase
    .from('property_notes')
    .select('id', { count: 'exact', head: true })
    .eq('property_id', propertyId)
    .is('resolved_at', null);
  return count ?? 0;
}
