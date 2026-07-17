'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import {
  getPropertyRooms,
  upsertPropertyRoom,
  deletePropertyRoom,
  type PropertyRoom,
  type RoomDetails,
  type RoomType,
  ROOM_TYPES,
} from '@/lib/property-rooms';
import { setOnboardingItem, type OnboardingItemStatus } from '@/lib/onboarding-items';
import {
  parsePropertyWalkthrough,
  type WalkthroughProposal,
} from '@/lib/ai/property-walkthrough';
import { applyPropertyCaptureAction } from '@/app/properties/actions';
import type { CaptureItem } from '@/lib/property-capture-catalog';

/**
 * Server actions for the property Onboarding tab: catalog item status,
 * room CRUD, and the walkthrough dictation parse/apply. All auth-gated and
 * service-role backed (property_rooms + property_onboarding_items are
 * RLS-locked). Board-style callers pair these with softRefresh.
 */

export async function setOnboardingItemAction(args: {
  propertyId: string;
  itemKey: string;
  status: OnboardingItemStatus;
  note?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  const res = await setOnboardingItem({
    propertyId: args.propertyId,
    itemKey: args.itemKey,
    status: args.status,
    note: args.note,
    updatedByEmail: session.user.email,
  });
  if (res.ok) revalidatePath(`/properties/${args.propertyId}`);
  return res;
}

export async function saveRoomAction(args: {
  propertyId: string;
  id?: string;
  roomType: RoomType;
  name: string;
  details?: RoomDetails;
  guestSummary?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  if (!args.name.trim()) return { ok: false, error: 'Give the room a name' };
  if (!ROOM_TYPES.some((t) => t.id === args.roomType)) return { ok: false, error: 'Pick a room type' };
  const res = await upsertPropertyRoom({
    id: args.id,
    property_id: args.propertyId,
    room_type: args.roomType,
    name: args.name,
    details: args.details,
    guest_summary: args.guestSummary,
    created_by_email: session.user.email,
  });
  if (res.ok) revalidatePath(`/properties/${args.propertyId}`);
  return res;
}

export async function deleteRoomAction(args: {
  propertyId: string;
  id: string;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  const res = await deletePropertyRoom(args.id, args.propertyId);
  if (res.ok) revalidatePath(`/properties/${args.propertyId}`);
  return res;
}

export async function parseWalkthroughAction(
  propertyId: string,
  propertyName: string,
  rawText: string,
): Promise<{ ok: true; proposal: WalkthroughProposal } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  const text = rawText.trim();
  if (text.length < 10) return { ok: false, error: 'Say a bit more first.' };
  try {
    const existing = (await getPropertyRooms(propertyId)).map((r) => ({
      name: r.name,
      roomType: r.room_type,
    }));
    const proposal = await parsePropertyWalkthrough({
      rawText: text,
      propertyName,
      existingRooms: existing,
    });
    return { ok: true, proposal };
  } catch (err) {
    console.error('[parseWalkthroughAction] parse failed', { propertyId, err });
    return { ok: false, error: 'Could not process the walkthrough. Try again.' };
  }
}

/** Apply an approved walkthrough proposal: merge room items into
 *  property_rooms, then hand column + note items to the existing quick
 *  capture apply path (same guards, incl. high-stakes handling upstream
 *  at parse time). */
export async function applyWalkthroughAction(args: {
  propertyId: string;
  rooms: { name: string; roomType: RoomType }[];
  roomItems: { roomName: string; kind: 'bed' | 'tv' | 'amenity' | 'quirk' | 'note'; value: string; guestFacing: boolean }[];
  captureItems: CaptureItem[];
}): Promise<{ ok: true; rooms: number; roomFacts: number; columns: number; notes: number } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };

  const existing = await getPropertyRooms(args.propertyId);
  const byName = new Map(existing.map((r) => [r.name.toLowerCase(), r]));
  let roomsTouched = 0;
  let roomFacts = 0;

  // Collapse case-variant duplicates from the model ("Main Bath" + "main
  // bath") into one room per lowercased name, pooling their items. Without
  // this, two loop passes read the same stale DB row and the second write
  // silently erases the first (or inserts duplicate rows).
  const mergedRooms = new Map<string, { name: string; roomType: RoomType; itemNames: Set<string> }>();
  for (const room of args.rooms) {
    const key = room.name.toLowerCase();
    const entry = mergedRooms.get(key);
    if (entry) entry.itemNames.add(room.name);
    else mergedRooms.set(key, { name: room.name, roomType: room.roomType, itemNames: new Set([room.name]) });
  }

  for (const room of mergedRooms.values()) {
    const items = args.roomItems.filter((i) => room.itemNames.has(i.roomName));
    if (items.length === 0 && byName.has(room.name.toLowerCase())) continue;

    const current: PropertyRoom | undefined = byName.get(room.name.toLowerCase());
    const details: RoomDetails = {
      beds: [...(current?.details.beds ?? [])],
      tv: current?.details.tv ?? null,
      amenities: [...(current?.details.amenities ?? [])],
      quirks: [...(current?.details.quirks ?? [])],
      notes: current?.details.notes ?? null,
    };
    const guestBits: string[] = current?.guest_summary ? [current.guest_summary] : [];

    for (const item of items) {
      roomFacts += 1;
      if (item.kind === 'bed') {
        // "2x twin" style counts; default 1.
        const m = item.value.match(/^(\d+)\s*x\s*(.+)$/i);
        const size = (m ? m[2] : item.value).trim().toLowerCase();
        const count = m ? Math.max(1, parseInt(m[1], 10) || 1) : 1;
        const existingBed = details.beds!.find((b) => b.size === size);
        if (existingBed) existingBed.count = Math.max(existingBed.count, count);
        else details.beds!.push({ size, count });
      } else if (item.kind === 'tv') {
        details.tv = item.value;
      } else if (item.kind === 'amenity') {
        if (!details.amenities!.some((a) => a.toLowerCase() === item.value.toLowerCase())) {
          details.amenities!.push(item.value);
        }
      } else if (item.kind === 'quirk') {
        if (!details.quirks!.some((q) => q.toLowerCase() === item.value.toLowerCase())) {
          details.quirks!.push(item.value);
        }
        if (item.guestFacing) guestBits.push(item.value);
      } else {
        // Idempotent append: a re-apply after a partial failure must not
        // stack the same sentence twice.
        if (!details.notes || !details.notes.includes(item.value)) {
          details.notes = details.notes ? `${details.notes}\n${item.value}` : item.value;
        }
        if (item.guestFacing) guestBits.push(item.value);
      }
    }

    // Guest summary appends only bits the current summary does not already
    // carry, so re-applies never duplicate sentences.
    const currentSummary = current?.guest_summary ?? '';
    const freshBits = [...new Set(guestBits)].filter((b) => !currentSummary.includes(b));
    const guestSummary = [currentSummary, ...freshBits].filter(Boolean).join(' ') || null;

    const saved: PropertyRoom = {
      id: current?.id ?? '',
      property_id: args.propertyId,
      room_type: current?.room_type ?? room.roomType,
      name: current?.name ?? room.name,
      sort_order: current?.sort_order ?? existing.length + roomsTouched,
      details,
      guest_summary: guestSummary,
      created_by_email: current?.created_by_email ?? session.user.email,
      created_at: current?.created_at ?? '',
      updated_at: '',
    };
    const res = await upsertPropertyRoom({
      id: current?.id,
      property_id: args.propertyId,
      room_type: saved.room_type,
      name: saved.name,
      sort_order: saved.sort_order,
      details,
      guest_summary: guestSummary,
      created_by_email: session.user.email,
    });
    if (!res.ok) return { ok: false, error: res.error };
    // Keep the in-memory map current so a later loop pass (or a same-name
    // room) merges against what was just written, not the stale pre-loop row.
    byName.set(saved.name.toLowerCase(), { ...saved, id: res.id });
    roomsTouched += 1;
  }

  let columns = 0;
  let notes = 0;
  if (args.captureItems.length > 0) {
    const applied = await applyPropertyCaptureAction(args.propertyId, args.captureItems);
    if (!applied.ok) return { ok: false, error: applied.error };
    columns = applied.columns;
    notes = applied.notes;
  }

  revalidatePath(`/properties/${args.propertyId}`);
  return { ok: true, rooms: roomsTouched, roomFacts, columns, notes };
}
