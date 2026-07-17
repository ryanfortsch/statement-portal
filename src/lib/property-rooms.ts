import 'server-only';

import { getServiceClient, isServiceConfigured } from '@/lib/supabase-admin';

/**
 * Room-by-room property records, fed by the onboarding walkthrough and hand
 * edits on the Onboarding tab. RLS-locked table (service role only) because
 * quirks and details routinely reference access context; reads and writes
 * stay server-side, same pattern as property_access.
 */

export {
  ROOM_TYPES,
  type RoomType,
  type RoomBed,
  type RoomDetails,
  type PropertyRoom,
} from '@/lib/property-rooms-shared';

import type { PropertyRoom, RoomDetails, RoomType } from '@/lib/property-rooms-shared';

export async function getPropertyRooms(propertyId: string): Promise<PropertyRoom[]> {
  if (!isServiceConfigured) return [];
  const { data, error } = await getServiceClient()
    .from('property_rooms')
    .select('*')
    .eq('property_id', propertyId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as PropertyRoom[];
}

export async function upsertPropertyRoom(room: {
  id?: string;
  property_id: string;
  room_type: RoomType;
  name: string;
  sort_order?: number;
  details?: RoomDetails;
  guest_summary?: string | null;
  created_by_email?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isServiceConfigured) return { ok: false, error: 'Service role not configured' };
  const base = {
    property_id: room.property_id,
    room_type: room.room_type,
    name: room.name.trim(),
    details: room.details ?? {},
    guest_summary: room.guest_summary?.trim() || null,
    updated_at: new Date().toISOString(),
  };
  const q = getServiceClient().from('property_rooms');
  // Updates only touch sort_order when the caller passes one, and never
  // reassign created_by_email: a typo fix must not shuffle the walkthrough
  // order to the front or erase who originally recorded the room.
  const { data, error } = room.id
    ? await q
        .update({ ...base, ...(room.sort_order != null ? { sort_order: room.sort_order } : {}) })
        .eq('id', room.id)
        .select('id')
        .single()
    : await q
        .insert({
          ...base,
          sort_order: room.sort_order ?? 0,
          ...(room.created_by_email ? { created_by_email: room.created_by_email } : {}),
        })
        .select('id')
        .single();
  if (error || !data) return { ok: false, error: error?.message || 'Room save failed' };
  return { ok: true, id: (data as { id: string }).id };
}

export async function deletePropertyRoom(id: string, propertyId: string): Promise<{ ok: boolean; error?: string }> {
  if (!isServiceConfigured) return { ok: false, error: 'Service role not configured' };
  const { error } = await getServiceClient()
    .from('property_rooms')
    .delete()
    .eq('id', id)
    .eq('property_id', propertyId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
