import { notFound } from 'next/navigation';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import type { HelmPropertyRow } from '@/lib/properties';
import { getPropertyRooms } from '@/lib/property-rooms';
import {
  getOrderChecklistState,
  getProjectionReadinessCarryover,
} from '@/lib/order-checklist-db';
import {
  computeOrderChecklist,
  deriveOrderContext,
  type OrderChecklistState,
} from '@/lib/order-checklist';
import { OrderChecklistClient } from './OrderChecklistClient';

/**
 * Outfitting order checklist for a property being onboarded. Quantities
 * compute live from the walkthrough record (beds by size, bathrooms, max
 * guests) with the Fix Linens 2.5x rules on linens and towels; the "still
 * to order" list at the bottom is the actual order. Interactive counts
 * persist to property_order_checklist; the linked projection's readiness
 * walkthrough reads through as the baseline so nothing counted during the
 * prospect visit gets re-counted here.
 */

export const dynamic = 'force-dynamic';

async function getProperty(id: string): Promise<HelmPropertyRow | null> {
  const { data } = await supabase.from('properties').select('*').eq('id', id).maybeSingle();
  return (data as HelmPropertyRow | null) ?? null;
}

export default async function OrderChecklistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const p = await getProperty(id);
  if (!p) notFound();

  const [rooms, saved, carryover] = await Promise.all([
    getPropertyRooms(id),
    getOrderChecklistState(id),
    getProjectionReadinessCarryover(p.projection_id ?? null),
  ]);

  const context = deriveOrderContext({
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    hasPulloutBed: !!p.has_pullout_bed,
    bedroomRoomCount: rooms.filter((r) => r.room_type === 'bedroom').length,
    roomBeds: rooms.flatMap((r) => r.details?.beds ?? []),
  });
  const groups = computeOrderChecklist(context);

  // Merge order: projection walkthrough counts are the baseline, the
  // property's own rows win per label. Merging at read time (instead of a
  // one-shot seed write) keeps the carryover alive even after the first
  // property-side edit creates the row.
  const have: Record<string, number> = { ...carryover.have };
  // Legacy checked labels meant "they have all of it": expand against this
  // property's need counts.
  if (carryover.checkedLabels.length > 0) {
    for (const g of groups) {
      for (const it of g.items) {
        if (have[it.label] === undefined && carryover.checkedLabels.includes(it.label)) {
          have[it.label] = it.count;
        }
      }
    }
  }
  Object.assign(have, saved?.have ?? {});

  const initial: OrderChecklistState = {
    have,
    notes: saved?.notes ?? {},
    updated_at: saved?.updated_at,
  };

  return (
    <OrderChecklistClient
      propertyId={id}
      propertyName={p.name}
      groups={groups}
      context={context}
      initial={initial}
      supplyClosetLocation={p.supply_closet_location ?? null}
    />
  );
}
