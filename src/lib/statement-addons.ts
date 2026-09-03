/**
 * Attributed add-on / debit totals for one property-month, read from
 * bank_deposit_attributions. These feed the canonical statement formula:
 *
 *   fee_base     = rental_revenue + addOnsMgmtBase
 *   owner_payout = rental_revenue + addOnsRevenue - management_fee
 *                  - cleaning_total - repairs_total - attributedDebits
 *                  - reserve_holdback
 *
 * `tax_amount` on an attributed row is occupancy tax held for the state.
 * It is NOT in any term of that formula: `amount` is already net of it, so
 * the owner's add-on revenue and the fee base are unchanged by its
 * existence. It comes back as `addOnsTax` for the remittance sheet alone.
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
  /**
   * Occupancy tax collected inside attributed add-on charges, held for
   * remittance (2026-08-27). Reported only -- it is deliberately absent
   * from every term above, because it is the state's money, not revenue
   * and not part of the management-fee base. The accountant's remittance
   * sheet is its one consumer. Zero for every row written before the
   * add-on tax gross-up shipped, so no historical payout moves.
   */
  addOnsTax: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

// Narrow to THIS table. A bare `relation` / `does not exist` match swallows
// unrelated failures -- "could not open relation with OID" during a
// concurrent DDL, a missing COLUMN -- straight back into the zeros this
// function exists to refuse. Same narrowing installments.ts received.
const missingTable = (err: { code?: string; message?: string } | null): boolean =>
  !!err && (
    err.code === 'PGRST205' ||
    (/bank_deposit_attributions/i.test(err.message || '') && /relation .* does not exist|Could not find the table|does not exist/i.test(err.message || ''))
  );

export async function loadAddOnTotals(
  supabase: SupabaseClient,
  propertyId: string,
  month: string,
): Promise<AddOnTotals> {
  const { data, error } = await supabase
    .from('bank_deposit_attributions')
    .select('amount, apply_mgmt_fee, direction, tax_amount')
    .eq('property_id', propertyId)
    .eq('month', month)
    .eq('status', 'attributed');
  // Pre-migration environments have no attributions at all, so zeros are
  // correct there. Any other read failure must throw -- returning zeros
  // on a transient error would let a caller overwrite real add-on totals.
  if (error) {
    if (missingTable(error)) return { addOnsRevenue: 0, addOnsMgmtBase: 0, attributedDebits: 0, addOnsTax: 0 };
    throw new Error(`bank_deposit_attributions read failed: ${error.message}`);
  }
  let addOnsRevenue = 0;
  let addOnsMgmtBase = 0;
  let attributedDebits = 0;
  let addOnsTax = 0;
  for (const a of data || []) {
    const amt = Number(a.amount) || 0;
    if ((a.direction || 'deposit') === 'debit') {
      attributedDebits += amt;
    } else {
      addOnsRevenue += amt;
      if (a.apply_mgmt_fee) addOnsMgmtBase += amt;
      addOnsTax += Number(a.tax_amount) || 0;
    }
  }
  return {
    addOnsRevenue: round2(addOnsRevenue),
    addOnsMgmtBase: round2(addOnsMgmtBase),
    attributedDebits: round2(attributedDebits),
    addOnsTax: round2(addOnsTax),
  };
}
