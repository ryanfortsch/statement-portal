import 'server-only';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { selectAllPaged } from '@/lib/paged-select';
import {
  buildNumberIndex,
  type DirectoryContact,
  type DirectoryEntry,
  type DirectoryOwner,
  type DirectoryProperty,
  type NumberDirectory,
  type NumberIndex,
} from '@/lib/known-numbers';

/**
 * Load every place Helm keeps a phone, for the resolver in known-numbers.ts.
 *
 * Each read fails soft to empty. A missing source can only make the
 * resolver know LESS, which puts a number back on the card or back in the
 * queue; it can never file a number onto the wrong contact.
 */
export type DirectoryPropertyRow = DirectoryProperty & { name: string };

export type LoadedNumberDirectory = Omit<NumberDirectory, 'properties'> & { properties: DirectoryPropertyRow[] };

export async function loadNumberDirectory(): Promise<LoadedNumberDirectory> {
  const soft = <T,>(p: Promise<T[]>): Promise<T[]> => p.catch(() => [] as T[]);
  const [contacts, owners, properties, field, trades, prospects, addressBook] = await Promise.all([
    soft(selectAllPaged<DirectoryContact>((from, to) =>
      supabase.from('contacts').select('id, name, type, phone, linked_property_ids').order('name').order('id').range(from, to),
    )),
    soft(selectAllPaged<DirectoryOwner>((from, to) =>
      supabase.from('owners').select('id, name_full, name_greeting, name_last, phones').order('id').range(from, to),
    )),
    soft(selectAllPaged<DirectoryPropertyRow>((from, to) =>
      supabase.from('properties').select('id, name, owner_id, owner_full, owner_greeting, owner_last').order('name').order('id').range(from, to),
    )),
    soft(selectAllPaged<{ full_name: string; phone: string | null }>((from, to) =>
      supabase.from('contractors').select('full_name, phone').neq('status', 'archived').not('phone', 'is', null).order('id').range(from, to),
    )).then((rows) => rows.map((r): DirectoryEntry => ({ phone: r.phone, name: r.full_name }))),
    soft(selectAllPaged<{ name: string; contact_name: string | null; phone: string | null; after_hours_phone: string | null }>((from, to) =>
      supabase.from('trade_vendors').select('name, contact_name, phone, after_hours_phone').is('archived_at', null).order('id').range(from, to),
    )).then((rows) => rows.flatMap((r): DirectoryEntry[] => [
      { phone: r.phone, name: r.contact_name ? `${r.contact_name}, ${r.name}` : r.name },
      { phone: r.after_hours_phone, name: r.name },
    ])),
    soft(selectAllPaged<{ prospect_name: string; prospect_phone: string | null }>((from, to) =>
      supabase.from('projections').select('prospect_name, prospect_phone').not('prospect_phone', 'is', null).order('id').range(from, to),
    )).then((rows) => rows.map((r): DirectoryEntry => ({ phone: r.prospect_phone, name: r.prospect_name }))),
    soft(selectAllPaged<{ phone: string | null; suggested_name: string | null }>((from, to) =>
      supabase
        .from('contact_reconcile_suggestions')
        .select('phone, suggested_name')
        .eq('status', 'pending')
        .eq('suggestion_type', 'add_contact')
        .order('id')
        .range(from, to),
    )).then((rows) => rows.map((r): DirectoryEntry => ({ phone: r.phone, name: r.suggested_name ?? '' }))),
  ]);
  return { contacts, owners, properties, field, trades, prospects, addressBook };
}

/**
 * The webhook's copy, kept for a minute. Every text to a number that is
 * not a contact asks it (each guest send on the GUESTS line among them),
 * so it must not cost seven reads apiece. A household filled from it is
 * found by its phone on the next message, so a stale minute never misfiles.
 */
let cached: { at: number; index: NumberIndex } | null = null;
const CACHE_MS = 60_000;

export async function cachedNumberIndex(): Promise<NumberIndex> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.index;
  const index = buildNumberIndex(await loadNumberDirectory());
  cached = { at: Date.now(), index };
  return index;
}

/**
 * Put a phone on a contact that has none. Fill-empty only, and the guard
 * rides on the UPDATE (`phone is null`), so an operator who typed a number
 * a moment ago keeps it and this write matches no rows.
 */
export async function fillContactPhone(contactId: string, phone: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('contacts')
    .update({ phone, updated_at: new Date().toISOString() })
    .eq('id', contactId)
    .is('phone', null)
    .select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}
