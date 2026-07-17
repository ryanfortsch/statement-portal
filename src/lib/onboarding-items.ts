import 'server-only';

import { getServiceClient, isServiceConfigured } from '@/lib/supabase-admin';

/**
 * Per-property status rows for the onboarding catalog (the catalog itself is
 * code: src/lib/onboarding-catalog.ts). Only operator-touched items get a
 * row; auto-derived items compute live and need none. RLS-locked table,
 * service-role only.
 */

export type OnboardingItemStatus = 'todo' | 'done' | 'n_a';

export type OnboardingItemRow = {
  id: string;
  property_id: string;
  item_key: string;
  status: OnboardingItemStatus;
  note: string | null;
  updated_by_email: string | null;
  updated_at: string;
};

export async function getOnboardingItemRows(propertyId: string): Promise<Map<string, OnboardingItemRow>> {
  if (!isServiceConfigured) return new Map();
  const { data, error } = await getServiceClient()
    .from('property_onboarding_items')
    .select('*')
    .eq('property_id', propertyId);
  if (error) throw error;
  return new Map(((data ?? []) as OnboardingItemRow[]).map((r) => [r.item_key, r]));
}

export async function setOnboardingItem(args: {
  propertyId: string;
  itemKey: string;
  status: OnboardingItemStatus;
  note?: string | null;
  updatedByEmail?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isServiceConfigured) return { ok: false, error: 'Service role not configured' };
  // note is three-state: undefined = leave any existing note alone,
  // null/empty = clear it, string = set it. A plain status toggle omits it
  // and must not wipe an operator's note.
  const payload: Record<string, unknown> = {
    property_id: args.propertyId,
    item_key: args.itemKey,
    status: args.status,
    updated_by_email: args.updatedByEmail ?? null,
    updated_at: new Date().toISOString(),
  };
  if (args.note !== undefined) payload.note = args.note?.trim() || null;
  const { error } = await getServiceClient()
    .from('property_onboarding_items')
    .upsert(payload, { onConflict: 'property_id,item_key' });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
