import { supabaseAdmin as supabase, isServiceConfigured as isConfigured } from './supabase-admin';
import { endingsFromRows, type ContractEnding } from './forecast-contract-endings';

/**
 * The homes carrying a chance their contract ends (forecast-contract-endings.ts).
 *
 * A failed read is said, not swallowed: with no endings the forecast reads as
 * if every home stays, which is the optimistic answer, so the page prints
 * `error` beside the panel instead of passing it off as "none entered".
 */
export async function getContractEndings(): Promise<{ endings: ContractEnding[]; error: string | null }> {
  if (!isConfigured) return { endings: [], error: null };
  const { data, error } = await supabase
    .from('properties')
    .select('id, contract_end_pct, contract_end_month')
    .eq('is_active', true)
    .not('contract_end_pct', 'is', null)
    .order('id');
  if (error) {
    console.error('[forecast-contract-endings] read failed:', error.message);
    return { endings: [], error: error.message };
  }
  return { endings: endingsFromRows(data ?? []), error: null };
}
