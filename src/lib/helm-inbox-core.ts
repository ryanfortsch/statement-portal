/**
 * Pure rules behind the Helm-native guest inbox (guest_threads +
 * guest_messages): how a thread is keyed, which stay a texting guest belongs
 * to, and how a Helm thread is shaped into the concierge wire types
 * (ConversationSummary, ThreadMessage, ReservationPick) so Conversations.tsx,
 * Thread.tsx and StayPicker render it unchanged. No IO here; the database
 * edge is src/lib/helm-inbox.ts.
 *
 * Tested by src/lib/__tests__/helm-inbox-core.test.ts.
 */
import type { ConversationSummary, ThreadMessage, ReservationPick } from './stay-concierge.ts';
import { normalizeEmail, toE164Phone } from './guests-identity-core.ts';

export const THREAD_CHANNELS = ['sms', 'email', 'airbnb', 'vrbo', 'booking_com', 'direct'] as const;
export type ThreadChannel = (typeof THREAD_CHANNELS)[number];

export const SENDER_KINDS = ['guest', 'host_human', 'host_ai', 'automation', 'ota_notice'] as const;
export type SenderKind = (typeof SENDER_KINDS)[number];

export type ThreadStatus = 'open' | 'snoozed' | 'done' | 'archived';

/** The conversation_id prefix that routes a row to the Helm inbox instead of
 * the concierge. thread-actions.ts branches on it. */
export const HELM_CONVERSATION_PREFIX = 'helm:';

/** How far around today a stay may sit and still claim a texting guest. */
export const CONTACT_WINDOW_BEFORE_DAYS = 14;
export const CONTACT_WINDOW_AFTER_DAYS = 60;

/** The module string that lets the existing canSend gate show the composer.
 * Empty means "no rail Helm can send on" and the composer stays hidden. */
export const HELM_SMS_MODULE = 'helm_sms';

// ── Keys ────────────────────────────────────────────────────────────

export function helmConversationId(threadId: string): string {
  return `${HELM_CONVERSATION_PREFIX}${threadId}`;
}

export function isHelmConversationId(conversationId: string | null | undefined): boolean {
  return !!conversationId && conversationId.startsWith(HELM_CONVERSATION_PREFIX);
}

/** The thread id behind a 'helm:<uuid>' conversation id, or null. */
export function helmThreadIdOf(conversationId: string | null | undefined): string | null {
  if (!isHelmConversationId(conversationId)) return null;
  const id = (conversationId as string).slice(HELM_CONVERSATION_PREFIX.length).trim();
  return id || null;
}

/**
 * The external_thread_key for a channel: E.164 for sms, lower(trim) address
 * for email, the trimmed confirmation code for OTA channels. Null when the
 * raw value cannot be a key for that channel (a 7-digit "phone", a bare
 * word for an email), so the caller never files a thread under garbage.
 */
export function normalizeThreadKey(channel: ThreadChannel, raw: string | null | undefined): string | null {
  switch (channel) {
    case 'sms':
      return toE164Phone(raw);
    case 'email':
      return normalizeEmail(raw);
    default: {
      const s = (raw ?? '').trim();
      return s || null;
    }
  }
}

// ── Stay status ─────────────────────────────────────────────────────

export type StayStatus = 'in_house' | 'upcoming' | 'checked_out';

/** Today's date in America/New_York as YYYY-MM-DD. */
export function todayEastern(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Nights are [check_in, check_out): the checkout morning is already out. */
export function stayStatusOf(
  checkIn: string | null | undefined,
  checkOut: string | null | undefined,
  today: string,
): StayStatus | '' {
  if (!checkIn || !checkOut) return '';
  if (today < checkIn) return 'upcoming';
  if (today >= checkOut) return 'checked_out';
  return 'in_house';
}

export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Booking preference ──────────────────────────────────────────────

export type BookingCandidate = {
  id: string;
  property_id: string;
  check_in: string;
  check_out: string;
  status: string;
  duplicate_of?: string | null;
  guest_phone?: string | null;
  guest_email?: string | null;
  guest_name?: string | null;
  channel?: string | null;
  external_confirmation_code?: string | null;
  external_booking_id?: string | null;
};

const STAY_STATUSES = new Set(['confirmed', 'completed']);

/** A real stay this window can claim: canonical, confirmed or completed,
 * checking out no more than 14 days ago and arriving within 60 days. */
export function inContactWindow(b: BookingCandidate, today: string): boolean {
  if (b.duplicate_of) return false;
  if (!STAY_STATUSES.has(b.status)) return false;
  if (b.check_out < addDays(today, -CONTACT_WINDOW_BEFORE_DAYS)) return false;
  if (b.check_in > addDays(today, CONTACT_WINDOW_AFTER_DAYS)) return false;
  return true;
}

/**
 * Which stay does a contacting guest mean? In-house first (they are at the
 * door), then the soonest upcoming arrival, then the most recent checkout.
 * Ties break on id so the pick is stable across runs. Null when nothing is
 * inside the window.
 */
export function pickBookingForContact<T extends BookingCandidate>(candidates: T[], today: string): T | null {
  const inWindow = candidates.filter((b) => inContactWindow(b, today));
  if (inWindow.length === 0) return null;
  const rank = (b: BookingCandidate): number => {
    const s = stayStatusOf(b.check_in, b.check_out, today);
    return s === 'in_house' ? 0 : s === 'upcoming' ? 1 : 2;
  };
  return [...inWindow].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 1) return a.check_in.localeCompare(b.check_in) || a.id.localeCompare(b.id);
    if (ra === 2) return b.check_out.localeCompare(a.check_out) || a.id.localeCompare(b.id);
    return a.check_in.localeCompare(b.check_in) || a.id.localeCompare(b.id);
  })[0];
}

/** Does a stored phone (any formatting) mean the same number as an E.164? */
export function phoneMatchesE164(stored: string | null | undefined, e164: string): boolean {
  const a = toE164Phone(stored);
  return !!a && a === e164;
}

// ── OTA deep links ──────────────────────────────────────────────────

/** The thread channel for a booking's channel; null for channels that have
 * no OTA inbox of their own (direct, manual, block, the Guesty aggregate). */
export function otaChannelOfBooking(bookingChannel: string | null | undefined): ThreadChannel | null {
  switch (bookingChannel) {
    case 'airbnb':
      return 'airbnb';
    case 'vrbo':
      return 'vrbo';
    case 'booking_com':
      return 'booking_com';
    default:
      return null;
  }
}

/**
 * Where "Open in <OTA>" goes. Airbnb has a stable per-reservation host URL.
 * VRBO and Booking.com do not expose one we can build from a confirmation
 * code alone, so those open the partner inbox and the operator finds the
 * stay there.
 */
export function otaThreadUrl(channel: ThreadChannel, confirmationCode: string | null | undefined): string | null {
  const code = (confirmationCode ?? '').trim();
  switch (channel) {
    case 'airbnb':
      return code ? `https://www.airbnb.com/hosting/reservations/details/${encodeURIComponent(code)}` : 'https://www.airbnb.com/hosting/inbox';
    case 'vrbo':
      return 'https://www.vrbo.com/rm/inbox';
    case 'booking_com':
      return 'https://admin.booking.com/';
    default:
      return null;
  }
}

/** Badge copy, matching the labels the concierge already emits so
 * channelTone() colors them the same way. */
export function channelLabel(channel: ThreadChannel | string): string {
  switch (channel) {
    case 'sms':
      return 'SMS';
    case 'email':
      return 'Email';
    case 'airbnb':
      return 'Airbnb';
    case 'vrbo':
      return 'VRBO';
    case 'booking_com':
      return 'Booking.com';
    case 'direct':
      return 'Direct';
    default:
      return channel ? channel : '';
  }
}

/** "Open in Airbnb" and friends. */
export function openInLabel(channelBadge: string): string {
  return channelBadge ? `Open in ${channelBadge}` : 'Open thread';
}

// ── Wire-shape adapters ─────────────────────────────────────────────

export type ThreadLike = {
  id: string;
  property_id: string | null;
  booking_id: string | null;
  guest_id: string | null;
  channel: ThreadChannel | string;
  external_thread_key: string | null;
  external_thread_url: string | null;
  guest_name: string | null;
  guest_phone: string | null;
  guest_email: string | null;
  status: ThreadStatus | string;
  snoozed_until: string | null;
  last_guest_at: string | null;
  last_host_at: string | null;
  last_preview: string | null;
  created_at: string;
  updated_at: string;
};

export type MessageLike = {
  id: string;
  thread_id: string;
  direction: 'inbound' | 'outbound' | string;
  sender_kind: SenderKind | string;
  sender_label: string | null;
  body: string;
  sent_at: string;
  external_message_id: string | null;
  provider: string | null;
  delivery_status: string | null;
  raw: Record<string, unknown> | null;
};

/** A ConversationSummary plus the one field Helm threads carry and the
 * concierge's rows do not: the OTA deep link that stands in for a send. */
export type HelmConversationSummary = ConversationSummary & {
  external_thread_url: string | null;
  thread_status: ThreadStatus | string;
};

/** 'helm_sms' when the thread has a phone Helm can text, else ''. The empty
 * string is what hides the composer in Conversations.tsx (canSend = !!module). */
export function moduleOf(thread: Pick<ThreadLike, 'guest_phone' | 'external_thread_key' | 'channel'>): string {
  const phone =
    toE164Phone(thread.guest_phone) ?? (thread.channel === 'sms' ? toE164Phone(thread.external_thread_key) : null);
  return phone ? HELM_SMS_MODULE : '';
}

/** The E.164 Helm would text for this thread, or null when there is none. */
export function smsRailOf(thread: Pick<ThreadLike, 'guest_phone' | 'external_thread_key' | 'channel'>): string | null {
  return toE164Phone(thread.guest_phone) ?? (thread.channel === 'sms' ? toE164Phone(thread.external_thread_key) : null);
}

export function firstNameOf(full: string | null | undefined): string {
  const s = (full ?? '').trim();
  if (!s) return '';
  return s.split(/\s+/)[0];
}

export function previewOf(body: string | null | undefined, max = 140): string {
  const s = (body ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 3).trimEnd()}...`;
}

function laterOf(a: string | null | undefined, b: string | null | undefined): string {
  if (!a) return b ?? '';
  if (!b) return a;
  return a >= b ? a : b;
}

export function lastWhoOf(thread: Pick<ThreadLike, 'last_guest_at' | 'last_host_at'>): 'guest' | 'host' | '' {
  if (!thread.last_guest_at && !thread.last_host_at) return '';
  if (!thread.last_host_at) return 'guest';
  if (!thread.last_guest_at) return 'host';
  return thread.last_guest_at >= thread.last_host_at ? 'guest' : 'host';
}

export function lastActivityOf(thread: Pick<ThreadLike, 'last_guest_at' | 'last_host_at' | 'updated_at'>): string {
  return laterOf(thread.last_guest_at, thread.last_host_at) || thread.updated_at || '';
}

export type SummaryContext = {
  booking: BookingCandidate | null;
  propertyName: string | null;
  pendingCount: number;
  today: string;
};

/** One Conversations-browser row for a Helm thread. */
export function summarizeThread(thread: ThreadLike, ctx: SummaryContext): HelmConversationSummary {
  const b = ctx.booking;
  const guestFull = (thread.guest_name ?? b?.guest_name ?? '').trim();
  const propertyId = thread.property_id ?? b?.property_id ?? '';
  return {
    conversation_id: helmConversationId(thread.id),
    reservation_id: thread.booking_id ?? b?.id ?? '',
    listing_id: propertyId,
    property_name: ctx.propertyName ?? '',
    guest_full: guestFull,
    guest_first: firstNameOf(guestFull),
    check_in: b?.check_in ?? '',
    check_out: b?.check_out ?? '',
    stay_status: b ? stayStatusOf(b.check_in, b.check_out, ctx.today) : '',
    module: moduleOf(thread),
    channel: channelLabel(thread.channel),
    last_activity_at: lastActivityOf(thread),
    last_who: lastWhoOf(thread),
    last_preview: thread.last_preview ?? '',
    pending_count: ctx.pendingCount,
    external_thread_url: thread.external_thread_url ?? null,
    thread_status: thread.status,
  };
}

/** Provenance of a host message for Thread.tsx: the operator's own send
 * from Helm, our AI, a human typing in the Quo app (team), or nothing for
 * an OTA notice / automation template. */
export function viaOf(m: Pick<MessageLike, 'direction' | 'sender_kind' | 'raw'>): ThreadMessage['via'] {
  if (m.direction !== 'outbound') return '';
  switch (m.sender_kind) {
    case 'host_ai':
      return 'helm_ai';
    case 'host_human': {
      const source = typeof m.raw?.source === 'string' ? (m.raw.source as string) : '';
      return source === 'helm' ? 'operator' : 'team';
    }
    default:
      return '';
  }
}

export function toThreadMessage(m: MessageLike): ThreadMessage {
  const who: ThreadMessage['who'] = m.direction === 'inbound' ? 'guest' : 'host';
  let senderName = m.sender_label ?? '';
  if (who === 'host' && !senderName) {
    if (m.sender_kind === 'automation') senderName = 'Helm automation';
    else if (m.sender_kind === 'ota_notice') senderName = 'OTA notice';
  }
  return {
    id: m.id,
    body: m.body,
    at: m.sent_at,
    who,
    via: viaOf(m),
    sender_name: senderName,
  };
}

/** A StayPicker row for a Helm thread that has a stay and a phone. */
export function toReservationPick(summary: HelmConversationSummary, today: string): ReservationPick | null {
  if (!summary.reservation_id || !summary.check_in || !summary.check_out) return null;
  const inHouse = summary.stay_status === 'in_house';
  return {
    reservation_id: summary.reservation_id,
    conversation_id: summary.conversation_id,
    listing_id: summary.listing_id,
    property_name: summary.property_name,
    guest_full: summary.guest_full,
    guest_first: summary.guest_first,
    check_in: summary.check_in,
    check_out: summary.check_out,
    in_house: inHouse,
    effective_start: summary.check_in <= today ? today : summary.check_in,
    module: summary.module,
    channel: summary.channel,
  };
}

/** Merge the concierge list and the Helm list, newest activity first; rows
 * with no activity yet sink to the bottom in their original order. */
export function mergeConversationLists<T extends Pick<ConversationSummary, 'last_activity_at' | 'conversation_id'>>(
  concierge: T[],
  helm: T[],
): T[] {
  const seen = new Set<string>();
  const all: T[] = [];
  for (const row of [...concierge, ...helm]) {
    if (seen.has(row.conversation_id)) continue;
    seen.add(row.conversation_id);
    all.push(row);
  }
  return all
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const ta = a.row.last_activity_at || '';
      const tb = b.row.last_activity_at || '';
      if (ta && tb && ta !== tb) return tb.localeCompare(ta);
      if (ta && !tb) return -1;
      if (!ta && tb) return 1;
      return a.i - b.i;
    })
    .map((x) => x.row);
}

/** A new guest message reopens a thread the operator had parked. */
export function statusAfterInbound(status: ThreadStatus | string): ThreadStatus {
  return status === 'archived' ? 'archived' : 'open';
}
