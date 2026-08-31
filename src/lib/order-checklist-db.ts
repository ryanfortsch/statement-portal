import 'server-only';

import { getServiceClient, isServiceConfigured } from '@/lib/supabase-admin';
import type { OrderChecklistState } from '@/lib/order-checklist';
import type { ReadinessState } from '@/lib/projections-types';

/**
 * Persistence for the property outfitting order checklist. One row per
 * property, one jsonb blob (label-keyed have counts + notes), mirroring
 * how projections.readiness_state works so the two tools feel identical.
 * RLS-locked table, service-role only, same posture as
 * property_onboarding_items.
 */

export async function getOrderChecklistState(
  propertyId: string,
): Promise<OrderChecklistState | null> {
  if (!isServiceConfigured) return null;
  const { data, error } = await getServiceClient()
    .from('property_order_checklist')
    .select('state')
    .eq('property_id', propertyId)
    .maybeSingle();
  if (error) throw error;
  return (data?.state as OrderChecklistState | null) ?? null;
}

/** Cheap existence probe for the onboarding catalog derive: has anyone
 *  touched this property's order checklist yet? */
export async function hasOrderChecklistState(propertyId: string): Promise<boolean> {
  if (!isServiceConfigured) return false;
  const { count, error } = await getServiceClient()
    .from('property_order_checklist')
    .select('property_id', { count: 'exact', head: true })
    .eq('property_id', propertyId);
  if (error) return false;
  return (count ?? 0) > 0;
}

/**
 * The projection walkthrough's have counts, for carryover. Readiness state
 * used to die on the projection at promote (the old
 * inventory.readiness_carryover chore existed to re-type it by hand); the
 * order checklist instead reads it through as the baseline. Legacy
 * `checked` labels are returned separately because "checked" meant "they
 * have all of it" and the need count to expand against belongs to the
 * caller.
 */
export async function getProjectionReadinessCarryover(
  projectionId: string | null,
): Promise<{ have: Record<string, number>; checkedLabels: string[] }> {
  const empty = { have: {}, checkedLabels: [] };
  if (!projectionId || !isServiceConfigured) return empty;
  const { data, error } = await getServiceClient()
    .from('projections')
    .select('readiness_state')
    .eq('id', projectionId)
    .maybeSingle();
  if (error || !data?.readiness_state) return empty;
  const state = data.readiness_state as ReadinessState;
  return {
    have: state.have && typeof state.have === 'object' ? state.have : {},
    checkedLabels: Array.isArray(state.checked) ? state.checked : [],
  };
}

async function writeState(
  propertyId: string,
  state: OrderChecklistState,
  updatedByEmail: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (!isServiceConfigured) return { ok: false, error: 'Service role not configured' };
  const { error } = await getServiceClient()
    .from('property_order_checklist')
    .upsert(
      {
        property_id: propertyId,
        state: { ...state, updated_at: new Date().toISOString() },
        updated_by_email: updatedByEmail,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'property_id' },
    );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function setOrderHave(args: {
  propertyId: string;
  itemLabel: string;
  count: number;
  updatedByEmail: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const safeCount = Math.max(0, Math.round(Number(args.count) || 0));
  const state = (await getOrderChecklistState(args.propertyId)) ?? {};
  const have = { ...(state.have ?? {}) };
  have[args.itemLabel] = safeCount;
  return writeState(args.propertyId, { ...state, have }, args.updatedByEmail);
}

export async function setOrderNote(args: {
  propertyId: string;
  noteKey: string;
  value: string;
  updatedByEmail: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const state = (await getOrderChecklistState(args.propertyId)) ?? {};
  const notes = { ...(state.notes ?? {}) };
  if (args.value.trim() === '') delete notes[args.noteKey];
  else notes[args.noteKey] = args.value;
  return writeState(args.propertyId, { ...state, notes }, args.updatedByEmail);
}
