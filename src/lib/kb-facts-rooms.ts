/**
 * The guest-safe view of a home's rooms, for /api/kb-facts (2026-11-10).
 *
 * The guest AI answered "is there a trick to the heat?" and "which TV
 * remote?" without ever seeing the property page: kb-facts sent 10 of the
 * Facts tab's 52 fields and no rooms at all. At 4 Middle it told a guest in
 * late October to set every unit to COOL, and at 17 Beach it placed the
 * mini-splits "in the bedrooms" from listing photos (they are all through
 * the house). This is the rooms half of that fix; the house-systems columns
 * are read in the route itself.
 *
 * property_rooms is RLS-locked because `quirks` and `notes` routinely carry
 * access context (a lockbox, a door that needs a code). Those two never
 * leave Helm: this shape names what may, field by field, so a key added to
 * RoomDetails later is not sent until someone adds it here.
 *
 * Pure, so `npm test` pins it.
 */
import { roomSofaBeds, type PropertyRoom } from './property-rooms-shared.ts';

export type GuestRoomFact = {
  name: string;
  room_type: string;
  /** "1x queen", "2x twin", as written on the room. */
  beds: string[];
  /** The room's pullout beds, a subset of beds ("full sofa bed"). */
  sofa_beds: string[];
  /** Where this room's sofa-bed sheets are kept. */
  sofa_linens: string;
  tv: string;
  /** The TV's remote and the batteries it takes. */
  tv_remote: string;
  amenities: string[];
  /** The one line a guest could be told about this room. */
  guest_summary: string;
};

type RoomInput = Pick<PropertyRoom, 'name' | 'room_type' | 'details' | 'guest_summary'>;

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function guestRoomFact(room: RoomInput): GuestRoomFact {
  const d = room.details ?? {};
  const beds = (Array.isArray(d.beds) ? d.beds : [])
    .filter((b) => clean(b?.size))
    .map((b) => `${Number(b.count) > 0 ? b.count : 1}x ${clean(b.size)}`);
  return {
    name: clean(room.name),
    room_type: clean(room.room_type),
    beds,
    sofa_beds: roomSofaBeds(room),
    sofa_linens: clean(d.sofa_linens),
    tv: clean(d.tv),
    tv_remote: clean(d.tv_remote),
    amenities: (Array.isArray(d.amenities) ? d.amenities : []).map(clean).filter(Boolean),
    guest_summary: clean(room.guest_summary),
  };
}

/** A room with nothing a guest could be told is left out, not sent empty. */
export function hasGuestFacts(r: GuestRoomFact): boolean {
  return Boolean(r.beds.length || r.sofa_linens || r.tv || r.tv_remote || r.amenities.length || r.guest_summary);
}

export function guestRoomFacts(rooms: ReadonlyArray<RoomInput>): GuestRoomFact[] {
  return rooms.map(guestRoomFact).filter((r) => r.name && hasGuestFacts(r));
}
