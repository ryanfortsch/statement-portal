import 'server-only';
import { supabaseAdmin as sb, isServiceConfigured } from './supabase-admin';
import { selectAllPaged } from './paged-select';
import { listConversations, getConversationThread } from './stay-concierge';
import { toThreadMessage, type MessageLike } from './helm-inbox-core';
import { INBOX_MESSAGE_LIMIT, loadGuestInboxFromSources, type GuestInboxSources, type InboxBooking, type InboxListing, type InboxProperty, type NativeInboxThread } from './guest-inbox-core';

const bookingColumns = 'id,property_id,source,channel,external_booking_id,external_confirmation_code,check_in,check_out,status,num_guests,duplicate_of';
function requireDatabase() { if (!isServiceConfigured) throw new Error('Database unavailable'); }

async function bookingsBy(field: 'id' | 'external_booking_id', ids: string[]): Promise<InboxBooking[]> {
  const rows: InboxBooking[] = [];
  const unique = [...new Set(ids.filter(Boolean))];
  for (let offset = 0; offset < unique.length; offset += 100) {
    const batch = unique.slice(offset, offset + 100);
    rows.push(...await selectAllPaged<InboxBooking>((from, to) => {
      let query = sb.from('bookings').select(bookingColumns).in(field, batch);
      if (field === 'external_booking_id') query = query.eq('source', 'guesty_legacy');
      return query.order('id').range(from, to);
    }, { pageSize: 500, maxRows: 10000 }));
  }
  return rows;
}

// Dedicated read adapter: no imports from send/actions, automation planners,
// mark-read handlers or the calendar authority writers.
const sources: GuestInboxSources = {
  async properties() {
    requireDatabase();
    return selectAllPaged<InboxProperty>((from, to) => sb.from('properties').select('id,name,address,guesty_listing_id,former_guesty_listing_id').order('id').range(from, to));
  },
  async listings() {
    requireDatabase();
    return selectAllPaged<InboxListing>((from, to) => sb.from('guesty_listings').select('listing_id,property_id').order('listing_id').range(from, to));
  },
  async guesty(days) {
    const response = await listConversations(days);
    if (!response.ok) throw new Error('Guesty list unavailable');
    return response.data.conversations;
  },
  async native(days) {
    requireDatabase();
    const since = new Date(Date.now() - days * 86400000).toISOString();
    return selectAllPaged<NativeInboxThread>((from, to) => sb.from('guest_threads')
      .select('id,property_id,booking_id,channel,guest_name,last_preview,updated_at,last_guest_at,last_host_at')
      .neq('status', 'archived').gte('updated_at', since).order('updated_at', { ascending: false }).order('id').range(from, to), { pageSize: 500, maxRows: 5000 });
  },
  async bookings(guesty, native) {
    if (!guesty.length && !native.length) return [];
    requireDatabase();
    const [external, internal] = await Promise.all([
      bookingsBy('external_booking_id', guesty.map(r => r.reservation_id)),
      bookingsBy('id', native.map(r => r.booking_id ?? '')),
    ]);
    const rows = new Map([...external, ...internal].map(b => [b.id, b]));
    const attempted = new Set(rows.keys());
    // Bounded alias traversal. Cycles, missing targets and cross-property
    // aliases remain unmatched in the pure resolver, never guessed.
    for (let depth = 0; depth < 20; depth++) {
      const missing = [...new Set([...rows.values()].map(b => b.duplicate_of).filter((id): id is string => !!id && !attempted.has(id)))];
      if (!missing.length) break;
      missing.forEach(id => attempted.add(id));
      for (const b of await bookingsBy('id', missing)) rows.set(b.id, b);
    }
    return [...rows.values()];
  },
  async guestyThread(id) {
    const response = await getConversationThread(id, INBOX_MESSAGE_LIMIT);
    if (!response.ok) throw new Error('Guesty history unavailable');
    return response.data.messages;
  },
  async nativeThread(id) {
    requireDatabase();
    const result = await sb.from('guest_messages')
      .select('id,thread_id,direction,sender_kind,sender_label,body,sent_at,external_message_id,provider,delivery_status,raw')
      .eq('thread_id', id).order('sent_at', { ascending: false }).order('id', { ascending: false }).limit(INBOX_MESSAGE_LIMIT);
    if (result.error) throw new Error('Helm history unavailable');
    return ((result.data ?? []) as MessageLike[]).reverse().map(toThreadMessage);
  },
};

export function loadGuestInbox(options: { conversation?: string; property?: string; days?: string }) {
  return loadGuestInboxFromSources(sources, options);
}
