/**
 * Guest and staff messages for the Stay Cape Ann custom quote flow.
 *
 *   sendQuoteLinkEmail          staff sends the guest their quote link
 *   sendQuoteSms                same, by text on the GUESTS line
 *   sendQuoteAcceptedStaffAlert staycapeann.com reported a paid acceptance
 *   sendQuoteAcceptFailedStaffAlert  the guest tried to pay and something broke
 *   sendBalanceReminderEmail / sendBalanceReminderSms  split plan, balance due
 *
 * Sender is "Stay Cape Ann <allie@risingtidestr.com>", brand name on the
 * front and the Rising Tide address behind it, same as agreement-email.ts.
 * SMS goes out ONLY on the GUESTS line (quoFromNumber('guests')): a quote
 * is a guest conversation, and the reply lands where Allie reads guest
 * texts. All sends are best-effort and return { ok, reason } rather than
 * throwing, so a Resend or Quo hiccup never loses a saved quote.
 *
 * The guest never sees an internal name, a street address, "Guesty",
 * "Stripe" or "Helm" in any of this copy. Headings use displayTitle().
 */
import { sendTransactionalViaResend } from '@/lib/resend';
import { normalizePhone, quoFromNumber, sendMessage } from '@/lib/quo';
import { quoteGuestUrl } from '@/lib/sca-quotes';
import { displayTitle, fmtCents, fmtLongDate, fmtShortDate, todayInEastern, type ScaQuoteRow } from '@/lib/sca-quotes-types';

const FROM_NAME = 'Stay Cape Ann';
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'allie@risingtidestr.com';
const ALLIE_CC = 'allie@risingtidestr.com';
const GUEST_PHONE = '(978) 865-2575';

const STAFF_NOTIFY = (process.env.STAFF_NOTIFY_EMAILS || 'allie@risingtidestr.com,dotti@risingtidestr.com')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean);

function firstName(name: string | null | undefined): string {
  if (!name) return 'there';
  return name.trim().split(/[, ]/)[0] || 'there';
}

const AFFILIATION_FOOT_HTML =
  '<p style="margin-top: 28px; color: #506068; font-size: 12px;">Stay Cape Ann is the guest-facing brand of Rising Tide (Rising Tide STR, LLC). Charges may appear on your statement from Rising Tide STR.</p>';
const AFFILIATION_FOOT_TEXT =
  'Stay Cape Ann is the guest-facing brand of Rising Tide (Rising Tide STR, LLC). Charges may appear on your statement from Rising Tide STR.';

const SIGN_OFF_HTML = '<p style="margin-top: 28px;">Allie O&rsquo;Brien<br/>Stay Cape Ann &middot; Rising Tide</p>';
const SIGN_OFF_TEXT = `Allie O'Brien\nStay Cape Ann · Rising Tide`;

const HTML_WRAP_OPEN =
  '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Inter, sans-serif; font-size: 15px; line-height: 1.6; color: #1e2e34; max-width: 560px;">';
const HTML_WRAP_CLOSE = '</div>';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Operator-typed text into HTML: escaped, line breaks preserved. */
function paragraphsHtml(s: string): string {
  return s
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

/** "2026-09-21T15:00:00Z" -> "September 21, 2026" in Eastern time. */
function expiresLongDate(iso: string): string {
  return fmtLongDate(todayInEastern(new Date(iso)));
}

function guestName(q: ScaQuoteRow): string {
  return `${q.guest_first_name} ${q.guest_last_name}`.trim() || 'Guest';
}

function datesLine(q: ScaQuoteRow): string {
  return `${fmtShortDate(q.check_in)} to ${fmtShortDate(q.check_out)}`;
}

function toE164(phone: string): string {
  return phone.startsWith('+') ? phone : `+1${normalizePhone(phone)}`;
}

/**
 * The GUESTS line, or null when Quo is not configured. Mirrors the
 * resolveQuoFrom guard in field-notify.ts: never fall back to "whatever
 * number Quo lists first".
 */
function resolveGuestLine(): string | null {
  if (!process.env.QUO_API_KEY) return null;
  return quoFromNumber('guests');
}

function quoFailure(err: unknown): { ok: false; reason: string } {
  const msg = err instanceof Error ? err.message : String(err);
  // A 402 from Quo is the prepaid balance running out. Billing, not code.
  if (/\(402\)/.test(msg)) return { ok: false, reason: 'quo balance exhausted' };
  return { ok: false, reason: msg.slice(0, 200) };
}

// ─── Guest: the quote link ──────────────────────────────────────────────────

/** Staff sends the guest their quote. */
export async function sendQuoteLinkEmail(args: { quote: ScaQuoteRow }): Promise<{ ok: boolean; reason?: string }> {
  const q = args.quote;
  if (!q.guest_email) return { ok: false, reason: 'no guest email on quote' };

  const url = quoteGuestUrl(q.token);
  const title = displayTitle(q.property_title);
  const greeting = firstName(q.guest_first_name);
  const nightsLabel = `${q.nights} night${q.nights === 1 ? '' : 's'}`;
  const guestsLabel = `${q.guests} guest${q.guests === 1 ? '' : 's'}`;
  const split = q.payment_plan === 'split' && q.deposit_cents != null && q.balance_cents != null && q.balance_due_on;
  const total = fmtCents(q.total_cents, q.currency);

  const summaryRows: [string, string][] = [
    ['Dates', `${fmtLongDate(q.check_in)} to ${fmtLongDate(q.check_out)}`],
    ['Stay', `${nightsLabel}, ${guestsLabel}`],
    ['Total', total],
  ];
  if (split) {
    summaryRows.push([
      'Payment',
      `Deposit today ${fmtCents(q.deposit_cents!, q.currency)}, balance ${fmtCents(q.balance_cents!, q.currency)} by ${fmtLongDate(q.balance_due_on!)}`,
    ]);
  }

  const summaryHtml =
    '<table style="border-collapse: collapse; margin: 18px 0; font-size: 14px;">' +
    summaryRows
      .map(
        ([k, v]) =>
          `<tr><td style="padding: 4px 18px 4px 0; color: #506068; vertical-align: top;">${escapeHtml(k)}</td><td style="padding: 4px 0;">${escapeHtml(v)}</td></tr>`,
      )
      .join('') +
    '</table>';
  const summaryText = summaryRows.map(([k, v]) => `${k}: ${v}`).join('\n');

  const expiresLine = q.expires_at ? `This quote is good through ${expiresLongDate(q.expires_at)}.` : '';

  const html =
    HTML_WRAP_OPEN +
    `<p>Hi ${escapeHtml(greeting)},</p>` +
    (q.message ? paragraphsHtml(q.message) : `<p>Here is your quote for a stay at <strong>${escapeHtml(title)}</strong>.</p>`) +
    summaryHtml +
    `<p><a href="${url}" style="color: #c85a3a; font-weight: 600;">Review and reserve</a></p>` +
    (expiresLine ? `<p>${escapeHtml(expiresLine)}</p>` : '') +
    `<p>Questions? Just reply to this email or call ${GUEST_PHONE}.</p>` +
    SIGN_OFF_HTML +
    AFFILIATION_FOOT_HTML +
    HTML_WRAP_CLOSE;

  const text =
    `Hi ${greeting},\n\n` +
    (q.message ? `${q.message.trim()}\n\n` : `Here is your quote for a stay at ${title}.\n\n`) +
    `${summaryText}\n\n` +
    `Review and reserve:\n${url}\n\n` +
    (expiresLine ? `${expiresLine}\n\n` : '') +
    `Questions? Just reply to this email or call ${GUEST_PHONE}.\n\n` +
    `${SIGN_OFF_TEXT}\n\n` +
    `${AFFILIATION_FOOT_TEXT}\n`;

  const ok = await sendTransactionalViaResend({
    to: q.guest_email,
    cc: ALLIE_CC,
    fromName: FROM_NAME,
    fromEmail: FROM_EMAIL,
    subject: `Your quote for ${title}, ${datesLine(q)}`,
    html,
    text,
  });
  return ok ? { ok: true } : { ok: false, reason: 'resend send failed' };
}

/** Same link by text, on the GUESTS line. */
export async function sendQuoteSms(args: { quote: ScaQuoteRow }): Promise<{ ok: boolean; reason?: string }> {
  const q = args.quote;
  if (!q.guest_phone) return { ok: false, reason: 'no guest phone on quote' };
  const from = resolveGuestLine();
  if (!from) return { ok: false, reason: 'quo not configured' };

  const first = firstName(q.guest_first_name);
  const content =
    `Hi ${first}, it's Allie from Stay Cape Ann. Here is your quote for ${displayTitle(q.property_title)}, ` +
    `${datesLine(q)} (${fmtCents(q.total_cents, q.currency)} total): ${quoteGuestUrl(q.token)}` +
    (q.expires_at ? ` It is good through ${expiresLongDate(q.expires_at)}.` : '') +
    ` Reply here with any questions.`;

  try {
    await sendMessage({ from, to: toE164(q.guest_phone), content });
    return { ok: true };
  } catch (err) {
    return quoFailure(err);
  }
}

// ─── Guest: balance reminder ────────────────────────────────────────────────

export async function sendBalanceReminderEmail(args: { quote: ScaQuoteRow }): Promise<{ ok: boolean; reason?: string }> {
  const q = args.quote;
  if (!q.guest_email) return { ok: false, reason: 'no guest email on quote' };
  if (q.balance_cents == null || !q.balance_due_on) return { ok: false, reason: 'no balance on quote' };

  const url = quoteGuestUrl(q.token);
  const title = displayTitle(q.property_title);
  const greeting = firstName(q.guest_first_name);
  const amount = fmtCents(q.balance_cents, q.currency);
  const due = fmtLongDate(q.balance_due_on);

  const html =
    HTML_WRAP_OPEN +
    `<p>Hi ${escapeHtml(greeting)},</p>` +
    `<p>A quick note that the balance for your stay at <strong>${escapeHtml(title)}</strong> (${escapeHtml(datesLine(q))}) is due by <strong>${escapeHtml(due)}</strong>.</p>` +
    `<p>Balance due: <strong>${escapeHtml(amount)}</strong></p>` +
    `<p><a href="${url}" style="color: #c85a3a; font-weight: 600;">Pay the balance</a></p>` +
    `<p>Questions? Just reply to this email or call ${GUEST_PHONE}.</p>` +
    SIGN_OFF_HTML +
    AFFILIATION_FOOT_HTML +
    HTML_WRAP_CLOSE;
  const text =
    `Hi ${greeting},\n\n` +
    `A quick note that the balance for your stay at ${title} (${datesLine(q)}) is due by ${due}.\n\n` +
    `Balance due: ${amount}\n\n` +
    `Pay the balance:\n${url}\n\n` +
    `Questions? Just reply to this email or call ${GUEST_PHONE}.\n\n` +
    `${SIGN_OFF_TEXT}\n\n` +
    `${AFFILIATION_FOOT_TEXT}\n`;

  const ok = await sendTransactionalViaResend({
    to: q.guest_email,
    cc: ALLIE_CC,
    fromName: FROM_NAME,
    fromEmail: FROM_EMAIL,
    subject: `Balance due ${due}: ${title}, ${datesLine(q)}`,
    html,
    text,
  });
  return ok ? { ok: true } : { ok: false, reason: 'resend send failed' };
}

export async function sendBalanceReminderSms(args: { quote: ScaQuoteRow }): Promise<{ ok: boolean; reason?: string }> {
  const q = args.quote;
  if (!q.guest_phone) return { ok: false, reason: 'no guest phone on quote' };
  if (q.balance_cents == null || !q.balance_due_on) return { ok: false, reason: 'no balance on quote' };
  const from = resolveGuestLine();
  if (!from) return { ok: false, reason: 'quo not configured' };

  const content =
    `Hi ${firstName(q.guest_first_name)}, it's Allie from Stay Cape Ann. The balance of ${fmtCents(q.balance_cents, q.currency)} ` +
    `for ${displayTitle(q.property_title)}, ${datesLine(q)}, is due by ${fmtLongDate(q.balance_due_on)}. ` +
    `Pay it here: ${quoteGuestUrl(q.token)} Reply with any questions.`;

  try {
    await sendMessage({ from, to: toE164(q.guest_phone), content });
    return { ok: true };
  } catch (err) {
    return quoFailure(err);
  }
}

// ─── Staff alerts ───────────────────────────────────────────────────────────

async function sendStaff(subject: string, html: string, text: string): Promise<{ ok: boolean; reason?: string }> {
  if (STAFF_NOTIFY.length === 0) return { ok: false, reason: 'no staff recipients configured' };
  const results = await Promise.all(
    STAFF_NOTIFY.map((to) =>
      sendTransactionalViaResend({ to, fromName: 'Stay Cape Ann (Helm)', fromEmail: FROM_EMAIL, subject, html, text }),
    ),
  );
  return results.some((r) => !r) ? { ok: false, reason: 'one or more staff notifications failed' } : { ok: true };
}

/** Guesty's own total vs what the guest paid, when they disagree by more than a dollar. */
function guestyMismatchLine(q: ScaQuoteRow): string | null {
  if (q.guesty_total_cents == null) return null;
  if (Math.abs(q.guesty_total_cents - q.total_cents) <= 100) return null;
  return (
    `Guesty computed ${fmtCents(q.guesty_total_cents, q.currency)} for this reservation; the guest paid ` +
    `${fmtCents(q.total_cents, q.currency)} in total. Check the reservation's taxes in Guesty.`
  );
}

/** staycapeann.com reported the guest paid and the reservation landed. */
export async function sendQuoteAcceptedStaffAlert(args: {
  quote: ScaQuoteRow;
  origin: string;
  /** 'accepted' (full or deposit leg) or 'balance' (the second leg of a split). */
  leg?: 'accepted' | 'balance';
}): Promise<{ ok: boolean; reason?: string }> {
  const q = args.quote;
  const leg = args.leg ?? 'accepted';
  const helmUrl = `${args.origin}/guests/quotes/${q.id}`;
  const who = guestName(q);
  const paid =
    leg === 'balance'
      ? fmtCents(q.balance_cents ?? 0, q.currency)
      : q.payment_plan === 'split'
        ? `${fmtCents(q.deposit_cents ?? 0, q.currency)} deposit (balance ${fmtCents(q.balance_cents ?? 0, q.currency)} by ${q.balance_due_on ? fmtLongDate(q.balance_due_on) : 'TBD'})`
        : fmtCents(q.total_cents, q.currency);
  const propertyLabel = q.property_internal_name
    ? `${q.property_internal_name} (${displayTitle(q.property_title)})`
    : displayTitle(q.property_title);
  const warning = leg === 'accepted' ? guestyMismatchLine(q) : null;
  const headline =
    leg === 'balance'
      ? `${who} paid the balance for ${propertyLabel}`
      : `${who} accepted the quote for ${propertyLabel}`;

  const html =
    HTML_WRAP_OPEN +
    `<p><strong>${escapeHtml(headline)}</strong> (${escapeHtml(datesLine(q))}, ${q.nights} night${q.nights === 1 ? '' : 's'}, ${q.guests} guest${q.guests === 1 ? '' : 's'}).</p>` +
    `<p>Paid: ${escapeHtml(paid)}<br/>` +
    `Confirmation code: ${escapeHtml(q.guesty_confirmation_code || '(none yet)')}<br/>` +
    `Reservation id: ${escapeHtml(q.guesty_reservation_id || '(none yet)')}</p>` +
    (warning ? `<p style="color: #c85a3a; font-weight: 600;">${escapeHtml(warning)}</p>` : '') +
    `<p><a href="${helmUrl}" style="color: #c85a3a; font-weight: 600;">${helmUrl}</a></p>` +
    HTML_WRAP_CLOSE;
  const text =
    `${headline} (${datesLine(q)}, ${q.nights} nights, ${q.guests} guests).\n\n` +
    `Paid: ${paid}\nConfirmation code: ${q.guesty_confirmation_code || '(none yet)'}\nReservation id: ${q.guesty_reservation_id || '(none yet)'}\n\n` +
    (warning ? `${warning}\n\n` : '') +
    `${helmUrl}\n`;

  return sendStaff(
    leg === 'balance' ? `Balance paid: ${who}, ${propertyLabel}` : `Quote accepted: ${who}, ${propertyLabel}`,
    html,
    text,
  );
}

/** The guest tried to pay and a stage failed. Someone may need to finish it by hand. */
export async function sendQuoteAcceptFailedStaffAlert(args: {
  quote: ScaQuoteRow;
  origin: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const q = args.quote;
  const helmUrl = `${args.origin}/guests/quotes/${q.id}`;
  const who = guestName(q);
  const propertyLabel = q.property_internal_name
    ? `${q.property_internal_name} (${displayTitle(q.property_title)})`
    : displayTitle(q.property_title);
  const error = q.accept_error || 'unknown error';

  const html =
    HTML_WRAP_OPEN +
    `<p><strong>${escapeHtml(who)}</strong> tried to accept the quote for <strong>${escapeHtml(propertyLabel)}</strong> (${escapeHtml(datesLine(q))}) and it did not complete.</p>` +
    `<p style="font-family: ui-monospace, Menlo, monospace; font-size: 13px; color: #c85a3a;">${escapeHtml(error)}</p>` +
    `<p>If the card was charged, staycapeann.com voided or refunded it before reporting the failure. Check Stripe and Guesty, then finish by hand or ask the guest to try again.</p>` +
    `<p><a href="${helmUrl}" style="color: #c85a3a; font-weight: 600;">${helmUrl}</a></p>` +
    HTML_WRAP_CLOSE;
  const text =
    `${who} tried to accept the quote for ${propertyLabel} (${datesLine(q)}) and it did not complete.\n\n` +
    `${error}\n\n` +
    `If the card was charged, staycapeann.com voided or refunded it before reporting the failure. Check Stripe and Guesty, then finish by hand or ask the guest to try again.\n\n` +
    `${helmUrl}\n`;

  return sendStaff(`Quote accept failed: ${who}, ${propertyLabel}`, html, text);
}
