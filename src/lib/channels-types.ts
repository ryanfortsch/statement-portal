/**
 * Type definitions for the Channels module — Helm's eventual replacement
 * for Guesty. Keep these in sync with `supabase/migrations/20260507b_create_channels.sql`.
 *
 * Channels = where stays come from. iCal feeds (Airbnb / VRBO / Booking.com)
 * land bookings inbound. Direct site + manual + email-parse fill in the rest.
 */

export const BOOKING_CHANNELS = [
  'airbnb',
  'vrbo',
  'booking_com',
  'direct',
  'manual',
  'block',
  // 'guesty' marks a channel_listings row that is the Guesty per-listing
  // aggregate feed (all channels in one .ics). The sync parses each event into
  // its real channel, so a *booking* is never stored as channel='guesty'.
  'guesty',
  'other',
] as const;
export type BookingChannel = (typeof BOOKING_CHANNELS)[number];

export const BOOKING_STATUSES = [
  'inquiry',
  'pending',
  'confirmed',
  'cancelled',
  'completed',
  'block',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_MONEY_SOURCES = [
  'stripe',
  'ota_email',
  'bank_csv',
  'manual',
  'guesty_legacy',
] as const;
export type BookingMoneySource = (typeof BOOKING_MONEY_SOURCES)[number];

export const BOOKING_MONEY_CONFIDENCE = ['high', 'medium', 'low'] as const;
export type BookingMoneyConfidence = (typeof BOOKING_MONEY_CONFIDENCE)[number];

export type BookingFinance = {
  booking_id: string;
  gross_amount: number | null;
  channel_commission: number | null;
  taxes: number | null;
  cleaning_fee: number | null;
  stripe_fee: number | null;
  payout: number | null;
  rental_income: number | null;
  currency: string;
  money_source: BookingMoneySource;
  confidence: BookingMoneyConfidence;
  reconciled_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export const BOOKING_SOURCES = [
  'ical_import',
  'direct_booking',
  'manual',
  'email_parse',
  'guesty_legacy',
] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];

export type ChannelListing = {
  id: string;
  property_id: string;
  channel: BookingChannel;
  external_listing_id: string | null;
  external_listing_url: string | null;
  display_name: string | null;
  ical_import_url: string | null;
  ical_import_enabled: boolean;
  last_imported_at: string | null;
  last_import_status: string | null;       // 'success' | 'error' | null
  last_import_error: string | null;
  last_import_event_count: number | null;
  ical_export_token: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Booking = {
  id: string;
  property_id: string;
  channel_listing_id: string | null;
  channel: BookingChannel;
  source: BookingSource;
  external_booking_id: string | null;
  external_confirmation_code: string | null;
  ical_uid: string | null;
  check_in: string;
  check_out: string;
  nights: number | null;
  status: BookingStatus;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  num_guests: number | null;
  num_adults: number | null;
  num_children: number | null;
  gross_amount: number | null;
  cleaning_fee: number | null;
  service_fee: number | null;
  taxes: number | null;
  payout: number | null;
  currency: string | null;
  raw_summary: string | null;
  raw_description: string | null;
  raw_url: string | null;
  notes: string | null;
  /**
   * Set by the dedup pass in lib/ical-sync.ts. null = canonical row.
   * Non-null = this row is a duplicate of the referenced booking (same
   * physical stay from another source) and should be excluded from counts,
   * the calendar, and conflict detection.
   */
  duplicate_of: string | null;
  first_seen_at: string;
  last_seen_at: string;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type IcalSyncRun = {
  id: string;
  channel_listing_id: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  success: boolean | null;
  error_message: string | null;
  http_status: number | null;
  events_total: number;
  bookings_added: number;
  bookings_updated: number;
  bookings_cancelled: number;
  raw_response_size: number | null;
  created_at: string;
};

export const CHANNEL_LABELS: Record<BookingChannel, string> = {
  airbnb: 'Airbnb',
  vrbo: 'VRBO',
  booking_com: 'Booking.com',
  direct: 'Direct',
  manual: 'Manual',
  block: 'Block',
  guesty: 'Guesty (all channels)',
  other: 'Other',
};

export const STATUS_LABELS: Record<BookingStatus, string> = {
  inquiry: 'Inquiry',
  pending: 'Pending',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  completed: 'Completed',
  block: 'Block',
};

/** Channels we render columns for in the listings grid, in canonical order. */
export const PRIMARY_CHANNELS: BookingChannel[] = ['airbnb', 'vrbo', 'booking_com', 'direct'];

/**
 * Per-channel hint for where to find the iCal export URL inside each
 * platform's host UI. Surfaced on the listings page next to the input.
 */
export const ICAL_HINTS: Record<BookingChannel, string> = {
  airbnb: 'Listing → Calendar → Availability → Sync calendars → Export calendar.',
  vrbo: 'Listing → Calendar → Reservation manager → Import/Export → Export calendar.',
  booking_com: 'Extranet → Rates & Availability → Sync calendars → Export calendar.',
  direct: 'No external feed for direct stays — bookings land via the Helm direct-booking form.',
  manual: 'Manual entries do not have an iCal feed.',
  block: 'Owner blocks are entered in Helm; no inbound feed.',
  guesty: 'Guesty → Listing → Calendar → Export. One feed carries every channel; Helm parses each into its real channel.',
  other: 'Pick one of the supported channels.',
};
