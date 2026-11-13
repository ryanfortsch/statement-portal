/**
 * Messages about a partner home's booking request: reading a conversation,
 * writing in it, and emailing the other side. The rules are
 * src/lib/partner-messages.ts.
 *
 *   hostThread / hostPost     the host, from /api/pms/host/messages, on a
 *                             request at one of their homes
 *   guestThread / guestPost   the guest, from /api/pms/trips/messages, on a
 *                             request made with their email
 *   officeThreads / officePost  the office, on /guests/requests
 *   threadCountsFor           the counts on the host's and guest's lists
 *   retryMessageEmails        the hourly sweep: an email that did not go
 *
 * Opening a conversation stamps the reader's side read. Every check that a
 * request is the caller's happens here, before anything is read or written.
 */
import 'server-only';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { selectAllPaged } from '@/lib/paged-select';
import { BOOKING_REQUEST_COLS, guestFullName, type BookingRequestRow } from '@/lib/booking-requests';
import { SCA_SITE_ORIGIN } from '@/lib/booking-request-email';
import { sendFromHello } from '@/lib/partner-host-email';
import { easternIsoDay } from '@/lib/partner-host-calendar';
import { hostEmailsOf, hostGuestName, hostRequestView, normalizeHostEmail, type HostRequestView } from '@/lib/partner-host';
import { tripFromRequest, type TripView } from '@/lib/guest-trips';
import type { HostSession } from '@/lib/partner-host-db';
import type { TripSession } from '@/lib/guest-trips-db';
import {
  MESSAGE_EMAIL_RETRY_DAYS,
  MESSAGES_PER_HOUR,
  PARTNER_MESSAGE_COLS,
  bodyToStore,
  canMessage,
  cleanMessageBody,
  closedLine,
  hostLabel,
  hostThreadUrl,
  isBooked,
  isDuplicate,
  messageView,
  newMessageEmail,
  owedTo,
  recipientsOf,
  threadCounts,
  threadView,
  tripThreadUrl,
  type MessageAuthor,
  type MessageReader,
  type MessageView,
  type PartnerMessageRow,
  type ThreadCount,
  type ThreadNames,
} from '@/lib/partner-messages';

const TABLE = 'partner_messages';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Home = { id: string; name: string | null; title: string | null; owner_full: string | null; owner_emails: unknown };

async function requestRow(id: string): Promise<BookingRequestRow | null> {
  const { data, error } = await supabaseAdmin.from('booking_requests').select(BOOKING_REQUEST_COLS).eq('id', id).maybeSingle();
  if (error) throw new Error(`message request read failed: ${error.message}`);
  return (data as BookingRequestRow | null) ?? null;
}

async function homeOf(propertyId: string): Promise<Home | null> {
  const { data, error } = await supabaseAdmin
    .from('properties')
    .select('id, name, title, owner_full, owner_emails')
    .eq('id', propertyId)
    .eq('kind', 'partner')
    .maybeSingle();
  if (error) throw new Error(`message home read failed: ${error.message}`);
  return (data as Home | null) ?? null;
}

async function messagesFor(requestId: string): Promise<PartnerMessageRow[]> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select(PARTNER_MESSAGE_COLS)
    .eq('request_id', requestId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(500);
  if (error) throw new Error(`messages read failed: ${error.message}`);
  return (data ?? []) as PartnerMessageRow[];
}

function namesFor(row: BookingRequestRow, home: Pick<Home, 'owner_full'> | null, viewer: MessageReader | 'office', now: Date): ThreadNames {
  return {
    guest: viewer === 'office' ? guestFullName(row) : hostGuestName(row, isBooked(row, now)),
    host: hostLabel(home?.owner_full),
  };
}

/** The reader opened the conversation: everything written to them is read. */
async function markRead(requestId: string, reader: MessageReader, now: Date): Promise<void> {
  const col = reader === 'guest' ? 'guest_read_at' : 'host_read_at';
  const { error } = await supabaseAdmin.from(TABLE).update({ [col]: now.toISOString() }).eq('request_id', requestId).neq('author', reader).is(col, null);
  if (error) console.warn('[partner-messages] read stamp failed:', error.message);
}

/** Messages and unread counts per request, for one reader's list. Throws on a failed read. */
export async function threadCountsFor(requestIds: string[], reader: MessageReader | 'office'): Promise<Map<string, ThreadCount>> {
  if (requestIds.length === 0) return new Map();
  const rows = await selectAllPaged<Pick<PartnerMessageRow, 'request_id' | 'author' | 'guest_read_at' | 'host_read_at'>>(
    (from, to) =>
      supabaseAdmin
        .from(TABLE)
        .select('id, request_id, author, guest_read_at, host_read_at')
        .in('request_id', requestIds)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'message counts' },
  );
  return threadCounts(rows, reader);
}

// ─── Reading ───────────────────────────────────────────────────────────────

export type Thread<V> = { ok: true; view: V; messages: MessageView[]; can_post: boolean; closed_line: string | null } | { ok: false; notFound: true };

function withCounts<V extends { messages: number; unread: number }>(view: V, rows: PartnerMessageRow[], reader: MessageReader): V {
  const c = threadCounts(rows, reader).get(rows[0]?.request_id ?? '') ?? { messages: 0, unread: 0 };
  return { ...view, messages: c.messages, unread: c.unread };
}

function parseId(raw: unknown): string | null {
  return typeof raw === 'string' && UUID.test(raw) ? raw : null;
}

/** The host's side of one conversation, on a request at one of their homes. */
export async function hostThread(session: HostSession, rawId: unknown, now: Date = new Date()): Promise<Thread<HostRequestView>> {
  const id = parseId(rawId);
  const row = id ? await requestRow(id) : null;
  const home = row ? session.homes.find((h) => h.id === row.property_id) : undefined;
  if (!row || !home) return { ok: false, notFound: true };
  const [homeRow, rows] = await Promise.all([homeOf(row.property_id), messagesFor(row.id)]);
  const names = namesFor(row, homeRow, 'host', now);
  const messages = threadView(row, rows, 'host', names, now);
  await markRead(row.id, 'host', now);
  const open = canMessage(row, easternIsoDay(now), now);
  return {
    ok: true,
    view: withCounts(hostRequestView(row, home.title, now), rows, 'host'),
    messages,
    can_post: open,
    closed_line: open ? null : closedLine(row, now),
  };
}

/** The guest's side of one conversation, on a request made with their email. */
export async function guestThread(session: TripSession, rawId: unknown, now: Date = new Date()): Promise<Thread<TripView>> {
  const id = parseId(rawId);
  const row = id ? await requestRow(id) : null;
  if (!row || normalizeHostEmail(row.guest_email) !== session.email) return { ok: false, notFound: true };
  const [homeRow, rows] = await Promise.all([homeOf(row.property_id), messagesFor(row.id)]);
  const names = namesFor(row, homeRow, 'guest', now);
  const messages = threadView(row, rows, 'guest', names, now);
  await markRead(row.id, 'guest', now);
  const open = canMessage(row, easternIsoDay(now), now);
  const title = homeRow ? homeRow.title || homeRow.name : null;
  return {
    ok: true,
    view: withCounts(tripFromRequest(row, title, easternIsoDay(now), now), rows, 'guest'),
    messages,
    can_post: open,
    closed_line: open ? null : closedLine(row, now),
  };
}

/** Every conversation on the office's list, as the office reads them. Opening the page stamps nothing. */
export async function officeThreads(
  rows: Array<BookingRequestRow & { home?: { host_name: string | null } | null }>,
  now: Date = new Date(),
): Promise<Map<string, { messages: MessageView[]; can_post: boolean }>> {
  const out = new Map<string, { messages: MessageView[]; can_post: boolean }>();
  if (rows.length === 0) return out;
  const all = await selectAllPaged<PartnerMessageRow>(
    (from, to) =>
      supabaseAdmin
        .from(TABLE)
        .select(PARTNER_MESSAGE_COLS)
        .in(
          'request_id',
          rows.map((r) => r.id),
        )
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'office messages' },
  );
  const today = easternIsoDay(now);
  for (const r of rows) {
    const mine = all.filter((m) => m.request_id === r.id);
    const names = namesFor(r, { owner_full: r.home?.host_name ?? null }, 'office', now);
    out.set(r.id, { messages: threadView(r, mine, 'office', names, now), can_post: canMessage(r, today, now) });
  }
  return out;
}

// ─── Writing ───────────────────────────────────────────────────────────────

export type PostResult = { ok: true; message: MessageView; emailed: boolean } | { ok: false; reason: string; notFound?: boolean; invalid?: boolean };

const TOO_MANY = 'That is a lot of messages in an hour. Try again in a little while, or write to hello@staycapeann.com.';

async function post(row: BookingRequestRow, author: MessageAuthor, authorEmail: string, rawBody: unknown, names: ThreadNames, now: Date): Promise<PostResult> {
  const viewer: MessageReader | 'office' = author;
  if (!canMessage(row, easternIsoDay(now), now)) return { ok: false, reason: closedLine(row, now) };
  const body = cleanMessageBody(rawBody);
  if (!body) return { ok: false, reason: 'Write something first.', invalid: true };

  const since = new Date(now.getTime() - 3600_000).toISOString();
  const { data: recentData, error: recentErr } = await supabaseAdmin
    .from(TABLE)
    .select(PARTNER_MESSAGE_COLS)
    .eq('request_id', row.id)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(100);
  if (recentErr) throw new Error(`recent messages read failed: ${recentErr.message}`);
  const recent = (recentData ?? []) as PartnerMessageRow[];

  const stored = bodyToStore(body, isBooked(row, now), author);
  // A double tap: the first one already went.
  const twin = recent.find((m) => isDuplicate([m], author, stored.body, now));
  if (twin) return { ok: true, message: messageView(twin, viewer, names), emailed: false };
  if (recent.filter((m) => m.author === author).length >= MESSAGES_PER_HOUR) return { ok: false, reason: TOO_MANY };

  const at = now.toISOString();
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .insert({
      request_id: row.id,
      author,
      author_email: authorEmail,
      body: stored.body,
      masked: stored.masked,
      created_at: at,
      guest_read_at: author === 'guest' ? at : null,
      host_read_at: author === 'host' ? at : null,
    })
    .select(PARTNER_MESSAGE_COLS)
    .single();
  if (error) throw new Error(`message insert failed: ${error.message}`);
  const written = data as PartnerMessageRow;

  let emailed = false;
  for (const reader of recipientsOf(author)) {
    if (await emailAboutMessages(row, reader, now)) emailed = true;
  }
  return { ok: true, message: messageView(written, viewer, names), emailed };
}

export async function hostPost(session: HostSession, rawId: unknown, rawBody: unknown, now: Date = new Date()): Promise<PostResult> {
  const id = parseId(rawId);
  const row = id ? await requestRow(id) : null;
  if (!row || !session.homes.some((h) => h.id === row.property_id)) return { ok: false, reason: 'No such request.', notFound: true };
  const homeRow = await homeOf(row.property_id);
  return post(row, 'host', session.email, rawBody, namesFor(row, homeRow, 'host', now), now);
}

export async function guestPost(session: TripSession, rawId: unknown, rawBody: unknown, now: Date = new Date()): Promise<PostResult> {
  const id = parseId(rawId);
  const row = id ? await requestRow(id) : null;
  if (!row || normalizeHostEmail(row.guest_email) !== session.email) return { ok: false, reason: 'No such request.', notFound: true };
  const homeRow = await homeOf(row.property_id);
  return post(row, 'guest', session.email, rawBody, namesFor(row, homeRow, 'guest', now), now);
}

/** The office writes as Stay Cape Ann, to the guest and the host at once. `by` is the owner's login. */
export async function officePost(rawId: unknown, by: string, rawBody: unknown, now: Date = new Date()): Promise<PostResult> {
  const id = parseId(rawId);
  const row = id ? await requestRow(id) : null;
  if (!row) return { ok: false, reason: 'No such request.', notFound: true };
  const homeRow = await homeOf(row.property_id);
  if (!homeRow) return { ok: false, reason: 'No such request.', notFound: true };
  return post(row, 'office', by, rawBody, namesFor(row, homeRow, 'office', now), now);
}

// ─── Email ─────────────────────────────────────────────────────────────────

/**
 * Email one side what is waiting for them in this conversation: every
 * message not theirs, not opened and not emailed yet, in one email. Stamps
 * those messages emailed once any address took it. Best-effort: false, never
 * a throw.
 */
export async function emailAboutMessages(row: BookingRequestRow, reader: MessageReader, now: Date = new Date()): Promise<boolean> {
  try {
    const since = new Date(now.getTime() - MESSAGE_EMAIL_RETRY_DAYS * 86_400_000).toISOString();
    const rows = (await messagesFor(row.id)).filter((m) => m.created_at >= since);
    const owed = owedTo(rows, reader);
    if (owed.length === 0) return false;
    const home = await homeOf(row.property_id);
    if (!home) return false;
    const names = namesFor(row, home, reader, now);
    const to = reader === 'guest' ? [normalizeHostEmail(row.guest_email)].filter((e): e is string => !!e) : hostEmailsOf(home);
    if (to.length === 0) return false;
    const email = newMessageEmail({
      to: reader,
      homeTitle: home.title || home.name,
      messages: owed.map((m) => ({ label: messageView(m, reader, names).label, body: m.body })),
      link: reader === 'guest' ? tripThreadUrl(SCA_SITE_ORIGIN, row.id) : hostThreadUrl(SCA_SITE_ORIGIN, row.id),
      other: reader === 'guest' ? (names.host === 'Your host' ? 'your host' : names.host) : names.guest,
    });
    const last = owed[owed.length - 1].id;
    let sent = false;
    for (const address of to) {
      if (await sendFromHello(address, email, `partner-message:${last}:${reader}:${address}`)) sent = true;
    }
    if (!sent) return false;
    const col = reader === 'guest' ? 'guest_emailed_at' : 'host_emailed_at';
    await supabaseAdmin
      .from(TABLE)
      .update({ [col]: new Date().toISOString() })
      .in(
        'id',
        owed.map((m) => m.id),
      )
      .is(col, null);
    return true;
  } catch (err) {
    console.warn('[partner-messages] email failed:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

/**
 * The hourly sweep's part: a message whose email did not go, unread by its
 * reader, gets another try for MESSAGE_EMAIL_RETRY_DAYS. A message a minute
 * old is left to the send that is already on its way.
 */
export async function retryMessageEmails(now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - MESSAGE_EMAIL_RETRY_DAYS * 86_400_000).toISOString();
  const settled = new Date(now.getTime() - 2 * 60_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('request_id, author, guest_read_at, host_read_at, guest_emailed_at, host_emailed_at')
    .gte('created_at', since)
    .lte('created_at', settled)
    .or('and(guest_read_at.is.null,guest_emailed_at.is.null),and(host_read_at.is.null,host_emailed_at.is.null)')
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) {
    console.warn('[partner-messages] retry read failed:', error.message);
    return 0;
  }
  const due = new Map<string, Set<MessageReader>>();
  for (const m of (data ?? []) as Array<Pick<PartnerMessageRow, 'request_id' | 'author' | 'guest_read_at' | 'host_read_at' | 'guest_emailed_at' | 'host_emailed_at'>>) {
    for (const reader of recipientsOf(m.author)) {
      const waiting = reader === 'guest' ? !m.guest_read_at && !m.guest_emailed_at : !m.host_read_at && !m.host_emailed_at;
      if (!waiting) continue;
      const set = due.get(m.request_id) ?? new Set<MessageReader>();
      set.add(reader);
      due.set(m.request_id, set);
    }
  }
  let sent = 0;
  for (const [requestId, readers] of [...due].slice(0, 100)) {
    const row = await requestRow(requestId).catch(() => null);
    if (!row) continue;
    for (const reader of readers) if (await emailAboutMessages(row, reader, now)) sent++;
  }
  return sent;
}
