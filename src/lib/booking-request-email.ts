/**
 * Sends the guest's booking request emails (the copy is
 * src/lib/booking-request-copy.ts).
 *
 * From, CC'd to and reply-to Stay Cape Ann <hello@staycapeann.com>, like the
 * custom quote mail: the guest sees one brand address, the team's copy lands
 * in the hello@ inbox, and a reply joins the same thread. If Resend refuses
 * hello@ as the sender, it retries from RESEND_FROM_EMAIL with hello@ still on
 * CC and reply-to. Best-effort: returns false rather than throwing, and the
 * caller stamps the row only on a send, so the cron can retry a failure.
 */
import { sendTransactionalViaResend } from '@/lib/resend';
import { confirmedEmail, declinedEmail, expiredEmail, receiptEmail, type RequestEmail } from '@/lib/booking-request-copy';
import type { BookingRequestRow } from '@/lib/booking-requests';

const GUEST_EMAIL = 'hello@staycapeann.com';
const FROM_NAME = 'Stay Cape Ann';

export const SCA_SITE_ORIGIN = (process.env.SCA_PUBLIC_ORIGIN || 'https://staycapeann.com').replace(/\/$/, '');

async function sendToGuest(to: string, email: RequestEmail, idempotencyKey: string): Promise<boolean> {
  const base = { to, subject: email.subject, html: email.html, text: email.text, cc: GUEST_EMAIL, replyTo: GUEST_EMAIL, fromName: FROM_NAME, idempotencyKey };
  if (await sendTransactionalViaResend({ ...base, fromEmail: GUEST_EMAIL })) return true;
  const fallback = process.env.RESEND_FROM_EMAIL || '';
  if (!fallback || fallback === GUEST_EMAIL) return false;
  console.warn('[booking-request-email] send from hello@ failed; retrying from', fallback);
  return sendTransactionalViaResend({ ...base, fromEmail: fallback, idempotencyKey: `${idempotencyKey}:fallback` });
}

export async function sendRequestReceipt(row: BookingRequestRow, title: string | null): Promise<boolean> {
  return sendToGuest(row.guest_email, receiptEmail(row, { title, siteOrigin: SCA_SITE_ORIGIN }), `booking-request:${row.id}:receipt`);
}

/** The one email that closes a request: declined, or no answer in time. */
export async function sendRequestOutcome(row: BookingRequestRow, title: string | null): Promise<boolean> {
  if (row.status !== 'declined' && row.status !== 'expired') return false;
  const email = row.status === 'declined' ? declinedEmail(row, { title, siteOrigin: SCA_SITE_ORIGIN }) : expiredEmail(row, { title, siteOrigin: SCA_SITE_ORIGIN });
  return sendToGuest(row.guest_email, email, `booking-request:${row.id}:${row.status}`);
}

/** You're booked: only after the site reported the charge. */
export async function sendRequestConfirmation(row: BookingRequestRow, title: string | null): Promise<boolean> {
  if (row.status !== 'accepted' || row.hold_status !== 'captured' || row.hold_cents == null) return false;
  const email = confirmedEmail({ ...row, charged_cents: row.hold_cents }, { title, siteOrigin: SCA_SITE_ORIGIN });
  return sendToGuest(row.guest_email, email, `booking-request:${row.id}:confirmed`);
}
