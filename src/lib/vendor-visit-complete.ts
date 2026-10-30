import type { SupabaseClient } from '@supabase/supabase-js';
import type { VendorVisitRow } from './vendor-visit-core.ts';

export const VISIT_COMPLETED_REASON = 'Work completed';
type Result = { ok: true; propertyId: string | null; slipIds: string[] } | { ok: false; error: string; stale?: boolean };
const ACTIVE = ['open', 'scheduled', 'in_progress'];

/** Explicit operator completion. Only selected jobs are closed. Claim the
 * proposal before touching work; never hide it on a partial failure. Updates
 * to already-done jobs are no-ops, so retry preserves completion timestamps.
 * Calendar holds and messages are deliberately outside this action. */
export async function completeVendorVisit(db: SupabaseClient, id: string, slipIds: string[], actor: string, now = new Date()): Promise<Result> {
  if (!actor || slipIds.length > 40 || new Set(slipIds).size !== slipIds.length) return { ok: false, error: 'Check the selected work and try again.' };
  const { data, error } = await db.from('vendor_visit_proposals').select('*').eq('id', id).maybeSingle();
  if (error) return { ok: false, error: 'The visit could not be checked. Try again.' };
  const row = data as VendorVisitRow | null;
  if (!row || row.status !== 'pending') return { ok: false, error: 'This visit has changed. Refresh and try again.', stale: true };
  if (row.hold_result || /hold may be partly|hold did not finish/i.test(row.last_error ?? '')) return { ok: false, error: 'Check the existing calendar hold before closing this visit.' };
  if (slipIds.length && (!row.property_id || row.source === 'owner')) return { ok: false, error: 'This visit has no team work to complete.' };

  const readWork = async () => db.from('work_slips').select('id, status').eq('property_id', row.property_id!).in('id', slipIds);
  if (slipIds.length) {
    const work = await readWork();
    if (work.error || work.data?.length !== slipIds.length || work.data.some(s => ![...ACTIVE, 'done'].includes(s.status))) {
      return { ok: false, error: 'Some selected work has changed. Refresh and check the selection.' };
    }
  }
  const claimed = await db.from('vendor_visit_proposals').update({ status: 'approving', claimed_at: now.toISOString() })
    .eq('id', id).eq('status', 'pending').select('id');
  if (claimed.error) return { ok: false, error: 'The visit could not be saved. Try again.' };
  if (!claimed.data?.length) return { ok: false, error: 'Someone else just updated this visit.', stale: true };

  try {
    if (slipIds.length) {
      const done = await db.from('work_slips').update({ status: 'done', completed_at: now.toISOString(), closed_by_email: actor })
        .eq('property_id', row.property_id!).in('id', slipIds).in('status', ACTIVE);
      if (done.error) throw new Error('The selected work could not be saved.');
      const checked = await readWork();
      if (checked.error || checked.data?.length !== slipIds.length || checked.data.some(s => s.status !== 'done')) {
        throw new Error('Some work changed while saving.');
      }
    }
    const finished = await db.from('vendor_visit_proposals').update({ status: 'handled', handled_reason: VISIT_COMPLETED_REASON,
      decided_by: actor, decided_at: now.toISOString(), claimed_at: null, last_error: null, scheduled_slip_ids: slipIds })
      .eq('id', id).eq('status', 'approving').select('id');
    if (finished.error || !finished.data?.length) throw new Error('The visit could not be closed.');
    return { ok: true, propertyId: row.property_id, slipIds };
  } catch (e) {
    const message = `${e instanceof Error ? e.message : 'Saving did not finish.'} The visit is still open; some work may already be marked complete. Refresh and review it before retrying.`;
    await db.from('vendor_visit_proposals').update({ status: 'pending', claimed_at: null, last_error: message })
      .eq('id', id).eq('status', 'approving');
    return { ok: false, error: message };
  }
}
