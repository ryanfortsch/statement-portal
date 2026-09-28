/**
 * Quote-side tax jurisdiction for a property: the reader for
 * property_tax_config and the fallback matrix around it.
 *
 * src/lib/occupancy-tax.ts stays exactly as it is. It is the MA statement
 * authority (payout-adjacent, Dotti's owed set) and this module only READS
 * its owedOccupancyTaxRate for the one case where reading it is right: a
 * Cape Ann home that has no property_tax_config row yet. Every other region
 * with no row is refused with TaxJurisdictionUnknownError, because the only
 * alternative is silently quoting a Connecticut or Florida house at
 * Massachusetts' 11.7%.
 *
 * The matrix itself (resolveTaxRate) is pure and lives in rate-plan.ts so the
 * quote engine and this edge cannot disagree; this file adds the database
 * read and an injectable loader for the tests
 * (src/lib/__tests__/tax-config.test.ts).
 *
 * Service role: property_tax_config has RLS on with no anon policies.
 * Relative imports and no 'server-only' marker on purpose: node:test loads
 * this file, and the module is only ever imported from server code.
 */

import { supabaseAdmin, isServiceConfigured } from './supabase-admin.ts';
import {
  resolveTaxRate,
  TaxJurisdictionUnknownError,
  type ResolvedTax,
  type TaxConfigRow,
  type TaxSource,
} from './rate-plan.ts';

export { TaxJurisdictionUnknownError };
export type { TaxConfigRow, ResolvedTax, TaxSource };

export const TAX_CONFIG_COLS =
  'property_id, jurisdiction, state_rate, local_rate, cif_rate, applies_to, long_stay_exempt_over_nights, collected_by_channels, effective_from, notes, updated_by';

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** PostgREST returns numeric columns as strings; coerce once at the edge. */
export function shapeTaxConfig(raw: Record<string, unknown>): TaxConfigRow {
  const over = raw.long_stay_exempt_over_nights;
  return {
    property_id: String(raw.property_id),
    jurisdiction: String(raw.jurisdiction ?? 'MA') as TaxConfigRow['jurisdiction'],
    state_rate: num(raw.state_rate),
    local_rate: num(raw.local_rate),
    cif_rate: num(raw.cif_rate),
    applies_to: Array.isArray(raw.applies_to) ? raw.applies_to.map(String) : ['accommodation', 'cleaning'],
    long_stay_exempt_over_nights: over == null ? null : num(over),
    collected_by_channels: Array.isArray(raw.collected_by_channels) ? raw.collected_by_channels.map(String) : [],
    effective_from: raw.effective_from ? String(raw.effective_from).slice(0, 10) : undefined,
    notes: (raw.notes as string | null | undefined) ?? null,
    updated_by: (raw.updated_by as string | null | undefined) ?? null,
  };
}

/** The property's tax config row, or null when it has none (or on a failed read). */
export async function getTaxConfig(propertyId: string): Promise<TaxConfigRow | null> {
  if (!isServiceConfigured || !propertyId) return null;
  const { data, error } = await supabaseAdmin
    .from('property_tax_config')
    .select(TAX_CONFIG_COLS)
    .eq('property_id', propertyId)
    .maybeSingle();
  if (error) {
    console.error('[tax-config] read failed:', propertyId, error.message);
    return null;
  }
  return data ? shapeTaxConfig(data as Record<string, unknown>) : null;
}

export type TaxConfigLoader = (propertyId: string) => Promise<TaxConfigRow | null>;

export type QuoteTaxRate = {
  rate: number;
  exempt: boolean;
  source: TaxSource;
  reason: ResolvedTax['reason'];
  taxes_cleaning: boolean;
};

/**
 * The rate a quote should carry for this property, stay length and channel.
 *
 *   config row present            -> its rate, source 'config'
 *   no row, region cape_ann/null  -> owedOccupancyTaxRate, source 'ma_legacy'
 *   no row, any other region      -> throws TaxJurisdictionUnknownError
 *
 * `opts.loader` exists for tests and for callers that already hold the row.
 */
export async function taxRateForQuote(
  propertyId: string,
  region: string | null | undefined,
  nights: number,
  channel: string,
  opts: { loader?: TaxConfigLoader; onIso?: string } = {},
): Promise<QuoteTaxRate> {
  const load = opts.loader ?? getTaxConfig;
  const config = await load(propertyId);
  const resolved = resolveTaxRate({ config, propertyId, region, nights, channel, onIso: opts.onIso });
  return {
    rate: resolved.rate,
    exempt: resolved.exempt,
    source: resolved.source,
    reason: resolved.reason,
    taxes_cleaning: resolved.taxes_cleaning,
  };
}
