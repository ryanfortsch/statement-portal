'use server';

import { supabaseAdmin } from '@/lib/supabase-admin';

export type ActivePropertyOption = { id: string; name: string; owner: string; location: string };

/**
 * Active properties for the upload dropdown, newest-name-sorted. Was a
 * client-side anon-key read of `properties` (which carries owner_last, owner
 * PII); moved server-side. Same columns, same shape, same fallback contract --
 * returns null (not []) on a fetch error so the caller can tell "failed, keep
 * the fallback list" apart from "succeeded with zero active properties".
 */
export async function loadActiveProperties(): Promise<ActivePropertyOption[] | null> {
  const { data, error } = await supabaseAdmin
    .from('properties')
    .select('id, name, owner_last, city')
    .eq('is_active', true)
    .order('name');
  if (error || !data) return null;
  const rows = data as Array<{ id: string; name: string; owner_last: string | null; city: string | null }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    owner: r.owner_last ?? '',
    location: (r.city ?? '').split(',')[0].trim(),
  }));
}

export type ExistingStatement = { exists: false } | { exists: true; ingestedAt: string | null; sent: boolean } | { exists: null };

/**
 * Is there already a statement for this property-month? "Process & Upload"
 * is a wipe-and-write re-ingest, so the form says so before the button and
 * the button asks before it replaces one. Read-only. A failed read is
 * `exists: null` (unknown), never "no statement".
 */
export async function loadExistingStatement(month: string, propertyId: string): Promise<ExistingStatement> {
  if (!/^\d{4}-\d{2}$/.test(month) || !propertyId) return { exists: false };
  const { data: period, error: periodErr } = await supabaseAdmin
    .from('statement_periods').select('id').eq('month', month).maybeSingle();
  if (periodErr) return { exists: null };
  if (!period) return { exists: false };
  const { data: stmt, error: stmtErr } = await supabaseAdmin
    .from('property_statements').select('id, updated_at, created_at')
    .eq('period_id', period.id).eq('property_id', propertyId).maybeSingle();
  if (stmtErr) return { exists: null };
  if (!stmt) return { exists: false };
  const { data: task, error: taskErr } = await supabaseAdmin
    .from('close_tasks').select('email_sent_at')
    .eq('period_id', period.id).eq('property_id', propertyId).maybeSingle();
  return {
    exists: true,
    ingestedAt: (stmt.updated_at as string | null) || (stmt.created_at as string | null) || null,
    // An unreadable sent stamp reads as sent: the confirm then says the most.
    sent: taskErr ? true : !!task?.email_sent_at,
  };
}
