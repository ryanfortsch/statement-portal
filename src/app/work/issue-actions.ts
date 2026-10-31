'use server';

import { auth } from '@/auth';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin as db } from '@/lib/supabase-admin';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function refreshIssueViews() {
  revalidatePath('/work');
  revalidatePath('/work/[id]', 'page');
  revalidatePath('/properties/[id]', 'page');
  revalidatePath('/properties');
  revalidatePath('/');
  revalidatePath('/messaging/team');
  revalidatePath('/fieldwork/packets', 'layout');
}
export async function linkWorkReports(args: { primaryId: string; reportIds: string[] }): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Sign in again to link reports.' };
  if (!uuid.test(args.primaryId) || !Array.isArray(args.reportIds) || args.reportIds.length < 1 || args.reportIds.length > 24 || args.reportIds.some(id => !uuid.test(id))) return { ok: false, error: 'Choose related reports to link.' };
  const { error } = await db.rpc('link_work_issue', { p_primary: args.primaryId, p_reports: args.reportIds, p_actor: session.user.email });
  if (error) return { ok: false, error: 'The reports could not be linked. Refresh and check they are at the same property, share a completion state, and are not linked elsewhere.' };
  refreshIssueViews();
  return { ok: true };
}
export async function separateWorkReports(args: { issueId: string; reportIds: string[] }): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Sign in again to separate reports.' };
  if (!uuid.test(args.issueId) || !Array.isArray(args.reportIds) || args.reportIds.length < 2 || args.reportIds.some(id => !uuid.test(id))) return { ok: false, error: 'Refresh the linked reports first.' };
  const { error } = await db.rpc('separate_work_issue', { p_issue: args.issueId, p_reports: args.reportIds, p_actor: session.user.email });
  if (error) return { ok: false, error: 'The linked reports changed or could not be saved. Refresh before trying again.' };
  refreshIssueViews();
  return { ok: true };
}
