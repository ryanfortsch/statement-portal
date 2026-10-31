import type { SupabaseClient } from '@supabase/supabase-js';
import { selectAllPaged } from './paged-select.ts';
import { visitWorkIsComplete } from './vendor-visit-follow-through.ts';
import type { VendorVisitRow, VisitSlipInput } from './vendor-visit-core.ts';

const NOT_MIGRATED = new Set(['42P01', '42703', 'PGRST205']);
const SLIP_COLS = 'id, property_id, title, action_summary, category, status, run_scope, owner_action_required, from_supply_key, from_guest_request_key, scheduled_date, assigned_to_label, assigned_to_email, completed_at';

/** One source for both cards and badges. Reads fail visibly instead of
 * turning an unread work list into "nothing left to do". */
export async function loadVisitQueue(db: SupabaseClient, id?: string) {
  const rows = await selectAllPaged<VendorVisitRow>(async (from, to) => {
    let query = db.from('vendor_visit_proposals').select('*').in('status', ['pending', 'approving']);
    if (id) query = query.eq('id', id);
    const result = await query
      .order('message_at', { ascending: false }).order('id').range(from, to);
    if (result.error && NOT_MIGRATED.has(result.error.code)) return { data: [], error: null };
    return result;
  }, { label: 'Vendor visits' });
  const vendorIds = [...new Set(rows.flatMap(r => r.trade_vendor_id ? [r.trade_vendor_id] : []))];
  const homeIds = [...new Set(rows.flatMap(r => r.property_id ? [r.property_id] : []))];
  const [vendors, slips] = await Promise.all([
    vendorIds.length ? selectAllPaged<{ id: string; category: string }>((from, to) =>
      db.from('trade_vendors').select('id, category').in('id', vendorIds).order('id').range(from, to), { label: 'Visit vendors' }) : [],
    homeIds.length ? selectAllPaged<VisitSlipInput>((from, to) =>
      db.from('work_slips').select(SLIP_COLS).in('property_id', homeIds).in('status', ['open', 'in_progress', 'scheduled', 'done'])
        .order('id').range(from, to), { label: 'Visit work' }) : [],
  ]);
  const categories = new Map(vendors.map(v => [v.id, v.category]));
  return {
    rows: rows.filter(r => !visitWorkIsComplete(r, slips, r.trade_vendor_id ? categories.get(r.trade_vendor_id) ?? null : null)),
    slips,
    categories,
  };
}
