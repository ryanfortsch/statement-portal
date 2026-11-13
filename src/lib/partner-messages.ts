/**
 * Messages about a partner home's booking request, between the guest, the
 * home's host and the office (src/lib/partner-messages-db.ts reads and
 * writes them; partner_messages is the table).
 *
 * One conversation per request. It opens with the note the guest sent with
 * the request (booking_requests.message), and anyone of the three may write
 * while the request waits for an answer and, once it is booked, until
 * MESSAGE_DAYS_AFTER days after checkout. A declined, expired or withdrawn
 * request keeps its messages to read and takes no more.
 *
 * Until the stay is booked, an email address, a phone number or a web link
 * in a guest's or a host's message is replaced before it is stored, the same
 * rule that keeps the guest's contact off the host's list until then. The
 * booking, and our fee, stay on staycapeann.com. After the stay is booked
 * nothing is hidden, because both sides have each other's contact by then.
 *
 * The other side hears about a new message by email from hello@ with a link
 * to the conversation. Replying to that email reaches the office, and the
 * email says so.
 *
 * A partner guest never reaches the concierge, the Messaging inbox, Work or
 * Rosa: these messages live in their own table and nowhere else.
 *
 * PURE MODULE: the bridge routes and the tests import it.
 */
import { cleanMessage, easternShort, effectiveStatus, type BookingRequestRow } from './booking-requests.ts';
import { displayTitle } from './sca-quotes-types.ts';
import type { HostEmail } from './partner-host.ts';

export type MessageAuthor = 'guest' | 'host' | 'office';
export type MessageReader = 'guest' | 'host';

export const MESSAGE_MAX = 2000;
/** Days after checkout that a booked stay's conversation stays open. */
export const MESSAGE_DAYS_AFTER = 14;
/** Messages one side may send in one conversation in an hour. */
export const MESSAGES_PER_HOUR = 20;
/** The same words from the same side inside this window are one message (a double tap). */
export const DUPLICATE_WINDOW_MS = 2 * 60_000;
/** How long the hourly sweep keeps trying to email a message the other side has not read. */
export const MESSAGE_EMAIL_RETRY_DAYS = 3;
/** What a hidden email, phone number or link reads as. */
export const HIDDEN = '[shared once booked]';

export const PARTNER_MESSAGE_COLS =
  'id, request_id, author, author_email, body, masked, created_at, guest_read_at, host_read_at, guest_emailed_at, host_emailed_at';

export type PartnerMessageRow = {
  id: string;
  request_id: string;
  author: MessageAuthor;
  author_email: string | null;
  body: string;
  masked: boolean;
  created_at: string;
  guest_read_at: string | null;
  host_read_at: string | null;
  guest_emailed_at: string | null;
  host_emailed_at: string | null;
};

/** A message as typed, cleaned and capped, or null when there is nothing to send. */
export function cleanMessageBody(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const body = cleanMessage(raw.replace(/\r\n?/g, '\n'));
  return body ? body.slice(0, MESSAGE_MAX).trim() : null;
}

// Written plainly or spelled out ("jamie (at) gmail (dot) com"). A plain dot
// takes no space around it, so the word after a sentence's full stop stays.
const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+\s*(?:@|\(at\)|\[at\])\s*[A-Za-z0-9-]+(?:(?:\.|\s*\(dot\)\s*|\s*\[dot\]\s*)[A-Za-z0-9-]+)+/gi;
const LINK_IN_TEXT = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|co|us|info|biz|me|app|rentals|house|homes)\b(?:\/\S*)?/gi;
// A run of digits and the marks people type between them. Counted below:
// ten or more digits is a phone number, so a date (2026-11-20) or a door
// code never is.
const DIGIT_RUN = /\+?\(?\d[\d\s().-]{5,}\d/g;

function isPhoneRun(run: string): boolean {
  const digits = run.replace(/\D/g, '').length;
  if (digits >= 10 && digits <= 15) return true;
  // A seven-digit local number written the usual way: 555-1234.
  return digits === 7 && /^\d{3}[\s.-]\d{4}$/.test(run.trim());
}

/** The body with every email, phone number and link replaced, and whether anything was. */
export function maskContact(body: string): { body: string; masked: boolean } {
  let masked = false;
  const hide = () => {
    masked = true;
    return HIDDEN;
  };
  let out = body.replace(EMAIL_IN_TEXT, hide).replace(LINK_IN_TEXT, hide);
  out = out.replace(DIGIT_RUN, (run) => {
    if (!isPhoneRun(run)) return run;
    masked = true;
    // Keep what surrounded the number: "call 978 555 1234." stays a sentence.
    const lead = run.match(/^\s*/)?.[0] ?? '';
    const trail = run.match(/\s*$/)?.[0] ?? '';
    return `${lead}${HIDDEN}${trail}`;
  });
  return { body: out, masked };
}

/** The stay is booked: both sides have each other's contact, so nothing is hidden. */
export function isBooked(row: Pick<BookingRequestRow, 'status' | 'respond_by'>, now: Date): boolean {
  return effectiveStatus(row, now) === 'accepted';
}

function addDays(isoDay: string, days: number): string {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Can anyone write in this conversation now? While the request waits for an
 * answer, and once booked until MESSAGE_DAYS_AFTER days after checkout.
 * `today` is the Eastern day.
 */
export function canMessage(row: Pick<BookingRequestRow, 'status' | 'respond_by' | 'check_out'>, today: string, now: Date): boolean {
  const status = effectiveStatus(row, now);
  if (status === 'pending') return true;
  return status === 'accepted' && today <= addDays(row.check_out, MESSAGE_DAYS_AFTER);
}

/** Why the form is gone, in one sentence the page can show. */
export function closedLine(row: Pick<BookingRequestRow, 'status' | 'respond_by' | 'check_out'>, now: Date): string {
  const status = effectiveStatus(row, now);
  if (status === 'accepted') return 'This stay is over, so the conversation is closed. Write to hello@staycapeann.com if you need us.';
  return 'This request is closed, so the conversation is too. Write to hello@staycapeann.com if you need us.';
}

/** What gets stored: the body, hidden contact and all, before the stay is booked. */
export function bodyToStore(body: string, booked: boolean, author: MessageAuthor): { body: string; masked: boolean } {
  // The office writes as itself and may give our own contact; only the two sides are held to it.
  if (booked || author === 'office') return { body, masked: false };
  return maskContact(body);
}

function oldestFirst(a: Pick<PartnerMessageRow, 'created_at' | 'id'>, b: Pick<PartnerMessageRow, 'created_at' | 'id'>): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export type MessageView = {
  id: string;
  author: MessageAuthor;
  /** Written by the one reading. */
  mine: boolean;
  /** "You", "Sarah K.", "Your host", "Stay Cape Ann". */
  label: string;
  body: string;
  /** Something in it was hidden until the stay is booked. */
  masked: boolean;
  at: string;
  /** "Fri 3:40 PM", Eastern. */
  at_label: string;
  /** Not opened by the one reading yet. */
  unread: boolean;
};

export type ThreadNames = {
  /** The guest as the host may see them: "Sarah K." before the stay is booked. */
  guest: string;
  /** The host as the guest sees them: a first name, or "Your host". */
  host: string;
};

/** The host's first name for the guest, or "Your host". */
export function hostLabel(ownerFull: string | null | undefined): string {
  const firstName = (ownerFull ?? '').trim().split(/\s+/)[0] ?? '';
  // A household ("Sam and Pat Smith") or a company reads better as the role.
  if (!firstName || /^(the|mr|mrs|ms|dr)\.?$/i.test(firstName) || /\b(and|&)\b/i.test(ownerFull ?? '') || /\b(llc|inc|trust)\b/i.test(ownerFull ?? '')) {
    return 'Your host';
  }
  return firstName;
}

function labelFor(author: MessageAuthor, viewer: MessageReader | 'office', names: ThreadNames): string {
  if (author === viewer) return 'You';
  if (author === 'office') return 'Stay Cape Ann';
  if (author === 'guest') return names.guest;
  return viewer === 'office' ? 'Host' : names.host;
}

export function messageView(m: PartnerMessageRow, viewer: MessageReader | 'office', names: ThreadNames): MessageView {
  const unread = viewer === 'guest' ? m.author !== 'guest' && !m.guest_read_at : viewer === 'host' ? m.author !== 'host' && !m.host_read_at : false;
  return {
    id: m.id,
    author: m.author,
    mine: m.author === viewer,
    label: labelFor(m.author, viewer, names),
    body: m.body,
    masked: m.masked,
    at: m.created_at,
    at_label: easternShort(m.created_at),
    unread,
  };
}

/**
 * The conversation as one reader sees it, oldest first: the note the guest
 * sent with the request, then every message. The note is hidden the same way
 * before the stay is booked when the host reads it.
 */
export function threadView(
  request: Pick<BookingRequestRow, 'id' | 'message' | 'created_at' | 'status' | 'respond_by'>,
  rows: PartnerMessageRow[],
  viewer: MessageReader | 'office',
  names: ThreadNames,
  now: Date,
): MessageView[] {
  const out: MessageView[] = [];
  const note = (request.message ?? '').trim();
  if (note) {
    const shown = viewer === 'host' && !isBooked(request, now) ? maskContact(note) : { body: note, masked: false };
    out.push({
      id: `request-${request.id}`,
      author: 'guest',
      mine: viewer === 'guest',
      label: viewer === 'guest' ? 'You' : names.guest,
      body: shown.body,
      masked: shown.masked,
      at: request.created_at,
      at_label: easternShort(request.created_at),
      unread: false,
    });
  }
  const sorted = rows.slice().sort(oldestFirst);
  for (const m of sorted) out.push(messageView(m, viewer, names));
  return out;
}

export type ThreadCount = { messages: number; unread: number };

/** The counts on a list row: messages written in the conversation and how many the reader has not opened. */
export function threadCounts(rows: Array<Pick<PartnerMessageRow, 'request_id' | 'author' | 'guest_read_at' | 'host_read_at'>>, reader: MessageReader | 'office'): Map<string, ThreadCount> {
  const out = new Map<string, ThreadCount>();
  for (const m of rows) {
    const c = out.get(m.request_id) ?? { messages: 0, unread: 0 };
    c.messages++;
    if (reader === 'guest' && m.author !== 'guest' && !m.guest_read_at) c.unread++;
    if (reader === 'host' && m.author !== 'host' && !m.host_read_at) c.unread++;
    out.set(m.request_id, c);
  }
  return out;
}

/** Same side, same words, a moment ago: the second tap of a double tap. */
export function isDuplicate(
  recent: Array<Pick<PartnerMessageRow, 'author' | 'body' | 'created_at'>>,
  author: MessageAuthor,
  body: string,
  now: Date,
): boolean {
  return recent.some((m) => m.author === author && m.body === body && now.getTime() - Date.parse(m.created_at) < DUPLICATE_WINDOW_MS);
}

/** Who a message is news to. The office's goes to both. */
export function recipientsOf(author: MessageAuthor): MessageReader[] {
  if (author === 'guest') return ['host'];
  if (author === 'host') return ['guest'];
  return ['guest', 'host'];
}

/** The messages one side still has to hear about: not theirs, not opened, not emailed. */
export function owedTo(rows: PartnerMessageRow[], reader: MessageReader): PartnerMessageRow[] {
  return rows
    .filter((m) => m.author !== reader && recipientsOf(m.author).includes(reader))
    .filter((m) => (reader === 'guest' ? !m.guest_read_at && !m.guest_emailed_at : !m.host_read_at && !m.host_emailed_at))
    .sort(oldestFirst);
}

// ─── Email ─────────────────────────────────────────────────────────────────

const HELLO = 'hello@staycapeann.com';
const PHONE = '(978) 865-2575';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const WRAP_OPEN =
  '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Inter, sans-serif; font-size: 15px; line-height: 1.6; color: #1e2e34; max-width: 560px;">';
const SIGN_OFF_TEXT = `Stay Cape Ann\n${HELLO} · ${PHONE}`;
const SIGN_OFF_HTML = `<p style="margin-top: 28px;">Stay Cape Ann<br/><span style="color: #506068; font-size: 13px;">${HELLO} &middot; ${PHONE}</span></p>`;

export function hostThreadUrl(siteOrigin: string, requestId: string): string {
  return `${siteOrigin.replace(/\/+$/, '')}/host/requests/${requestId}`;
}

export function tripThreadUrl(siteOrigin: string, requestId: string): string {
  return `${siteOrigin.replace(/\/+$/, '')}/trips/${requestId}`;
}

/**
 * The email telling one side a message is waiting: who wrote, the words, and
 * the link to answer on staycapeann.com. A reply to the email reaches the
 * office, and it says so, so nobody waits on an answer that went elsewhere.
 */
export function newMessageEmail(input: {
  to: MessageReader;
  homeTitle: string | null;
  messages: Array<{ label: string; body: string }>;
  link: string;
  /** Who the reader would be answering: "Sarah K.", "your host". */
  other: string;
}): HostEmail {
  const home = displayTitle(input.homeTitle) || (input.to === 'host' ? 'your home' : 'your trip');
  const authors = [...new Set(input.messages.map((m) => m.label))];
  const subject =
    authors.length === 1 && authors[0] === 'Stay Cape Ann'
      ? `A message from Stay Cape Ann about ${home}`
      : input.to === 'host'
        ? `${authors[0]} wrote about ${home}`
        : `A message about your trip to ${home}`;
  const answer = `Replies to this email reach the Stay Cape Ann office, not ${input.other}.`;

  const text = [
    `New on your conversation about ${home}:`,
    ...input.messages.map((m) => `${m.label}:\n${m.body}`),
    `Read and answer it on Stay Cape Ann: ${input.link}`,
    answer,
    SIGN_OFF_TEXT,
  ].join('\n\n');
  const html =
    WRAP_OPEN +
    `<p>New on your conversation about ${escapeHtml(home)}:</p>` +
    input.messages
      .map(
        (m) =>
          `<p style="margin: 0 0 4px; font-size: 13px; color: #506068;">${escapeHtml(m.label)}</p>` +
          `<p style="margin: 0 0 16px; border-left: 2px solid #d8d2c4; padding-left: 12px;">${escapeHtml(m.body).replace(/\n/g, '<br/>')}</p>`,
      )
      .join('') +
    `<p><a href="${escapeHtml(input.link)}" style="color: #1e2e34;">Read and answer it on Stay Cape Ann</a></p>` +
    `<p style="color: #506068; font-size: 13px;">${escapeHtml(answer)}</p>` +
    SIGN_OFF_HTML +
    '</div>';
  return { subject, text, html };
}
