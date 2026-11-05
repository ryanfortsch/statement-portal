/**
 * Everything Helm already knows about a disputed charge, gathered for the
 * dispute packet (src/app/payments/disputes). Read-only: Stripe GETs through
 * dispute-stripe.ts and Supabase selects. Nothing here writes.
 *
 * The chain from a charge back to its stay:
 *   - a Helm add-on carries helm_request_key `addon:<guesty reservation id>:...`
 *     and its payment_link_requests row names the reservation, the text we
 *     sent with the link and who minted it;
 *   - a Guesty Payments stay charge carries the reservation id in metadata
 *     (`reservationId`) and the confirmation code (`confirmationCode`);
 *   - guesty_reservations holds the folio Guesty computed (`folio_items`) and
 *     what Guesty records as paid (`total_paid`).
 *
 * A cashier's check or wire is not recorded anywhere in Helm, so the packet
 * takes other payments from the person building it (the page's form) and
 * shows Guesty's total_paid beside them as a cross-check, never as a payment.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { loadPaymentLink, type PaymentLinkRow } from '@/lib/payment-links';
import { reservationIdFromRequestKey } from '@/lib/payment-links-text';
import {
  getConversationThread,
  listConversationsInRange,
  type StayConciergeError,
  type ThreadMessage,
} from '@/lib/stay-concierge';
import { loadDisputeFacts, type DisputeFacts } from '@/lib/dispute-stripe';
import { folioLines, type FolioLine } from '@/lib/dispute-packet-core';

export type PacketStay = {
  reservationId: string;
  confirmationCode: string | null;
  guestName: string | null;
  checkIn: string | null;
  checkOut: string | null;
  nights: number | null;
  channel: string | null;
  folio: FolioLine[];
  /** Guesty's own figure: includes manual payments recorded in Guesty. */
  guestyTotalPaidCents: number | null;
};

export type DisputePacketData = {
  facts: DisputeFacts;
  link: PaymentLinkRow | null;
  stay: PacketStay | null;
  /** The guest's whole thread, oldest first; null when it could not be read. */
  thread: ThreadMessage[] | null;
  /** What could not be read, for the page to say. */
  unread: string[];
};

export async function loadDisputePacket(
  propertyId: string,
  chargeId: string,
): Promise<{ ok: true; data: DisputePacketData } | { ok: false; error: string }> {
  const read = await loadDisputeFacts(propertyId, chargeId);
  if (!read.ok) return read;
  const facts = read.facts;
  const unread = [...facts.unread];

  const link = facts.requestKey ? await loadPaymentLink(facts.requestKey) : null;
  if (facts.requestKey && !link) unread.push('the payment link record');

  const reservationId =
    (link?.reservation_id || '').trim() ||
    reservationIdFromRequestKey(facts.requestKey || '') ||
    (facts.metadata.reservationId || '').trim() ||
    null;
  const confirmationCode = (facts.metadata.confirmationCode || '').trim() || null;

  let stay: PacketStay | null = null;
  if (reservationId || confirmationCode) {
    const cols = 'guesty_reservation_id, confirmation_code, guest_name, check_in, check_out, nights, channel, folio_items, total_paid';
    const q = supabaseAdmin.from('guesty_reservations').select(cols).eq('property_id', propertyId);
    const { data, error } = await (reservationId
      ? q.eq('guesty_reservation_id', reservationId)
      : q.eq('confirmation_code', confirmationCode as string)
    ).limit(1);
    if (error) unread.push('the reservation');
    const row = (data?.[0] ?? null) as Record<string, any> | null;
    if (row) {
      const paid = Number(row.total_paid);
      stay = {
        reservationId: String(row.guesty_reservation_id),
        confirmationCode: row.confirmation_code ?? null,
        guestName: row.guest_name ?? null,
        checkIn: row.check_in ?? null,
        checkOut: row.check_out ?? null,
        nights: row.nights ?? null,
        channel: row.channel ?? null,
        folio: folioLines(row.folio_items),
        guestyTotalPaidCents: Number.isFinite(paid) && row.total_paid !== null ? Math.round(paid * 100) : null,
      };
    } else if (!error) {
      unread.push('the reservation (no synced Guesty row matches this charge)');
    }
  }

  const threadRead = stay ? await loadStayThread(stay, link) : null;
  const thread = threadRead?.messages ?? null;
  if (threadRead && !threadRead.messages) unread.push(`the guest conversation (${threadRead.why})`);

  return { ok: true, data: { facts, link, stay, thread, unread } };
}

/**
 * The guest's conversation, fetched live through stay-concierge (Guesty-run
 * homes keep no thread in Helm). A Helm-minted link names its conversation;
 * otherwise the stay is found among the conversations checking in that day.
 * When it cannot be read, `why` says which step failed, so the packet names
 * the cause instead of a bare "could not read".
 */
async function loadStayThread(
  stay: PacketStay,
  link: PaymentLinkRow | null,
): Promise<{ messages: ThreadMessage[]; why?: never } | { messages: null; why: string }> {
  let conversationId = (link?.conversation_id || '').trim();
  if (!conversationId) {
    if (!stay.checkIn) return { messages: null, why: 'no check-in date to find it by' };
    const list = await listConversationsInRange(stay.checkIn, stay.checkIn);
    if (!list.ok) return { messages: null, why: `the conversation list failed: ${conciergeWhy(list.error)}` };
    conversationId = list.data.conversations.find((c) => c.reservation_id === stay.reservationId)?.conversation_id || '';
    if (!conversationId) return { messages: null, why: `no conversation checking in ${stay.checkIn} matches this reservation` };
  }
  const thread = await getConversationThread(conversationId, 500);
  return thread.ok
    ? { messages: thread.data.messages }
    : { messages: null, why: `the thread read failed: ${conciergeWhy(thread.error)}` };
}

function conciergeWhy(error: StayConciergeError): string {
  if (error.kind === 'http') return `${error.status} ${error.detail}`.trim();
  if (error.kind === 'unconfigured') return 'the messaging service is not configured';
  return `the messaging service did not answer (${error.message})`;
}
