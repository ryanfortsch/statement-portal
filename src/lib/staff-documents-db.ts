import { supabaseAdmin } from '@/lib/supabase-admin';
import type { StaffDocumentRow } from '@/lib/staff-documents';
import { isSigningToken } from '@/lib/staff-documents';

/**
 * Reads for staff documents. Service role only: the table is RLS-locked
 * with no policies, and the public signing page reaches it by token.
 */

export async function staffDocumentByToken(token: string): Promise<StaffDocumentRow | null> {
  if (!isSigningToken(token)) return null;
  const { data } = await supabaseAdmin.from('staff_documents').select('*').eq('token', token).maybeSingle();
  return (data as StaffDocumentRow | null) ?? null;
}

export async function staffDocumentById(id: string): Promise<StaffDocumentRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await supabaseAdmin.from('staff_documents').select('*').eq('id', id).maybeSingle();
  return (data as StaffDocumentRow | null) ?? null;
}

export async function listStaffDocuments(): Promise<StaffDocumentRow[]> {
  const { data } = await supabaseAdmin
    .from('staff_documents')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);
  return (data as StaffDocumentRow[] | null) ?? [];
}
