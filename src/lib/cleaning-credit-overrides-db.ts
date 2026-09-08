import type { SupabaseClient } from '@supabase/supabase-js';
import type { CreditFamily, CreditOverride } from './cleaning-credit-overrides';

/**
 * The durable operator-override rows behind src/lib/cleaning-credit-
 * overrides.ts. One writer (PATCH /api/cleaning-events/:id keeps the
 * table in step with the credit it just wrote), one remover
 * (/api/resolve-gap `remove_credit_override`), two readers (the rebuild
 * paths). Reads fail closed: a rebuild that cannot read the overrides
 * files a critical gap rather than quietly billing the owner the gross.
 */

export const CREDIT_OVERRIDES_TABLE = 'cleaning_credit_overrides';

const COLS = 'id, family, charge_date, charge_amount, credit_amount, reason, created_at';

export async function loadCreditOverrides(
  supabase: SupabaseClient,
  propertyId: string,
  month: string,
): Promise<CreditOverride[]> {
  if (!propertyId || !month) return [];
  const { data, error } = await supabase
    .from(CREDIT_OVERRIDES_TABLE)
    .select(COLS)
    .eq('property_id', propertyId)
    .eq('month', month)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`${CREDIT_OVERRIDES_TABLE} read failed: ${error.message}`);
  return (data || []).map(r => ({
    id: String(r.id),
    family: r.family as CreditFamily,
    charge_date: String(r.charge_date),
    charge_amount: Number(r.charge_amount),
    credit_amount: Number(r.credit_amount),
    reason: (r.reason as string | null) ?? null,
    created_at: String(r.created_at),
  }));
}
