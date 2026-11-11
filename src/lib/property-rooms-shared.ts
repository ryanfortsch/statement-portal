/**
 * Client-safe half of the property-rooms model: room types + row shapes.
 * No server imports, so client components (RoomsEditor, WalkthroughCapture)
 * can use the labels and types without pulling the service-role client into
 * the bundle. The server-side CRUD lives in src/lib/property-rooms.ts.
 */

export type RoomType =
  | 'bedroom' | 'bathroom' | 'kitchen' | 'living' | 'dining' | 'laundry'
  | 'office' | 'basement' | 'garage' | 'outdoor' | 'entry' | 'storage' | 'other';

export const ROOM_TYPES: { id: RoomType; label: string }[] = [
  { id: 'bedroom', label: 'Bedroom' },
  { id: 'bathroom', label: 'Bathroom' },
  { id: 'kitchen', label: 'Kitchen' },
  { id: 'living', label: 'Living' },
  { id: 'dining', label: 'Dining' },
  { id: 'laundry', label: 'Laundry' },
  { id: 'office', label: 'Office' },
  { id: 'basement', label: 'Basement' },
  { id: 'garage', label: 'Garage' },
  { id: 'outdoor', label: 'Outdoor' },
  { id: 'entry', label: 'Entry' },
  { id: 'storage', label: 'Storage' },
  { id: 'other', label: 'Other' },
];

export type RoomBed = { size: string; count: number };

export type RoomDetails = {
  beds?: RoomBed[];
  tv?: string | null;
  /** The TV's remote and the batteries it takes, e.g. "Samsung remote, 2 AAA". */
  tv_remote?: string | null;
  /** Where this room's sofa-bed sheets are kept, when it has one. */
  sofa_linens?: string | null;
  amenities?: string[];
  quirks?: string[];
  notes?: string | null;
};

export type PropertyRoom = {
  id: string;
  property_id: string;
  room_type: RoomType;
  name: string;
  sort_order: number;
  details: RoomDetails;
  guest_summary: string | null;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
};

/** A bed size that is a pullout: sofa bed, sleeper, pull-out couch, futon. */
export const SOFA_BED_RE = /sofa|sleeper|pull[\s-]?out|futon|couch/i;

/** The room's pullout beds, as written ("full sofa bed"), empty when none. */
export function roomSofaBeds(room: Pick<PropertyRoom, 'details'>): string[] {
  return (room.details?.beds ?? []).filter((b) => SOFA_BED_RE.test(b.size ?? '')).map((b) => (b.count > 1 ? `${b.count}x ${b.size}` : b.size));
}

/** One line per TV across the rooms, in room order: "Living room: 55in Samsung · remote 2 AAA". */
export function tvLines(rooms: ReadonlyArray<Pick<PropertyRoom, 'name' | 'details'>>): string[] {
  return rooms
    .filter((r) => (r.details?.tv ?? '').trim())
    .map((r) => {
      const remote = (r.details?.tv_remote ?? '').trim();
      return `${r.name}: ${(r.details.tv ?? '').trim()}${remote ? ` · remote: ${remote}` : ''}`;
    });
}
