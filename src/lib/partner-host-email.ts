/**
 * Mail to a partner home's host (the copy is src/lib/partner-host.ts): the
 * sign-in code, and the email that tells them a booking request landed.
 *
 * From and reply-to Stay Cape Ann <hello@staycapeann.com>, so a host's
 * reply reaches the office. If Resend refuses hello@ as the sender, it
 * retries from RESEND_FROM_EMAIL. Best-effort: returns false rather than
 * throwing. The request email stamps booking_requests.host_emailed_at only
 * on a send, so the hourly sweep sends one that failed.
 */
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendTransactionalViaResend } from '@/lib/resend';
import { SCA_SITE_ORIGIN } from '@/lib/booking-request-email';
import type { BookingRequestRow } from '@/lib/booking-requests';
import { hostCodeEmail, hostEmailsOf, hostNewRequestEmail, type HostEmail } from '@/lib/partner-host';

const HELLO = 'hello@staycapeann.com';

/** One email from hello@, the RESEND_FROM_EMAIL fallback after. Guest sign-in codes use it too (guest-trips-db.ts). */
export async function sendFromHello(to: string, email: HostEmail, idempotencyKey: string): Promise<boolean> {
  const base = { to, subject: email.subject, html: email.html, text: email.text, replyTo: HELLO, fromName: 'Stay Cape Ann', idempotencyKey };
  if (await sendTransactionalViaResend({ ...base, fromEmail: HELLO })) return true;
  const fallback = process.env.RESEND_FROM_EMAIL || '';
  if (!fallback || fallback === HELLO) return false;
  return sendTransactionalViaResend({ ...base, fromEmail: fallback, idempotencyKey: `${idempotencyKey}:fallback` });
}

export async function sendHostCode(email: string, code: string, codeId: string): Promise<boolean> {
  try {
    return await sendFromHello(email, hostCodeEmail(code), `partner-host-code:${codeId}`);
  } catch (err) {
    console.warn('[partner-host-email] code email failed:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

/**
 * Tell the home's host a request landed. Every email on the home's row gets
 * it; the row is stamped once any of them went.
 */
export async function emailHostAboutRequest(row: BookingRequestRow): Promise<boolean> {
  try {
    const { data: home, error } = await supabaseAdmin
      .from('properties')
      .select('id, name, title, kind, owner_emails')
      .eq('id', row.property_id)
      .eq('kind', 'partner')
      .maybeSingle();
    if (error || !home) return false;
    const h = home as { name: string | null; title: string | null; owner_emails: unknown };
    const email = hostNewRequestEmail(row, h.title ?? h.name, SCA_SITE_ORIGIN);
    let sent = false;
    for (const to of hostEmailsOf(h)) {
      if (await sendFromHello(to, email, `booking-request:${row.id}:host:${to}`)) sent = true;
    }
    if (!sent) return false;
    await supabaseAdmin.from('booking_requests').update({ host_emailed_at: new Date().toISOString() }).eq('id', row.id).is('host_emailed_at', null);
    return true;
  } catch (err) {
    console.warn('[partner-host-email] request email failed:', err instanceof Error ? err.message : String(err));
    return false;
  }
}
