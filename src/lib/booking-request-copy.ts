/**
 * What a guest reads about their booking request: the receipt when it
 * lands, the one email that closes it (declined, or no answer in time), and
 * the confirmation once the host said yes and the card was charged.
 *
 * Mail goes out from hello@staycapeann.com (src/lib/booking-request-email.ts),
 * so a reply joins the guest's thread there. The guest never sees an
 * internal name, a street address, the host's contact, the decline reason
 * the office typed, or the words Helm, Guesty or Stripe. Headings use the
 * listing title, as the site does.
 *
 * PURE MODULE: the email sender and the tests import it.
 */
import { displayTitle, fmtCents, fmtLongDate } from './sca-quotes-types.ts';
import { easternWhen, nightsOf, RESPONSE_WINDOW_HOURS, type BookingRequestRow } from './booking-requests.ts';

export type RequestEmail = { subject: string; text: string; html: string };

type Row = Pick<
  BookingRequestRow,
  'guest_first_name' | 'check_in' | 'check_out' | 'guests' | 'respond_by' | 'quoted_total_cents' | 'currency' | 'quote'
> &
  Partial<Pick<BookingRequestRow, 'hold_status' | 'hold_cents'>>;

/** The card hold on a request, if the home takes cards. */
function heldCents(r: Row): number | null {
  return r.hold_status && r.hold_status !== 'none' && r.hold_cents != null ? r.hold_cents : null;
}

/** What a closing email says about money. */
function nothingCharged(r: Row): string {
  return heldCents(r) == null
    ? 'Nothing was charged.'
    : 'Nothing was charged, and we are releasing the hold on your card now. Your bank may take a few days to clear it.';
}

export type CopyContext = {
  /** The listing title, e.g. "Stay at Rocky Neck". */
  title: string | null;
  /** staycapeann.com, for the "other homes" and "Your trips" links. */
  siteOrigin: string;
};

const GUEST_EMAIL = 'hello@staycapeann.com';
const GUEST_PHONE = '(978) 865-2575';

function first(name: string | null | undefined): string {
  return (name ?? '').trim().split(/[, ]/)[0] || 'there';
}

/** "2027-07-03" -> "July 3", no timezone rollback. */
function monthDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

/** "July 3 to July 10, 2027". */
export function datesLine(checkIn: string, checkOut: string): string {
  return `${monthDay(checkIn)} to ${fmtLongDate(checkOut)}`;
}

function staySummary(r: Row): string {
  const n = nightsOf(r.check_in, r.check_out);
  return `${datesLine(r.check_in, r.check_out)} (${n} night${n === 1 ? '' : 's'}, ${r.guests} guest${r.guests === 1 ? '' : 's'})`;
}

/** What the quoted total covers beyond the nights, from the stored breakdown. */
export function totalCovers(quote: Record<string, unknown> | null | undefined): string {
  const b = (quote?.breakdown ?? {}) as Record<string, unknown>;
  const cleaning = Number(b.cleaning_cents ?? 0) > 0;
  const tax = Number(b.tax_cents ?? 0) > 0;
  if (cleaning && tax) return ', cleaning and taxes included';
  if (cleaning) return ', cleaning included';
  if (tax) return ', taxes included';
  return '';
}

/** The search for the same dates, so a closed request still has somewhere to go. */
export function otherHomesUrl(siteOrigin: string, r: Pick<Row, 'check_in' | 'check_out' | 'guests'>): string {
  const q = new URLSearchParams({ checkIn: r.check_in, checkOut: r.check_out, guests: String(r.guests) });
  return `${siteOrigin.replace(/\/+$/, '')}/stays?${q.toString()}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const WRAP_OPEN =
  '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Inter, sans-serif; font-size: 15px; line-height: 1.6; color: #1e2e34; max-width: 560px;">';
const WRAP_CLOSE = '</div>';

const SIGN_OFF_TEXT = `Stay Cape Ann\n${GUEST_EMAIL} · ${GUEST_PHONE}`;
const SIGN_OFF_HTML = `<p style="margin-top: 28px;">Stay Cape Ann<br/><span style="color: #506068; font-size: 13px;">${GUEST_EMAIL} &middot; ${GUEST_PHONE}</span></p>`;

/** The guest's own page on the site: every request and stay under their email. */
export function tripsLink(siteOrigin: string): string {
  return `${siteOrigin.replace(/\/+$/, '')}/trips`;
}

/**
 * Paragraphs to an email. A paragraph is plain text, or [text, url, label?]
 * for a line that ends in a link ("See what is open" unless it says).
 */
function build(subject: string, paragraphs: Array<string | [string, string] | [string, string, string]>): RequestEmail {
  const text = [...paragraphs.map((p) => (typeof p === 'string' ? p : `${p[0]} ${p[1]}`)), SIGN_OFF_TEXT].join('\n\n');
  const html =
    WRAP_OPEN +
    paragraphs
      .map((p) =>
        typeof p === 'string'
          ? `<p>${escapeHtml(p)}</p>`
          : `<p>${escapeHtml(p[0])} <a href="${escapeHtml(p[1])}" style="color: #1e2e34;">${escapeHtml(p[2] ?? 'See what is open')}</a></p>`,
      )
      .join('') +
    SIGN_OFF_HTML +
    WRAP_CLOSE;
  return { subject, text, html };
}

/** "We have your request": sent the moment it lands. */
export function receiptEmail(r: Row, ctx: CopyContext): RequestEmail {
  const home = displayTitle(ctx.title) || 'the home';
  return build(`We have your request for ${home}`, [
    `Hi ${first(r.guest_first_name)},`,
    `Thanks for asking to stay at ${home}, ${staySummary(r)}.`,
    `This home is run by its own host, who answers every request within ${RESPONSE_WINDOW_HOURS} hours. You will hear from us by ${easternWhen(r.respond_by)} Eastern.`,
    heldCents(r) == null
      ? `Nothing has been charged. The quoted total is ${fmtCents(r.quoted_total_cents, r.currency)}${totalCovers(r.quote)}. If the host says yes, we will email you to confirm and pay.`
      : `We placed a hold of ${fmtCents(heldCents(r) as number, r.currency)}${totalCovers(r.quote)} on your card. You are charged only if the host says yes. If they can't, the hold is released.`,
    ['You can check on it any time, signed in with this email:', tripsLink(ctx.siteOrigin), 'Your trips'],
    'If anything changes, just reply to this email.',
  ]);
}

/** The host said no. The office's reason stays in Helm. */
export function declinedEmail(r: Row, ctx: CopyContext): RequestEmail {
  const home = displayTitle(ctx.title) || 'the home';
  return build(`About your request for ${home}`, [
    `Hi ${first(r.guest_first_name)},`,
    `The host of ${home} can't take ${datesLine(r.check_in, r.check_out)}, so your request is closed. ${nothingCharged(r)}`,
    ['Other homes may be open on your dates:', otherHomesUrl(ctx.siteOrigin, r)],
    'If you would like a hand finding one, reply to this email.',
  ]);
}

/** No answer inside the window. */
export function expiredEmail(r: Row, ctx: CopyContext): RequestEmail {
  const home = displayTitle(ctx.title) || 'the home';
  return build(`About your request for ${home}`, [
    `Hi ${first(r.guest_first_name)},`,
    `The host of ${home} wasn't able to confirm ${datesLine(r.check_in, r.check_out)} in time, so your request has closed. ${nothingCharged(r)}`,
    ['Other homes may be open on your dates:', otherHomesUrl(ctx.siteOrigin, r)],
    'If you would like a hand finding one, reply to this email.',
  ]);
}

/**
 * The host said yes and the card was charged. Sent once the site reports
 * the charge, never at the moment of the yes: a guest is told they are
 * booked only when the money is.
 */
export function confirmedEmail(r: Row & { charged_cents: number }, ctx: CopyContext): RequestEmail {
  const home = displayTitle(ctx.title) || 'the home';
  return build(`You're booked at ${home}`, [
    `Hi ${first(r.guest_first_name)},`,
    `Good news: the host said yes. You're booked at ${home}, ${staySummary(r)}.`,
    `We charged ${fmtCents(r.charged_cents, r.currency)}${totalCovers(r.quote)} to your card. The charge comes from the host's own account, so your statement may show their name.`,
    'Your host will be in touch before you arrive with directions and check-in details. If you have a question in the meantime, just reply to this email.',
    ['Your trip, with the cancellation policy and house rules you agreed to:', tripsLink(ctx.siteOrigin), 'Your trips'],
  ]);
}
