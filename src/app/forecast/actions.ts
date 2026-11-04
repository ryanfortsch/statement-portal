'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { requireOwnerEmail } from '@/lib/helm-access-server';
import { parseEnding } from '@/lib/forecast-contract-endings';

/**
 * Set or clear the chance a home's management contract ends, and the first
 * month it would be gone (forecast-contract-endings.ts). A blank or 0 chance
 * clears it. Owners only: the forecast is an owner page, and a server action
 * posts to whatever page rendered it.
 */
export async function saveContractEnding(
  propertyId: string,
  pctRaw: string | number | null,
  monthRaw: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireOwnerEmail();
  } catch {
    return { ok: false, error: 'Owners only' };
  }
  const parsed = parseEnding(pctRaw, monthRaw);
  if (!parsed.ok) return parsed;
  const { data, error } = await supabase
    .from('properties')
    .update({
      contract_end_pct: parsed.pct,
      contract_end_month: parsed.month,
      updated_at: new Date().toISOString(),
    })
    .eq('id', propertyId)
    .select('id')
    .maybeSingle();
  if (error) {
    // 42703: the columns are not there yet.
    if (error.code === '42703') return { ok: false, error: 'Ask Ryan: contract endings are not set up in the database yet. Nothing was saved.' };
    return { ok: false, error: error.message };
  }
  if (!data) return { ok: false, error: 'Property not found. Nothing was saved.' };
  revalidatePath('/forecast');
  return { ok: true };
}
