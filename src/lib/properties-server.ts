import 'server-only';

import { PROPERTIES, type Property } from './properties';
import { supabaseAdmin as supabase, isServiceConfigured as isConfigured } from './supabase-admin';

/**
 * DB-backed source of truth for the Statements module. Returns every
 * active property in the Helm-native `public.properties` table, shaped
 * as the legacy `Property` type so existing call sites (ingest /
 * upload / render) can switch over without changing their downstream
 * code.
 *
 * Before this existed, the Statements module read from the hardcoded
 * PROPERTIES const above. New properties added via the Prospects flow
 * silently failed to appear in the next monthly statement cycle until
 * an engineer hand-edited the const and shipped a code change.
 *
 * Now: promote a prospect in Helm, and the next monthly upload sees
 * the new property automatically.
 */
export async function getActivePropertiesForStatements(): Promise<Property[]> {
  // owner_full/owner_greeting/owner_emails/bank_last4/tax_cert_id are PII +
  // financial data -- service role, not the anon key.
  if (!isConfigured) return Object.values(PROPERTIES);
  const { data, error } = await supabase
    .from('properties')
    .select('id, name, address, city, owner_last, owner_full, owner_greeting, owner_emails, management_fee_pct, bank_last4, listing_match, tax_cert_id, is_rising_tide_owned, is_active')
    .eq('is_active', true)
    .order('name');
  if (error || !data) return Object.values(PROPERTIES);
  return (data as Array<{
    id: string;
    name: string;
    address: string;
    city: string;
    owner_last: string | null;
    owner_full: string | null;
    owner_greeting: string | null;
    owner_emails: string[] | null;
    management_fee_pct: number | null;
    bank_last4: string | null;
    listing_match: string | null;
    tax_cert_id: string | null;
    is_rising_tide_owned: boolean | null;
  }>).map((r) => ({
    id: r.id,
    name: r.name,
    address: r.address,
    city: r.city,
    owner_last: r.owner_last ?? '',
    owner_full: r.owner_full ?? '',
    owner_greeting: r.owner_greeting ?? '',
    owner_emails: r.owner_emails ?? [],
    fee_pct: Number(r.management_fee_pct ?? 0),
    bank_last4: r.bank_last4,
    listing_match: (r.listing_match ?? '').toLowerCase(),
    tax_cert_id: r.tax_cert_id,
    is_rising_tide_owned: !!r.is_rising_tide_owned,
  }));
}

/** Single-property DB lookup with the same legacy Property shape.
 *  Used by the statement renderer to hydrate `property_id → Property`
 *  without pulling every active row. */
export async function getActivePropertyForStatements(id: string): Promise<Property | null> {
  if (!isConfigured) return PROPERTIES[id] ?? null;
  const { data, error } = await supabase
    .from('properties')
    .select('id, name, address, city, owner_last, owner_full, owner_greeting, owner_emails, management_fee_pct, bank_last4, listing_match, tax_cert_id, is_rising_tide_owned')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return PROPERTIES[id] ?? null;
  const r = data as {
    id: string; name: string; address: string; city: string;
    owner_last: string | null; owner_full: string | null;
    owner_greeting: string | null; owner_emails: string[] | null;
    management_fee_pct: number | null; bank_last4: string | null;
    listing_match: string | null; tax_cert_id: string | null;
    is_rising_tide_owned: boolean | null;
  };
  return {
    id: r.id,
    name: r.name,
    address: r.address,
    city: r.city,
    owner_last: r.owner_last ?? '',
    owner_full: r.owner_full ?? '',
    owner_greeting: r.owner_greeting ?? '',
    owner_emails: r.owner_emails ?? [],
    fee_pct: Number(r.management_fee_pct ?? 0),
    bank_last4: r.bank_last4,
    listing_match: (r.listing_match ?? '').toLowerCase(),
    tax_cert_id: r.tax_cert_id,
    is_rising_tide_owned: !!r.is_rising_tide_owned,
  };
}

