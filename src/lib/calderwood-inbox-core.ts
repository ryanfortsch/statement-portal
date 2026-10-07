import type { ConversationSummary } from './stay-concierge';
import { CALDERWOOD_ID, type WorkspaceBooking } from './calderwood-workspace.ts';

export type PilotConversation = ConversationSummary & { source: 'guesty' | 'helm'; booking: WorkspaceBooking | null };
export function resolvePilotBooking(rows: WorkspaceBooking[], id: string, source: 'guesty' | 'helm'): WorkspaceBooking | null {
  if (!id) return null;
  const scoped = rows.filter(r => r.property_id === CALDERWOOD_ID);
  const candidates = scoped.filter(r => source === 'helm' ? r.id === id : r.source === 'guesty_legacy' && r.external_booking_id === id);
  const resolved = candidates.map(row => {
    const seen = new Set<string>();
    let current: WorkspaceBooking | undefined = row;
    while (current?.duplicate_of) {
      if (seen.has(current.id)) return null;
      seen.add(current.id);
      current = scoped.find(r => r.id === current!.duplicate_of);
    }
    return current ?? null;
  });
  if (resolved.some(r => !r)) return null;
  const unique = [...new Map(resolved.filter((r): r is WorkspaceBooking => !!r).map(r => [r.id, r])).values()];
  return unique.length === 1 ? unique[0] : null;
}
export function scopeGuestyConversations(rows: ConversationSummary[], listingIds: string[], bookings: WorkspaceBooking[]): PilotConversation[] {
  const allowed = new Set(listingIds.filter(Boolean));
  return rows.filter(r => !!r.conversation_id && !r.conversation_id.startsWith('helm:') && allowed.has(r.listing_id)).map(r => ({ ...r, source: 'guesty', booking: resolvePilotBooking(bookings, r.reservation_id, 'guesty') }));
}
export function selectPilotConversation(rows: PilotConversation[], conversationId?: string, bookingId?: string): PilotConversation | null {
  const candidates = bookingId ? rows.filter(r => r.booking?.id === bookingId) : rows;
  return conversationId ? candidates.find(r => r.conversation_id === conversationId) ?? null : candidates[0] ?? null;
}
