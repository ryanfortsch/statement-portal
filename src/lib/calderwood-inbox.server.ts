import 'server-only';
import { supabaseAdmin as sb, isServiceConfigured } from './supabase-admin';
import { selectAllPaged } from './paged-select';
import { listConversations, getConversationThread, type ConversationSummary, type ThreadMessage } from './stay-concierge';
import { CALDERWOOD_ID, localDay } from './calderwood-workspace';
import { loadCalderwoodWorkspace } from './calderwood-workspace.server';
import { resolvePilotBooking, scopeGuestyConversations, selectPilotConversation, type PilotConversation } from './calderwood-inbox-core';

type NativeThread = { id: string; booking_id: string | null; channel: string; guest_name: string | null; last_preview: string | null; updated_at: string };
export async function loadPilotInbox(conversationId?: string, bookingId?: string) {
  const errors: string[] = [];
  const asOf = new Date().toISOString();
  const since = new Date(Date.now() - 60 * 86400000).toISOString();
  if (!isServiceConfigured) return { conversations: [] as PilotConversation[], selected: null, messages: [] as ThreadMessage[], errors: ['Database unavailable. Property scope cannot be verified.'], threadError: null, asOf };
  const [workspaceResult, mapping, concierge, native] = await Promise.allSettled([
    loadCalderwoodWorkspace(),
    sb.from('properties').select('guesty_listing_id,former_guesty_listing_id').eq('id', CALDERWOOD_ID).single().then(r => { if (r.error) throw new Error(); return r.data; }),
    listConversations(60),
    selectAllPaged<NativeThread>((from, to) => sb.from('guest_threads').select('id,booking_id,channel,guest_name,last_preview,updated_at').eq('property_id', CALDERWOOD_ID).neq('status', 'archived').gte('updated_at', since).order('updated_at', { ascending: false }).order('id').range(from, to), { maxRows: 5000 }),
  ]);
  const workspace = workspaceResult.status === 'fulfilled' ? workspaceResult.value : null;
  const bookings = workspace?.bookings ?? [];
  if (!workspace || workspace.sources.bookings) errors.push('Reservation details unavailable; conversation history can still be reviewed.');
  let conversations: PilotConversation[] = [];
  if (mapping.status === 'rejected') errors.push('Guesty property mapping unavailable; Guesty conversations are hidden.');
  if (concierge.status === 'rejected' || !concierge.value.ok) errors.push('Guesty conversation service unavailable. Retry by refreshing.');
  else if (mapping.status === 'fulfilled') conversations = scopeGuestyConversations(concierge.value.data.conversations, [mapping.value.guesty_listing_id, mapping.value.former_guesty_listing_id].filter((id): id is string => typeof id === 'string' && !!id), bookings);
  if (native.status === 'rejected') errors.push('Helm conversations unavailable. Retry by refreshing.');
  else for (const t of native.value) {
    const booking = resolvePilotBooking(bookings, t.booking_id ?? '', 'helm');
    const today = localDay(asOf);
    const row: ConversationSummary = { conversation_id: `helm:${t.id}`, reservation_id: t.booking_id ?? '', listing_id: CALDERWOOD_ID, property_name: '65 Calderwood', guest_full: t.guest_name ?? 'Guest name unavailable', guest_first: '', check_in: booking?.check_in ?? '', check_out: booking?.check_out ?? '', stay_status: booking ? today < booking.check_in ? 'upcoming' : today >= booking.check_out ? 'checked_out' : 'in_house' : '', module: '', channel: t.channel, last_activity_at: t.updated_at, last_who: '', last_preview: t.last_preview ?? '', pending_count: 0 };
    conversations.push({ ...row, source: 'helm', booking });
  }
  conversations.sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at) || a.conversation_id.localeCompare(b.conversation_id));
  // Only a server-scoped list member may trigger a thread read. URL IDs never select arbitrary threads.
  const selected = selectPilotConversation(conversations, conversationId, bookingId);
  let messages: ThreadMessage[] = [];
  let threadError: string | null = null;
  if (conversationId && !selected) threadError = 'This conversation is not in the current Calderwood list.';
  if (selected) {
    try {
      if (selected.source === 'guesty') {
        const response = await getConversationThread(selected.conversation_id, 200);
        if (!response.ok) throw new Error();
        messages = response.data.messages;
      } else {
        const result = await sb.from('guest_messages').select('id,body,sent_at,direction,sender_label,sender_kind').eq('thread_id', selected.conversation_id.slice(5)).order('sent_at', { ascending: false }).order('id', { ascending: false }).limit(200);
        if (result.error) throw new Error();
        messages = (result.data ?? []).reverse().map(m => ({ id: m.id, body: m.body, at: m.sent_at, who: m.direction === 'inbound' ? 'guest' : 'host', via: '', sender_name: m.sender_label || (m.sender_kind === 'automation' ? 'Helm automation' : m.sender_kind === 'ota_notice' ? 'Channel notice' : '') }));
      }
    } catch { threadError = 'Message history could not be loaded. Refresh to retry; no messages were changed.'; }
  }
  return { conversations, selected, messages, errors, threadError, asOf };
}
