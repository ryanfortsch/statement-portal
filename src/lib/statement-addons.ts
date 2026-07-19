/**
 * Attributed add-on / debit totals for one property-month, read from
 * bank_deposit_attributions. These feed the canonical statement formula:
 *
 *   fee_base     = rental_revenue + addOnsMgmtBase
 *   owner_payout = rental_revenue + addOnsRevenue - management_fee
 *                  - cleaning_total - repairs_total - attributedDebits
 *                  - reserve_holdback
 *
 * The bank-deposits PATCH route, receipts routes, and reserve route
 * already compute with these terms; this helper exists so the OTHER
 * recompute sites (stripe-sync, fill-gap, refresh-statement) can fold
 * them in without each re-implementing the query. A statement with no
 * attributions gets zeros back and produces numbers identical to the
 * pre-add-on formula.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type AddOnTotals = {
  addOnsRevenue: number;
  addOnsMgmtBase: number;
  attributedDebits: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const missingTable = (err: { code?: string; message?: string } | null): boolean =>
  !!err && (err.code === 'PGRST205' || /does not exist|relation|Could not find the table/i.test(err.message || ''));

export async function loadAddOnTotals(
  supabase: SupabaseClient,
  propertyId: string,
  month: string,
): Promise<AddOnTotals> {
  const { data, error } = await supabase
    .from('bank_deposit_attributions')
    .select('amount, apply_mgmt_fee, direction')
    .eq('property_id', propertyId)
    .eq('month', month)
    .eq('status', 'attributed');
  // Pre-migration environments have no attributions at all, so zeros are
  // correct there. Any other read failure must throw -- returning zeros
  // on a transient error would let a caller overwrite real add-on totals.
  if (error) {
    if (missingTable(error)) return { addOnsRevenue: 0, addOnsMgmtBase: 0, attributedDebits: 0 };
    throw new Error(`bank_deposit_attributions read failed: ${error.message}`);
  }
  let addOnsRevenue = 0;
  let addOnsMgmtBase = 0;
  let attributedDebits = 0;
  for (const a of data || []) {
    const amt = Number(a.amount) || 0;
    if ((a.direction || 'deposit') === 'debit') {
      attributedDebits += amt;
    } else {
      addOnsRevenue += amt;
      if (a.apply_mgmt_fee) addOnsMgmtBase += amt;
    }
  }
  return {
    addOnsRevenue: round2(addOnsRevenue),
    addOnsMgmtBase: round2(addOnsMgmtBase),
    attributedDebits: round2(attributedDebits),
  };
}
