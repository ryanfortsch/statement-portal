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
