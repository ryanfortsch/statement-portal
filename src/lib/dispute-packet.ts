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
import {
  folioLines,
  stayHintsFromDescription,
  type FolioLine,
  type StayAgreement,
  type StayReview,
} from '@/lib/dispute-packet-core';

/** A loosely typed row from a Supabase or Stripe read. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = Record<string, any>;

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
  status: string | null;
  bookedAt: string | null;
};

/** What Helm holds about the stay itself, beyond the folio and the thread. */
export type StayRecord = {
  agreement: StayAgreement | null;
  /** The home's own cancellation policy (house policy). */
  housePolicy: string | null;
  review: StayReview | null;
};

export type ThreadCoverage = {
  /** False when Guesty cut the thread off; null when the concierge did not say. */
  complete: boolean | null;
  guestyTotal: number | null;
  fromLog: number;
};

export type DisputePacketData = {
  facts: DisputeFacts;
  link: PaymentLinkRow | null;
  stay: PacketStay | null;
  /** The guest's whole thread, oldest first; null when it could not be read. */
  thread: ThreadMessage[] | null;
  /** How much of the thread that is: Guesty serves only its newest 25 posts,
   *  and the concierge fills older ones from its own record. */
  threadCoverage: ThreadCoverage | null;
  /** Agreement, policy and review for the stay; null when no stay was found. */
  record: StayRecord | null;
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
  // A charge with no metadata still names its stay in its description: a
  // Guesty Payments charge by confirmation code, a Stay Cape Ann charge by
  // its "<check-in> to <check-out>" range.
  const hints = stayHintsFromDescription(facts.description);
  const confirmationCode = (facts.metadata.confirmationCode || '').trim() || hints.confirmationCode;

  let stay: PacketStay | null = null;
  if (reservationId || confirmationCode || (hints.checkIn && hints.checkOut)) {
    const cols =
      'guesty_reservation_id, confirmation_code, guest_name, check_in, check_out, nights, channel, folio_items, total_paid, status, booked_at';
    const q = supabaseAdmin.from('guesty_reservations').select(cols).eq('property_id', propertyId);
    const { data, error } = await (reservationId
      ? q.eq('guesty_reservation_id', reservationId)
      : confirmationCode
        ? q.eq('confirmation_code', confirmationCode)
        : q.eq('check_in', hints.checkIn as string).eq('check_out', hints.checkOut as string)
    ).limit(2);
    if (error) unread.push('the reservation');
    // A date range that matches two records is not a match.
    const rows = (data ?? []) as DbRow[];
    const row = rows.length === 1 || reservationId || confirmationCode ? (rows[0] ?? null) : null;
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
        status: row.status ?? null,
        bookedAt: row.booked_at ?? null,
      };
    } else if (!error) {
      unread.push('the reservation (no synced Guesty row matches this charge)');
    }
  }

  const threadRead = stay ? await loadStayThread(stay, link) : null;
  const thread = threadRead?.messages ?? null;
  const threadCoverage = threadRead?.messages ? threadRead.coverage : null;
  if (threadRead && !threadRead.messages) unread.push(`the guest conversation (${threadRead.why})`);

  const record = stay ? await loadStayRecord(propertyId, stay, unread) : null;

  return { ok: true, data: { facts, link, stay, thread, threadCoverage, record, unread } };
}

/**
 * The signed agreement for the stay (matched by home and check-in day), the
 * home's cancellation policy and the guest's review. Each read is optional;
 * a failed one is named in `unread`.
 */
async function loadStayRecord(propertyId: string, stay: PacketStay, unread: string[]): Promise<StayRecord> {
  const [agreements, home, reviews] = await Promise.all([
    stay.checkIn
      ? supabaseAdmin
          .from('guest_agreements')
          .select('guest_signed_at, guest_signed_name, countersigned_at, cancel_cutoff_days, cancel_refund_pct, voided_at, drive_url')
          .eq('property_id', propertyId)
          .eq('stay_start', stay.checkIn)
          .order('created_at', { ascending: false })
          .limit(3)
      : Promise.resolve({ data: [], error: null }),
    supabaseAdmin.from('properties').select('cancellation_policy').eq('id', propertyId).maybeSingle(),
    supabaseAdmin
      .from('reviews')
      .select('overall_rating, review_created_at, public_review')
      .eq('reservation_id', stay.reservationId)
      .not('overall_rating', 'is', null)
      .limit(1),
  ]);
  if (agreements.error) unread.push('the rental agreement');
  if (home.error) unread.push("the home's cancellation policy");
  if (reviews.error) unread.push("the guest's review");

  // A signed, unvoided agreement wins over a draft or a voided one.
  const rows = (agreements.data ?? []) as DbRow[];
  const a = rows.find((r) => r.guest_signed_at && !r.voided_at) ?? rows[0] ?? null;
  const r = ((reviews.data ?? []) as DbRow[])[0] ?? null;
  return {
    agreement: a
      ? {
          signedAt: a.guest_signed_at ?? null,
          signedName: a.guest_signed_name ?? null,
          countersignedAt: a.countersigned_at ?? null,
          cancelCutoffDays: a.cancel_cutoff_days ?? null,
          cancelRefundPct: a.cancel_refund_pct ?? null,
          voided: !!a.voided_at,
          driveUrl: a.drive_url ?? null,
        }
      : null,
    housePolicy: ((home.data as DbRow | null)?.cancellation_policy as string | null) ?? null,
    review: r
      ? { rating: Number(r.overall_rating), at: r.review_created_at ?? null, text: r.public_review ?? null }
      : null,
  };
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
): Promise<{ messages: ThreadMessage[]; coverage: ThreadCoverage } | { messages: null; why: string }> {
  let conversationId = (link?.conversation_id || '').trim();
  if (!conversationId) {
    if (!stay.checkIn) return { messages: null, why: 'no check-in date to find it by' };
    const list = await listConversationsInRange(stay.checkIn, stay.checkIn);
    if (!list.ok) return { messages: null, why: `the conversation list failed: ${conciergeWhy(list.error)}` };
    conversationId = list.data.conversations.find((c) => c.reservation_id === stay.reservationId)?.conversation_id || '';
    if (!conversationId) return { messages: null, why: `no conversation checking in ${stay.checkIn} matches this reservation` };
  }
  const thread = await getConversationThread(conversationId, 500);
  if (!thread.ok) return { messages: null, why: `the thread read failed: ${conciergeWhy(thread.error)}` };
  return {
    messages: thread.data.messages,
    coverage: {
      complete: typeof thread.data.complete === 'boolean' ? thread.data.complete : null,
      guestyTotal: thread.data.guesty_total ?? null,
      fromLog: thread.data.from_log ?? 0,
    },
  };
}

function conciergeWhy(error: StayConciergeError): string {
  if (error.kind === 'http') return `${error.status} ${error.detail}`.trim();
  if (error.kind === 'unconfigured') return 'the messaging service is not configured';
  return `the messaging service did not answer (${error.message})`;
}
