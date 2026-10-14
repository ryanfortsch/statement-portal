/**
 * The month-close handoff, the database half. See close-handoff.ts for the
 * rules and vocabulary. Service role throughout: the table is RLS-locked
 * with no policies, and the photos sit in the private expense-receipts
 * bucket (under handoff/...) read back through a short signed URL, exactly
 * like a receipt's own file.
 *
 * This module never writes a statement, a receipt or a payout. Filing an
 * item is an owner posting it to /api/receipts; the row only records the
 * receipt id that came back.
 */
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import type { HandoffItem, HandoffKind, HandoffStatus } from '@/lib/close-handoff';

const TABLE = 'close_handoff_items';
const BUCKET = 'expense-receipts';
const SELECT =
  'id, month, property_id, kind, description, vendor, amount, charge_date, file_path, status, created_by, created_at, sent_at, resolved_at, resolved_by, resolution_note, receipt_id';
const SIGNED_URL_TTL_SECONDS = 600;

export const HANDOFF_ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']);
export const HANDOFF_MAX_FILE_BYTES = 25 * 1024 * 1024;

type Row = Omit<HandoffItem, 'amount'> & { amount: number | string | null };

function toItem(r: Row): HandoffItem {
  return { ...r, amount: r.amount == null ? null : Number(r.amount) };
}

export async function loadHandoffItems(
  filter: { months?: string[]; propertyId?: string; statuses?: HandoffStatus[] } = {},
): Promise<HandoffItem[]> {
  if (!isServiceConfigured) return [];
  let q = supabaseAdmin.from(TABLE).select(SELECT).order('created_at', { ascending: false }).limit(1000);
  if (filter.months && filter.months.length > 0) q = q.in('month', filter.months);
  if (filter.propertyId) q = q.eq('property_id', filter.propertyId);
  if (filter.statuses && filter.statuses.length > 0) q = q.in('status', filter.statuses);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map(toItem);
}

export async function loadHandoffItem(id: string): Promise<HandoffItem | null> {
  if (!isServiceConfigured) return null;
  const { data, error } = await supabaseAdmin.from(TABLE).select(SELECT).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toItem(data as Row) : null;
}

export async function insertHandoffItem(row: {
  month: string;
  property_id: string;
  kind: HandoffKind;
  description: string;
  vendor: string | null;
  amount: number | null;
  charge_date: string | null;
  file_path: string | null;
  created_by: string;
}): Promise<HandoffItem> {
  const { data, error } = await supabaseAdmin.from(TABLE).insert(row).select(SELECT).single();
  if (error) throw new Error(error.message);
  return toItem(data as Row);
}

export async function updateHandoffItem(
  id: string,
  patch: Partial<Pick<HandoffItem, 'status' | 'sent_at' | 'resolved_at' | 'resolved_by' | 'resolution_note' | 'receipt_id'>>,
): Promise<HandoffItem | null> {
  const { data, error } = await supabaseAdmin.from(TABLE).update(patch).eq('id', id).select(SELECT).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toItem(data as Row) : null;
}

export async function deleteHandoffItem(id: string): Promise<void> {
  const { error } = await supabaseAdmin.from(TABLE).delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Every open item for the month becomes sent. Returns how many moved. */
export async function markHandoffMonthSent(month: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('month', month)
    .eq('status', 'open')
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned.length > 80 ? cleaned.slice(0, 80) : cleaned;
}

/**
 * Store a photo or PDF for an item. A failed upload degrades to a fileless
 * item with a warning, the receipts precedent: never lose the entry over a
 * storage hiccup. Type and size are validated by the caller, which can
 * answer 400; this only moves bytes.
 */
export async function uploadHandoffFile(
  file: File,
  month: string,
  propertyId: string,
): Promise<{ path: string | null; warning: string | null }> {
  const contentType = file.type || 'application/octet-stream';
  const path = `handoff/${month}/${propertyId}/${Date.now()}-${sanitizeFilename(file.name || 'photo')}`;
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, file, { contentType, upsert: false });
  if (error) {
    console.warn('handoff upload failed, saving a fileless item:', error.message);
    return { path: null, warning: 'The photo upload failed; the item was saved without it.' };
  }
  return { path, warning: null };
}

export async function removeHandoffFile(path: string): Promise<void> {
  await supabaseAdmin.storage.from(BUCKET).remove([path]).catch(() => undefined);
}

export async function signedHandoffUrl(path: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/** True when the registry knows the property (any kind but the office). */
export async function propertyExists(propertyId: string): Promise<boolean> {
  if (!isServiceConfigured) return false;
  const { data } = await supabaseAdmin.from('properties').select('id, kind').eq('id', propertyId).maybeSingle();
  return !!data && (data as { kind: string | null }).kind !== 'hq';
}
