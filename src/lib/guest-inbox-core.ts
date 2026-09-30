import type { ConversationSummary, ThreadMessage } from './stay-concierge';
import type { Booking } from './channels-types';
import { channelLabel } from './helm-inbox-core.ts';
import { localDay, validInterval } from './calderwood-workspace.ts';

export const INBOX_WINDOWS = [30, 60, 120] as const;
export const INBOX_MESSAGE_LIMIT = 200;
export type InboxWindow = typeof INBOX_WINDOWS[number];
export type InboxBooking = Pick<Booking, 'id' | 'property_id' | 'source' | 'channel' | 'external_booking_id' | 'external_confirmation_code' | 'check_in' | 'check_out' | 'status' | 'num_guests' | 'duplicate_of'>;
export type InboxProperty = { id: string; name: string; address: string | null; guesty_listing_id: string | null; former_guesty_listing_id: string | null };
export type InboxListing = { listing_id: string; property_id: string };
export type NativeInboxThread = { id: string; property_id: string | null; booking_id: string | null; channel: string; guest_name: string | null; last_preview: string | null; updated_at: string; last_guest_at: string | null; last_host_at: string | null };
export type InboxConversation = ConversationSummary & {
  source: 'guesty' | 'helm';
  booking: InboxBooking | null;
  property_id?: string | null;
  property_address?: string | null;
};
export type InboxPropertyOption = { id: string; name: string; count: number };
export type GuestInboxData = {
  conversations: InboxConversation[]; selected: InboxConversation | null; messages: ThreadMessage[];
  errors: string[]; threadError: string | null; asOf: string;
  properties: InboxPropertyOption[]; days: InboxWindow; propertyId: string;
};

export function inboxWindow(value?: string): InboxWindow {
  const days = Number(value);
  return INBOX_WINDOWS.includes(days as InboxWindow) ? days as InboxWindow : 60;
}

// Explicit provider IDs only. Names and dates never establish a property or stay match.
export function inboxListingMap(properties: InboxProperty[], listings: InboxListing[]): Map<string, string> {
  const known = new Set(properties.map(p => p.id));
  const candidates = new Map<string, Set<string>>();
  for (const row of [...listings, ...properties.flatMap(p => [p.guesty_listing_id, p.former_guesty_listing_id].filter((id): id is string => !!id).map(listing_id => ({ listing_id, property_id: p.id })))]) {
    if (!row.listing_id || !known.has(row.property_id)) continue;
    const ids = candidates.get(row.listing_id) ?? new Set<string>();
    ids.add(row.property_id);
    candidates.set(row.listing_id, ids);
  }
  return new Map([...candidates].filter(([, ids]) => ids.size === 1).map(([id, ids]) => [id, [...ids][0]]));
}

export function resolveInboxBooking(rows: InboxBooking[], propertyId: string | null, id: string, source: 'guesty' | 'helm'): InboxBooking | null {
  if (!propertyId || !id) return null;
  const scoped = rows.filter(b => b.property_id === propertyId);
  const byId = new Map(scoped.map(b => [b.id, b]));
  const candidates = scoped.filter(b => source === 'helm' ? b.id === id : b.source === 'guesty_legacy' && b.external_booking_id === id);
  const resolved = candidates.map(row => {
    const seen = new Set<string>();
    let current: InboxBooking | undefined = row;
    while (current?.duplicate_of) {
      if (seen.has(current.id)) return null;
      seen.add(current.id);
      current = byId.get(current.duplicate_of);
    }
    return current ?? null;
  });
  if (resolved.some(b => !b)) return null;
  const unique = new Map(resolved.filter((b): b is InboxBooking => !!b).map(b => [b.id, b]));
  return unique.size === 1 ? [...unique.values()][0] : null;
}

export function assembleGuestInbox(guesty: ConversationSummary[], native: NativeInboxThread[], properties: InboxProperty[], listings: InboxListing[], bookings: InboxBooking[], asOf: string): InboxConversation[] {
  const propertyMap = new Map(properties.map(p => [p.id, p]));
  const listingMap = inboxListingMap(properties, listings);
  const byBooking = new Map(bookings.map(b => [b.id, b]));
  const today = localDay(asOf);
  const rows: InboxConversation[] = guesty.filter(r => !!r.conversation_id && !r.conversation_id.startsWith('helm:')).map(r => {
    const propertyId = listingMap.get(r.listing_id) ?? null;
    const property = propertyId ? propertyMap.get(propertyId) : null;
    return { ...r, source: 'guesty', property_id: propertyId, property_name: property?.name || r.property_name || 'Property not recorded', property_address: property?.address, booking: resolveInboxBooking(bookings, propertyId, r.reservation_id, 'guesty') };
  });
  for (const t of native) {
    if (!t.id) continue;
    // A missing thread property can be recovered from its exact booking ID.
    // A conflicting property is never replaced by the booking's property.
    const propertyId = t.property_id || (t.booking_id ? byBooking.get(t.booking_id)?.property_id : null) || null;
    const property = propertyId ? propertyMap.get(propertyId) : null;
    const booking = resolveInboxBooking(bookings, propertyId, t.booking_id ?? '', 'helm');
    const activity = [t.last_guest_at, t.last_host_at].filter((v): v is string => !!v).sort().at(-1) || t.updated_at;
    rows.push({
      conversation_id: `helm:${t.id}`, reservation_id: t.booking_id ?? '', listing_id: propertyId ?? '',
      property_id: propertyId, property_name: property?.name || 'Property not recorded', property_address: property?.address,
      guest_full: t.guest_name || 'Guest name unavailable', guest_first: '',
      check_in: booking?.check_in ?? '', check_out: booking?.check_out ?? '',
      stay_status: booking && validInterval(booking.check_in, booking.check_out) ? today < booking.check_in ? 'upcoming' : today >= booking.check_out ? 'checked_out' : 'in_house' : '',
      module: '', channel: channelLabel(t.channel), last_activity_at: activity,
      last_who: t.last_guest_at && t.last_guest_at === activity ? 'guest' : t.last_host_at ? 'host' : '',
      last_preview: t.last_preview ?? '', pending_count: 0, source: 'helm', booking,
    });
  }
  // Keep distinct source threads separate, even for the same physical stay.
  // Stable sorting preserves the provider's stay order for rows with no activity.
  return [...new Map(rows.map(r => [r.conversation_id, r])).values()].sort((a, b) => (b.last_activity_at || '').localeCompare(a.last_activity_at || ''));
}

export function inboxPropertyOptions(rows: InboxConversation[]): InboxPropertyOption[] {
  const options = new Map<string, InboxPropertyOption>();
  for (const row of rows) {
    const id = row.property_id || 'unmapped';
    const option = options.get(id) ?? { id, name: id === 'unmapped' ? 'Unmatched property' : row.property_name, count: 0 };
    option.count++;
    options.set(id, option);
  }
  return [...options.values()].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
}

export function guestInboxHref({ conversation, property, days = 60 }: { conversation?: string; property?: string; days?: InboxWindow } = {}): string {
  const params = new URLSearchParams();
  if (property) params.set('property', property);
  if (days !== 60) params.set('days', String(days));
  if (conversation) params.set('conversation', conversation);
  const query = params.toString();
  return `/messaging/inbox${query ? `?${query}` : ''}`;
}

export type GuestInboxSources = {
  properties(): Promise<InboxProperty[]>;
  listings(): Promise<InboxListing[]>;
  guesty(days: InboxWindow): Promise<ConversationSummary[]>;
  native(days: InboxWindow): Promise<NativeInboxThread[]>;
  bookings(guesty: ConversationSummary[], native: NativeInboxThread[]): Promise<InboxBooking[]>;
  guestyThread(id: string): Promise<ThreadMessage[]>;
  nativeThread(id: string): Promise<ThreadMessage[]>;
};

/** Read orchestration is separate from adapters so failure and selection guards
 * can be exercised without real guest data or provider writes. */
export async function loadGuestInboxFromSources(sources: GuestInboxSources, options: { conversation?: string; property?: string; days?: string }, asOf = new Date().toISOString()): Promise<GuestInboxData> {
  const days = inboxWindow(options.days);
  const errors: string[] = [];
  const [properties, listings, guesty, native] = await Promise.allSettled([sources.properties(), sources.listings(), sources.guesty(days), sources.native(days)]);
  if (properties.status === 'rejected') errors.push('Property details unavailable. Conversations can still be reviewed.');
  if (listings.status === 'rejected') errors.push('Some Guesty property mappings are unavailable. Unmatched conversations remain in All properties.');
  if (guesty.status === 'rejected') errors.push('Guesty conversations could not load. Refresh to retry; Helm conversations are shown when available.');
  if (native.status === 'rejected') errors.push('Helm conversations could not load. Refresh to retry; Guesty conversations are shown when available.');
  const guestyRows = guesty.status === 'fulfilled' ? guesty.value : [];
  const nativeRows = native.status === 'fulfilled' ? native.value : [];
  let bookings: InboxBooking[] = [];
  try { bookings = await sources.bookings(guestyRows, nativeRows); }
  catch { errors.push('Reservation details unavailable. Message history can still be reviewed.'); }
  const all = assembleGuestInbox(guestyRows, nativeRows, properties.status === 'fulfilled' ? properties.value : [], listings.status === 'fulfilled' ? listings.value : [], bookings, asOf);
  const propertyId = options.property ?? '';
  const conversations = propertyId ? all.filter(r => (r.property_id || 'unmapped') === propertyId) : all;
  const selected = options.conversation ? conversations.find(r => r.conversation_id === options.conversation) ?? null : conversations[0] ?? null;
  let messages: ThreadMessage[] = [];
  let threadError = options.conversation && !selected ? 'This conversation is not in the selected property and date window. Clear the property filter or choose a wider window.' : null;
  // Only a member of this server-loaded, property-filtered list can trigger a
  // history read. Never pass arbitrary URL IDs directly to either source.
  if (selected) {
    try { messages = await (selected.source === 'guesty' ? sources.guestyThread(selected.conversation_id) : sources.nativeThread(selected.conversation_id.slice(5))); }
    catch { threadError = 'Message history could not load. Refresh to retry; no messages were changed.'; }
  }
  return { conversations, selected, messages, errors, threadError, asOf, properties: inboxPropertyOptions(all), days, propertyId };
}
