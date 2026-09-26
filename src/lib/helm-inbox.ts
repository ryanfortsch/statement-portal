/**
 * The Helm-native guest inbox: guest_threads (one timeline per channel and
 * external key, linked to a stay and a guest) and guest_messages (every
 * message in and out, deduped on the provider's id).
 *
 * Rails that work without Guesty on day one:
 *   - guest SMS on the GUESTS line, in through the Quo webhook (quo-ingest
 *     step 1b) and out through sendHelmThreadMessage;
 *   - email, recorded by whoever sends it (automations, the composer);
 *   - OTA stays get a thread with the deep link into the OTA app, which is
 *     the only "send" those channels have in the pilot.
 *
 * The adapter half (listHelmConversations / getHelmThread) produces the
 * concierge wire shapes so Conversations.tsx, Thread.tsx and StayPicker
 * render Helm threads unchanged; a Helm row is recognisable by its
 * conversation_id prefix 'helm:'. The rules are pure in helm-inbox-core.ts.
 *
 * Service role only: both tables are RLS-locked with no anon policy.
 */
import 'server-only';
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { selectAllPaged } from '@/lib/paged-select';
import { fleetNameMap } from '@/lib/fleet';
import { sendMessage } from '@/lib/quo';
import { quoFromNumber } from '@/lib/quo-lines';
import { toE164Phone, normalizeEmail } from '@/lib/guests-identity-core';
import type { ConversationSummary, ThreadMessage, ReservationPick } from '@/lib/stay-concierge';
import {
  addDays,
  channelLabel,
  helmThreadIdOf,
  mergeConversationLists,
  normalizeThreadKey,
  otaChannelOfBooking,
  otaThreadUrl,
  phoneMatchesE164,
  pickBookingForContact,
  previewOf,
  smsRailOf,
  statusAfterInbound,
  summarizeThread,
  toReservationPick,
  toThreadMessage,
  todayEastern,
  CONTACT_WINDOW_AFTER_DAYS,
  CONTACT_WINDOW_BEFORE_DAYS,
  type BookingCandidate,
  type HelmConversationSummary,
  type MessageLike,
  type SenderKind,
  type ThreadChannel,
  type ThreadLike,
} from '@/lib/helm-inbox-core';

export type { HelmConversationSummary } from '@/lib/helm-inbox-core';

export type ThreadRow = ThreadLike;
export type MessageRow = MessageLike;

const THREAD_COLS =
  'id, property_id, booking_id, guest_id, channel, external_thread_key, external_thread_url, guest_name, guest_phone, guest_email, status, snoozed_until, last_guest_at, last_host_at, last_preview, created_at, updated_at';
const MESSAGE_COLS =
  'id, thread_id, direction, sender_kind, sender_label, body, sent_at, external_message_id, provider, delivery_status, raw';
const BOOKING_COLS =
  'id, property_id, check_in, check_out, status, duplicate_of, guest_phone, guest_email, guest_name, channel, external_confirmation_code, external_booking_id';

const UNIQUE_VIOLATION = '23505';

type BookingRow = BookingCandidate & { duplicate_of: string | null };

// ── Lookups ─────────────────────────────────────────────────────────

export async function getHelmThreadRow(threadId: string): Promise<ThreadRow | null> {
  if (!isServiceConfigured || !threadId) return null;
  const { data, error } = await supabaseAdmin.from('guest_threads').select(THREAD_COLS).eq('id', threadId).maybeSingle();
  if (error || !data) return null;
  return data as ThreadRow;
}

async function findThreadByKey(channel: ThreadChannel, key: string): Promise<ThreadRow | null> {
  const { data, error } = await supabaseAdmin
    .from('guest_threads')
    .select(THREAD_COLS)
    .eq('channel', channel)
    .eq('external_thread_key', key)
    .maybeSingle();
  if (error || !data) return null;
  return data as ThreadRow;
}

/** Canonical stays inside the contact window whose guest_phone means the
 * same number. PostgREST cannot normalise phones, so the window is the
 * server-side filter and the phone match happens here. */
async function bookingsForPhone(e164: string, today: string): Promise<BookingRow[]> {
  const rows = await selectAllPaged<BookingRow>(
    (from, to) =>
      supabaseAdmin
        .from('bookings')
        .select(BOOKING_COLS)
        .is('duplicate_of', null)
        .in('status', ['confirmed', 'completed'])
        .not('guest_phone', 'is', null)
        .gte('check_out', addDays(today, -CONTACT_WINDOW_BEFORE_DAYS))
        .lte('check_in', addDays(today, CONTACT_WINDOW_AFTER_DAYS))
        .order('check_in', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'inbox bookings by phone' },
  );
  return rows.filter((b) => phoneMatchesE164(b.guest_phone, e164));
}

async function bookingsForEmail(email: string, today: string): Promise<BookingRow[]> {
  const rows = await selectAllPaged<BookingRow>(
    (from, to) =>
      supabaseAdmin
        .from('bookings')
        .select(BOOKING_COLS)
        .is('duplicate_of', null)
        .in('status', ['confirmed', 'completed'])
        .ilike('guest_email', email)
        .gte('check_out', addDays(today, -CONTACT_WINDOW_BEFORE_DAYS))
        .lte('check_in', addDays(today, CONTACT_WINDOW_AFTER_DAYS))
        .order('check_in', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'inbox bookings by email' },
  );
  return rows.filter((b) => normalizeEmail(b.guest_email) === email);
}

async function getBooking(bookingId: string): Promise<BookingRow | null> {
  const { data, error } = await supabaseAdmin.from('bookings').select(BOOKING_COLS).eq('id', bookingId).maybeSingle();
  if (error || !data) return null;
  return data as BookingRow;
}

type GuestHit = { id: string; full_name: string | null; first_name: string | null; last_name: string | null };

async function guestByPhone(e164: string): Promise<GuestHit | null> {
  const { data, error } = await supabaseAdmin
    .from('guests')
    .select('id, full_name, first_name, last_name')
    .eq('phone_e164', e164)
    .maybeSingle();
  if (error || !data) return null;
  return data as GuestHit;
}

async function guestByEmail(email: string): Promise<GuestHit | null> {
  const { data, error } = await supabaseAdmin
    .from('guests')
    .select('id, full_name, first_name, last_name')
    .eq('email_normalized', email)
    .maybeSingle();
  if (error || !data) return null;
  return data as GuestHit;
}

function guestDisplayName(g: GuestHit | null): string | null {
  if (!g) return null;
  const full = (g.full_name ?? '').trim() || [g.first_name, g.last_name].filter(Boolean).join(' ').trim();
  return full || null;
}

// ── Thread creation ─────────────────────────────────────────────────

type ThreadSeed = {
  channel: ThreadChannel;
  key: string;
  booking: BookingRow | null;
  guest: GuestHit | null;
  guestName?: string | null;
  guestPhone?: string | null;
  guestEmail?: string | null;
  externalThreadUrl?: string | null;
  propertyId?: string | null;
};

async function createThread(seed: ThreadSeed): Promise<ThreadRow | null> {
  const b = seed.booking;
  const row = {
    channel: seed.channel,
    external_thread_key: seed.key,
    external_thread_url: seed.externalThreadUrl ?? null,
    property_id: seed.propertyId ?? b?.property_id ?? null,
    booking_id: b?.id ?? null,
    guest_id: seed.guest?.id ?? null,
    guest_name: (seed.guestName ?? b?.guest_name ?? guestDisplayName(seed.guest)) || null,
    guest_phone: seed.guestPhone ?? (seed.channel === 'sms' ? seed.key : toE164Phone(b?.guest_phone)) ?? null,
    guest_email: seed.guestEmail ?? (seed.channel === 'email' ? seed.key : normalizeEmail(b?.guest_email)) ?? null,
    status: 'open',
  };
  const { data, error } = await supabaseAdmin.from('guest_threads').insert(row).select(THREAD_COLS).maybeSingle();
  if (error) {
    // Two messages for a new thread landing together: the loser re-reads.
    if (error.code === UNIQUE_VIOLATION) return findThreadByKey(seed.channel, seed.key);
    throw new Error(`create thread: ${error.message}`);
  }
  return (data ?? null) as ThreadRow | null;
}

/** Fill a thread's stay / guest link when a later message can tell us
 * more than the first one could (a guest who texted before booking). */
async function attachStayIfMissing(thread: ThreadRow, booking: BookingRow | null, guest: GuestHit | null): Promise<ThreadRow> {
  const patch: Record<string, unknown> = {};
  if (!thread.booking_id && booking) {
    patch.booking_id = booking.id;
    if (!thread.property_id) patch.property_id = booking.property_id;
    if (!thread.guest_name && booking.guest_name) patch.guest_name = booking.guest_name;
    if (!thread.guest_email && booking.guest_email) patch.guest_email = normalizeEmail(booking.guest_email);
    if (!thread.guest_phone && booking.guest_phone) patch.guest_phone = toE164Phone(booking.guest_phone);
  }
  if (!thread.guest_id && guest) {
    patch.guest_id = guest.id;
    if (!thread.guest_name && !patch.guest_name) {
      const n = guestDisplayName(guest);
      if (n) patch.guest_name = n;
    }
  }
  if (Object.keys(patch).length === 0) return thread;
  const { data, error } = await supabaseAdmin
    .from('guest_threads')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', thread.id)
    .select(THREAD_COLS)
    .maybeSingle();
  if (error || !data) return thread;
  return data as ThreadRow;
}

// ── Message recording ───────────────────────────────────────────────

type RecordedMessage = { threadId: string; messageId: string | null; duplicate: boolean };

async function insertMessage(
  thread: ThreadRow,
  m: {
    direction: 'inbound' | 'outbound';
    senderKind: SenderKind;
    senderLabel?: string | null;
    body: string;
    at: string;
    externalMessageId?: string | null;
    provider?: string | null;
    deliveryStatus?: string;
    automationSendId?: string | null;
    raw?: Record<string, unknown> | null;
  },
): Promise<RecordedMessage> {
  const { data, error } = await supabaseAdmin
    .from('guest_messages')
    .insert({
      thread_id: thread.id,
      direction: m.direction,
      sender_kind: m.senderKind,
      sender_label: m.senderLabel ?? null,
      body: m.body,
      sent_at: m.at,
      external_message_id: m.externalMessageId ?? null,
      provider: m.provider ?? null,
      delivery_status: m.deliveryStatus ?? 'recorded',
      automation_send_id: m.automationSendId ?? null,
      raw: m.raw ?? null,
    })
    .select('id')
    .maybeSingle();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { threadId: thread.id, messageId: null, duplicate: true };
    throw new Error(`record message: ${error.message}`);
  }

  const patch: Record<string, unknown> = {
    last_preview: previewOf(m.body),
    updated_at: new Date().toISOString(),
  };
  if (m.direction === 'inbound') {
    if (!thread.last_guest_at || thread.last_guest_at < m.at) patch.last_guest_at = m.at;
    // A fresh guest message reopens a parked thread.
    const next = statusAfterInbound(thread.status);
    if (next !== thread.status) {
      patch.status = next;
      patch.snoozed_until = null;
    }
  } else if (!thread.last_host_at || thread.last_host_at < m.at) {
    patch.last_host_at = m.at;
  }
  await supabaseAdmin.from('guest_threads').update(patch).eq('id', thread.id);

  return { threadId: thread.id, messageId: (data?.id as string | undefined) ?? null, duplicate: false };
}

/** True when any thread already holds this provider message id. Used so a
 * send Helm made and recorded itself is not recorded again when the Quo
 * webhook echoes it back as message.delivered. */
export async function isMessageRecorded(externalMessageId: string | null | undefined): Promise<boolean> {
  if (!isServiceConfigured || !externalMessageId) return false;
  const { data, error } = await supabaseAdmin
    .from('guest_messages')
    .select('id')
    .eq('external_message_id', externalMessageId)
    .limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}

export type InboundSmsInput = {
  phone: string;
  body: string;
  at: string;
  quoMessageId: string;
  raw?: Record<string, unknown> | null;
  /**
   * Default false: only a phone that matches a stay in the window, an
   * existing sms thread, or a guest record gets a thread. The GUESTS line
   * also receives wrong numbers and spam; those stay in the /crm triage
   * queue (quo_unknown_numbers) instead of becoming threads.
   */
  createForStranger?: boolean;
};

export type InboundSmsResult =
  | { recorded: true; threadId: string; messageId: string | null; duplicate: boolean; bookingId: string | null }
  | { recorded: false; reason: 'not_configured' | 'bad_phone' | 'no_match' };

/** A guest text on the GUESTS line: file it on the (sms, E.164) thread,
 * creating the thread and linking the stay (in-house first) and the guest
 * record when this is the first message from that number. */
export async function recordInboundSms(input: InboundSmsInput): Promise<InboundSmsResult> {
  if (!isServiceConfigured) return { recorded: false, reason: 'not_configured' };
  const e164 = normalizeThreadKey('sms', input.phone);
  if (!e164) return { recorded: false, reason: 'bad_phone' };
  const today = todayEastern();

  let thread = await findThreadByKey('sms', e164);
  const needsStay = !thread || !thread.booking_id || !thread.guest_id;
  let booking: BookingRow | null = null;
  let guest: GuestHit | null = null;
  if (needsStay) {
    [booking, guest] = await Promise.all([
      thread?.booking_id ? Promise.resolve(null) : bookingsForPhone(e164, today).then((rows) => pickBookingForContact(rows, today)),
      thread?.guest_id ? Promise.resolve(null) : guestByPhone(e164),
    ]);
  }

  if (!thread) {
    if (!booking && !guest && !input.createForStranger) return { recorded: false, reason: 'no_match' };
    thread = await createThread({ channel: 'sms', key: e164, booking, guest });
    if (!thread) return { recorded: false, reason: 'no_match' };
  } else if (booking || guest) {
    thread = await attachStayIfMissing(thread, booking, guest);
  }

  const r = await insertMessage(thread, {
    direction: 'inbound',
    senderKind: 'guest',
    senderLabel: thread.guest_name,
    body: input.body,
    at: input.at,
    externalMessageId: input.quoMessageId,
    provider: 'quo',
    deliveryStatus: 'recorded',
    raw: input.raw ?? null,
  });
  return { recorded: true, ...r, bookingId: thread.booking_id };
}

export type OutboundSmsInput = {
  phone: string;
  body: string;
  at: string;
  quoMessageId: string | null;
  /** host_human for a person (Helm composer or the Quo app), host_ai for the
   * concierge, automation for a scheduled template. */
  senderKind: Extract<SenderKind, 'host_human' | 'host_ai' | 'automation'>;
  senderLabel?: string | null;
  /** 'helm' marks a send Helm itself made (renders as "You · via Helm");
   * anything else renders as a team member typing in the Quo app. */
  source?: 'helm' | 'quo_app' | 'concierge' | 'automation';
  automationSendId?: string | null;
  deliveryStatus?: string;
  raw?: Record<string, unknown> | null;
  /** Record on this thread instead of the (sms, E.164) one: a Helm composer
   * send from an OTA thread that happens to know the guest's phone. */
  threadId?: string | null;
  createForStranger?: boolean;
};

export type OutboundResult =
  | { recorded: true; threadId: string; messageId: string | null; duplicate: boolean }
  | { recorded: false; reason: 'not_configured' | 'bad_phone' | 'bad_email' | 'no_match' | 'already_recorded' };

export async function recordOutboundSms(input: OutboundSmsInput): Promise<OutboundResult> {
  if (!isServiceConfigured) return { recorded: false, reason: 'not_configured' };
  const e164 = normalizeThreadKey('sms', input.phone);
  if (!e164) return { recorded: false, reason: 'bad_phone' };
  if (input.quoMessageId && (await isMessageRecorded(input.quoMessageId))) {
    return { recorded: false, reason: 'already_recorded' };
  }

  let thread: ThreadRow | null = input.threadId ? await getHelmThreadRow(input.threadId) : null;
  if (!thread) {
    thread = await findThreadByKey('sms', e164);
    if (!thread) {
      const today = todayEastern();
      const [booking, guest] = await Promise.all([
        bookingsForPhone(e164, today).then((rows) => pickBookingForContact(rows, today)),
        guestByPhone(e164),
      ]);
      if (!booking && !guest && !input.createForStranger) return { recorded: false, reason: 'no_match' };
      thread = await createThread({ channel: 'sms', key: e164, booking, guest });
      if (!thread) return { recorded: false, reason: 'no_match' };
    }
  }

  const r = await insertMessage(thread, {
    direction: 'outbound',
    senderKind: input.senderKind,
    senderLabel: input.senderLabel ?? null,
    body: input.body,
    at: input.at,
    externalMessageId: input.quoMessageId,
    provider: 'quo',
    deliveryStatus: input.deliveryStatus ?? 'sent',
    automationSendId: input.automationSendId ?? null,
    raw: { ...(input.raw ?? {}), source: input.source ?? 'quo_app' },
  });
  return { recorded: true, ...r };
}

export type OutboundEmailInput = {
  email: string;
  body: string;
  at: string;
  subject?: string | null;
  /** Resend or Gmail message id; dedupes a replayed send. */
  providerMessageId?: string | null;
  provider?: 'resend' | 'gmail';
  senderKind: Extract<SenderKind, 'host_human' | 'host_ai' | 'automation'>;
  senderLabel?: string | null;
  source?: 'helm' | 'concierge' | 'automation';
  /** Link the thread to this stay when the (email) thread is new. */
  bookingId?: string | null;
  propertyId?: string | null;
  guestName?: string | null;
  automationSendId?: string | null;
  deliveryStatus?: string;
  raw?: Record<string, unknown> | null;
};

export async function recordOutboundEmail(input: OutboundEmailInput): Promise<OutboundResult> {
  if (!isServiceConfigured) return { recorded: false, reason: 'not_configured' };
  const key = normalizeThreadKey('email', input.email);
  if (!key) return { recorded: false, reason: 'bad_email' };
  if (input.providerMessageId && (await isMessageRecorded(input.providerMessageId))) {
    return { recorded: false, reason: 'already_recorded' };
  }

  let thread = await findThreadByKey('email', key);
  if (!thread) {
    const today = todayEastern();
    const booking = input.bookingId
      ? await getBooking(input.bookingId)
      : await bookingsForEmail(key, today).then((rows) => pickBookingForContact(rows, today));
    const guest = await guestByEmail(key);
    thread = await createThread({
      channel: 'email',
      key,
      booking,
      guest,
      guestName: input.guestName ?? null,
      propertyId: input.propertyId ?? null,
    });
    if (!thread) return { recorded: false, reason: 'no_match' };
  }

  const body = input.subject ? `${input.subject.trim()}\n\n${input.body}` : input.body;
  const r = await insertMessage(thread, {
    direction: 'outbound',
    senderKind: input.senderKind,
    senderLabel: input.senderLabel ?? null,
    body,
    at: input.at,
    externalMessageId: input.providerMessageId ?? null,
    provider: input.provider ?? 'resend',
    deliveryStatus: input.deliveryStatus ?? 'sent',
    automationSendId: input.automationSendId ?? null,
    raw: { ...(input.raw ?? {}), source: input.source ?? 'helm', subject: input.subject ?? null },
  });
  return { recorded: true, ...r };
}

// ── OTA threads ─────────────────────────────────────────────────────

export type OtaBookingLike = {
  id: string;
  property_id: string;
  channel: string;
  external_confirmation_code?: string | null;
  external_booking_id?: string | null;
  guest_name?: string | null;
  guest_phone?: string | null;
  guest_email?: string | null;
};

/**
 * One thread per OTA stay, keyed on the confirmation code, carrying the
 * deep link into the OTA app (airbnb: the reservation detail page). No
 * thread for direct, manual, block or Guesty-aggregate rows: those guests
 * reach us by SMS or email and get threads there. Idempotent.
 */
export async function ensureOtaThreadForBooking(booking: OtaBookingLike): Promise<ThreadRow | null> {
  if (!isServiceConfigured) return null;
  const channel = otaChannelOfBooking(booking.channel);
  if (!channel) return null;
  const code = booking.external_confirmation_code || booking.external_booking_id || null;
  const key = normalizeThreadKey(channel, code ?? `booking:${booking.id}`);
  if (!key) return null;
  const url = otaThreadUrl(channel, code);

  const existing = await findThreadByKey(channel, key);
  if (existing) {
    const patch: Record<string, unknown> = {};
    if (!existing.booking_id) patch.booking_id = booking.id;
    if (!existing.property_id) patch.property_id = booking.property_id;
    if (!existing.external_thread_url && url) patch.external_thread_url = url;
    if (!existing.guest_name && booking.guest_name) patch.guest_name = booking.guest_name;
    if (!existing.guest_phone && booking.guest_phone) patch.guest_phone = toE164Phone(booking.guest_phone);
    if (!existing.guest_email && booking.guest_email) patch.guest_email = normalizeEmail(booking.guest_email);
    if (Object.keys(patch).length === 0) return existing;
    const { data } = await supabaseAdmin
      .from('guest_threads')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select(THREAD_COLS)
      .maybeSingle();
    return ((data ?? existing) as ThreadRow) ?? existing;
  }

  const phone = toE164Phone(booking.guest_phone);
  const email = normalizeEmail(booking.guest_email);
  const guest = (phone ? await guestByPhone(phone) : null) ?? (email ? await guestByEmail(email) : null);
  return createThread({
    channel,
    key,
    booking: {
      id: booking.id,
      property_id: booking.property_id,
      check_in: '',
      check_out: '',
      status: 'confirmed',
      duplicate_of: null,
      guest_name: booking.guest_name ?? null,
      guest_phone: booking.guest_phone ?? null,
      guest_email: booking.guest_email ?? null,
    },
    guest,
    guestPhone: phone,
    guestEmail: email,
    externalThreadUrl: url,
    propertyId: booking.property_id,
  });
}

// ── The adapter: Helm threads in the concierge wire shapes ───────────

async function pendingAutomationCounts(bookingIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (bookingIds.length === 0) return out;
  try {
    const { data, error } = await supabaseAdmin
      .from('automation_sends')
      .select('booking_id')
      .eq('status', 'awaiting_approval')
      .in('booking_id', bookingIds);
    if (error || !data) return out;
    for (const row of data as { booking_id: string }[]) {
      out.set(row.booking_id, (out.get(row.booking_id) ?? 0) + 1);
    }
  } catch {
    // The count is decoration; the list must render without it.
  }
  return out;
}

async function loadBookingsById(ids: string[]): Promise<Map<string, BookingRow>> {
  const out = new Map<string, BookingRow>();
  if (ids.length === 0) return out;
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 200) {
    const slice = unique.slice(i, i + 200);
    const { data, error } = await supabaseAdmin.from('bookings').select(BOOKING_COLS).in('id', slice);
    if (error || !data) continue;
    for (const b of data as BookingRow[]) out.set(b.id, b);
  }
  return out;
}

/**
 * Every Helm thread touched in the last `days` days (plus any open thread
 * whose stay is still inside the contact window), shaped as Conversations
 * rows. Archived threads are left out. Never throws: a failed read is an
 * empty list, and /messaging concatenates it after the concierge list.
 */
export async function listHelmConversations(days = 60): Promise<HelmConversationSummary[]> {
  if (!isServiceConfigured) return [];
  try {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const threads = await selectAllPaged<ThreadRow>(
      (from, to) =>
        supabaseAdmin
          .from('guest_threads')
          .select(THREAD_COLS)
          .neq('status', 'archived')
          .gte('updated_at', since)
          .order('updated_at', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'helm threads', maxRows: 5000 },
    );
    if (threads.length === 0) return [];

    const bookingIds = threads.map((t) => t.booking_id).filter((x): x is string => !!x);
    const [bookings, names, pending] = await Promise.all([
      loadBookingsById(bookingIds),
      fleetNameMap({ includeInactive: true }).catch(() => new Map<string, string>()),
      pendingAutomationCounts(bookingIds),
    ]);
    const today = todayEastern();
    return threads.map((t) => {
      const booking = t.booking_id ? bookings.get(t.booking_id) ?? null : null;
      const propertyId = t.property_id ?? booking?.property_id ?? '';
      return summarizeThread(t, {
        booking,
        propertyName: propertyId ? names.get(propertyId) ?? null : null,
        pendingCount: t.booking_id ? pending.get(t.booking_id) ?? 0 : 0,
        today,
      });
    });
  } catch (err) {
    console.warn('[helm-inbox] list failed', err instanceof Error ? err.message : err);
    return [];
  }
}

/** Concierge rows plus Helm rows, newest activity first. */
export async function mergeWithHelmConversations(
  concierge: ConversationSummary[],
  days = 60,
): Promise<ConversationSummary[]> {
  const helm = await listHelmConversations(days);
  return mergeConversationLists<ConversationSummary>(concierge, helm);
}

/** Helm stays the Send lens can pick: threads with a stay and a phone. */
export async function listHelmReservationPicks(days = 60): Promise<ReservationPick[]> {
  const rows = await listHelmConversations(days);
  const today = todayEastern();
  const out: ReservationPick[] = [];
  for (const r of rows) {
    if (!r.module) continue;
    const pick = toReservationPick(r, today);
    if (pick) out.push(pick);
  }
  return out;
}

/** The full timeline of one thread, oldest first. Accepts a bare thread id
 * or a 'helm:<id>' conversation id. */
export async function getHelmThread(threadOrConversationId: string, limit = 500): Promise<ThreadMessage[]> {
  if (!isServiceConfigured) return [];
  const threadId = helmThreadIdOf(threadOrConversationId) ?? threadOrConversationId;
  if (!threadId) return [];
  const { data, error } = await supabaseAdmin
    .from('guest_messages')
    .select(MESSAGE_COLS)
    .eq('thread_id', threadId)
    .order('sent_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`helm thread: ${error.message}`);
  return ((data ?? []) as MessageRow[]).map(toThreadMessage);
}

export type SendHelmResult =
  | { ok: true; threadId: string; messageId: string | null; to: string }
  | { ok: false; error: 'no_rail' | 'not_found' | 'empty' | 'send_failed'; external_thread_url: string | null; channel: string; detail?: string };

/**
 * The Helm composer on a Helm thread. A thread with a phone sends exactly
 * `body` by SMS on the GUESTS line and records it on the thread as the
 * operator's own send. A thread with no phone (an OTA stay whose guest has
 * not texted yet) has no rail Helm can send on: the caller gets no_rail
 * plus the deep link so the UI can offer "Open in Airbnb" and "Copy draft".
 */
export async function sendHelmThreadMessage(
  threadOrConversationId: string,
  body: string,
  actor: string,
): Promise<SendHelmResult> {
  const threadId = helmThreadIdOf(threadOrConversationId) ?? threadOrConversationId;
  const thread = await getHelmThreadRow(threadId);
  if (!thread) return { ok: false, error: 'not_found', external_thread_url: null, channel: '' };
  const text = body.trim();
  const channel = channelLabel(thread.channel);
  if (!text) return { ok: false, error: 'empty', external_thread_url: thread.external_thread_url, channel };
  const to = smsRailOf(thread);
  if (!to) return { ok: false, error: 'no_rail', external_thread_url: thread.external_thread_url, channel };

  let quoId: string | null = null;
  try {
    const sent = await sendMessage({ from: quoFromNumber('guests'), to, content: text });
    quoId = sent?.id ?? null;
  } catch (err) {
    return {
      ok: false,
      error: 'send_failed',
      external_thread_url: thread.external_thread_url,
      channel,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const r = await insertMessage(thread, {
    direction: 'outbound',
    senderKind: 'host_human',
    senderLabel: actor,
    body: text,
    at: new Date().toISOString(),
    externalMessageId: quoId,
    provider: 'quo',
    deliveryStatus: 'sent',
    raw: { source: 'helm', actor, rail: 'sms', from_line: 'guests' },
  });
  return { ok: true, threadId: thread.id, messageId: r.messageId, to };
}

// ── Operator state ──────────────────────────────────────────────────

export async function snoozeHelmThread(threadOrConversationId: string, untilIso: string): Promise<boolean> {
  if (!isServiceConfigured) return false;
  const threadId = helmThreadIdOf(threadOrConversationId) ?? threadOrConversationId;
  const { error } = await supabaseAdmin
    .from('guest_threads')
    .update({ status: 'snoozed', snoozed_until: untilIso, updated_at: new Date().toISOString() })
    .eq('id', threadId);
  return !error;
}

export async function markHelmThreadDone(threadOrConversationId: string): Promise<boolean> {
  if (!isServiceConfigured) return false;
  const threadId = helmThreadIdOf(threadOrConversationId) ?? threadOrConversationId;
  const { error } = await supabaseAdmin
    .from('guest_threads')
    .update({ status: 'done', snoozed_until: null, updated_at: new Date().toISOString() })
    .eq('id', threadId);
  return !error;
}

export async function reopenHelmThread(threadOrConversationId: string): Promise<boolean> {
  if (!isServiceConfigured) return false;
  const threadId = helmThreadIdOf(threadOrConversationId) ?? threadOrConversationId;
  const { error } = await supabaseAdmin
    .from('guest_threads')
    .update({ status: 'open', snoozed_until: null, updated_at: new Date().toISOString() })
    .eq('id', threadId);
  return !error;
}

/** Snoozed threads whose alarm has passed come back to open. Cheap enough
 * to run at the top of a list render; also safe from a cron. */
export async function wakeSnoozedHelmThreads(now: Date = new Date()): Promise<number> {
  if (!isServiceConfigured) return 0;
  const { data, error } = await supabaseAdmin
    .from('guest_threads')
    .update({ status: 'open', snoozed_until: null, updated_at: now.toISOString() })
    .eq('status', 'snoozed')
    .lte('snoozed_until', now.toISOString())
    .select('id');
  if (error) return 0;
  return (data ?? []).length;
}
