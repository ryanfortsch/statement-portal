/**
 * Service-role access to public.property_access — the RLS-locked table that
 * holds each property's sensitive entry credentials (lock / gate / garage /
 * wifi / alarm / thermostat codes).
 *
 * Why this exists: the shared `@/lib/supabase` client uses the ANON key, which
 * is shipped to browsers and (via the permissive "anyone can read properties"
 * policy) could read every column of public.properties — including the codes.
 * Migration 20260620b moved those columns into property_access, which has NO
 * anon policy, so it's only reachable through this server-side service-role
 * client (which bypasses RLS). Same pattern as src/lib/field-db.ts.
 *
 * Reads merge back onto the HelmPropertyRow shape so existing render code
 * (`p.wifi_password`, `p.smart_lock_code`, ...) keeps working unchanged.
 *
 * Server-only: never import this into a Client Component.
 */
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** The sensitive columns that live on property_access (not properties). */
export const ACCESS_COLUMNS = [
  'arrival_brief',
  'smart_lock_code',
  'gate_code',
  'garage_code',
  'key_code_location',
  'alarm_system',
  'wifi_password',
  'wifi_password_2',
  'thermostat_code',
] as const;

export type PropertyAccess = {
  /** Colleague-tone arrival + parking brief shown to the assigned inspector. */
  arrival_brief: string | null;
  smart_lock_code: string | null;
  gate_code: string | null;
  garage_code: string | null;
  key_code_location: string | null;
  alarm_system: string | null;
  wifi_password: string | null;
  wifi_password_2: string | null;
  thermostat_code: string | null;
};

export const EMPTY_ACCESS: PropertyAccess = {
  arrival_brief: null,
  smart_lock_code: null,
  gate_code: null,
  garage_code: null,
  key_code_location: null,
  alarm_system: null,
  wifi_password: null,
  wifi_password_2: null,
  thermostat_code: null,
};

const SELECT_COLS = ACCESS_COLUMNS.join(', ');

let _client: SupabaseClient | null = null;
function accessDb(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    throw new Error('property_access requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY');
  }
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

/** True when the service-role key is configured. Reads degrade to empty
 *  access (blank fields) rather than throwing when it isn't. */
export const isPropertyAccessConfigured =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Read one property's access credentials. Returns all-null on any miss
 * (no row yet, table absent on an un-migrated preview env, no service key)
 * so callers can blindly spread the result onto a property row.
 */
export async function getPropertyAccess(propertyId: string): Promise<PropertyAccess> {
  if (!propertyId || !isPropertyAccessConfigured) return { ...EMPTY_ACCESS };
  try {
    const { data, error } = await accessDb()
      .from('property_access')
      .select(SELECT_COLS)
      .eq('property_id', propertyId)
      .maybeSingle();
    if (error || !data) return { ...EMPTY_ACCESS };
    return { ...EMPTY_ACCESS, ...(data as unknown as Partial<PropertyAccess>) };
  } catch {
    return { ...EMPTY_ACCESS };
  }
}

/** Batched variant for list/packet views. Missing ids simply aren't in the map. */
export async function getPropertyAccessMap(
  propertyIds: string[],
): Promise<Map<string, PropertyAccess>> {
  const map = new Map<string, PropertyAccess>();
  const ids = [...new Set((propertyIds ?? []).filter(Boolean))];
  if (ids.length === 0 || !isPropertyAccessConfigured) return map;
  try {
    const { data, error } = await accessDb()
      .from('property_access')
      .select(`property_id, ${SELECT_COLS}`)
      .in('property_id', ids);
    if (error || !data) return map;
    for (const row of data as unknown as Array<PropertyAccess & { property_id: string }>) {
      const { property_id, ...rest } = row;
      map.set(property_id, { ...EMPTY_ACCESS, ...rest });
    }
    return map;
  } catch {
    return map;
  }
}

/**
 * Upsert a property's access credentials. Only the keys present in `access`
 * are written; omitted keys are left untouched on an existing row (so the
 * onboarding flow, which collects a subset, never clobbers gate/garage/etc.).
 * Empty strings coerce to null so a cleared form field clears the column.
 */
export async function upsertPropertyAccess(
  propertyId: string,
  access: Partial<PropertyAccess>,
): Promise<{ error: string | null }> {
  if (!propertyId) return { error: 'Missing property id' };
  const payload: Record<string, unknown> = {
    property_id: propertyId,
    updated_at: new Date().toISOString(),
  };
  for (const k of ACCESS_COLUMNS) {
    if (k in access) {
      const v = access[k];
      payload[k] = v == null || v === '' ? null : v;
    }
  }
  const { error } = await accessDb()
    .from('property_access')
    .upsert(payload, { onConflict: 'property_id' });
  return { error: error ? error.message : null };
}
