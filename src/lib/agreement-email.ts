/**
 * Transactional emails for the guest rental agreement flow. Mirrors
 * contract-email.ts (the owner management contract) with the guest-facing
 * Stay Cape Ann voice:
 *
 *   1. sendAgreementLinkEmail — staff sends the guest their signing link.
 *   2. After the guest signs at /agreement/<token>:
 *      sendAgreementSignedCopyEmail (guest gets the signed PDF) +
 *      sendAgreementStaffAlert (allie@ + dotti@ get the countersign nudge).
 *   3. After staff countersigns: sendAgreementExecutedEmail (guest gets the
 *      fully-executed PDF).
 *
 * Sender is "Stay Cape Ann <allie@risingtidestr.com>" — brand name on the
 * front, Rising Tide address behind it, which is exactly the affiliation
 * story the agreement itself tells. All sends are best-effort: failures
 * return { ok: false, reason } and never throw, so a Resend outage can't
 * lose a signature that's already persisted.
 */
import { sendTransactionalViaResend } from '@/lib/resend';
import { agreementPdfFilename } from '@/lib/agreement-pdf';
import { fmtAgreementDate, fmtAgreementMoney } from '@/lib/agreement-base';
import type { GuestAgreementRow } from '@/lib/agreement-types';

const FROM_NAME = 'Stay Cape Ann';
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'allie@risingtidestr.com';
const ALLIE_CC = 'allie@risingtidestr.com';

const STAFF_NOTIFY = (process.env.STAFF_NOTIFY_EMAILS || 'allie@risingtidestr.com,dotti@risingtidestr.com')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean);

function firstName(name: string | null | undefined): string {
  if (!name) return 'there';
  return name.trim().split(/[, ]/)[0] || 'there';
}

const AFFILIATION_FOOT_HTML =
  '<p style="margin-top: 28px; color: #506068; font-size: 12px;">Stay Cape Ann is the guest-facing brand of Rising Tide Property Management (Rising Tide STR, LLC). Charges may appear on your statement from Rising Tide STR.</p>';
const AFFILIATION_FOOT_TEXT =
  'Stay Cape Ann is the guest-facing brand of Rising Tide Property Management (Rising Tide STR, LLC). Charges may appear on your statement from Rising Tide STR.';

/**
 * Fetch the agreement PDF through /api/agreement-pdf over HTTP — same
 * sidestep as fetchContractPdf: the API route has the chromium binary
 * traced into its bundle; calling the renderer inline from a server
 * action does not. The signing token authorizes the session-less
 * server-to-server request.
 */
export async function fetchAgreementPdf(args: {
  agreementId: string;
  token: string;
  origin: string;
}): Promise<Buffer> {
  const url =
    `${args.origin}/api/agreement-pdf?id=${encodeURIComponent(args.agreementId)}` +
    `&token=${encodeURIComponent(args.token)}`;
  const headers: Record<string, string> = {};
  const bypass = process.env.VERCEL_PROTECTION_BYPASS;
  if (bypass) {
    headers['x-vercel-protection-bypass'] = bypass;
    headers['x-vercel-set-bypass-cookie'] = 'true';
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`agreement-pdf fetch ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Staff sends the guest their signing link. */
export async function sendAgreementLinkEmail(args: {
  agreement: GuestAgreementRow;
  origin: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const { agreement: a, origin } = args;
  if (!a.guest_email) return { ok: false, reason: 'no guest_email on agreement' };

  const signUrl = `${origin}/agreement/${a.signing_token}`;
  const greeting = firstName(a.guest_name);
  const stayLine = `${fmtAgreementDate(a.stay_start)} to ${fmtAgreementDate(a.stay_end)}`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 15px; line-height: 1.6; color: #1e2e34; max-width: 560px;">
      <p>Hi ${greeting},</p>
      <p>Here is the rental agreement for your stay at <strong>${a.property_address}, ${a.property_city}</strong> (${stayLine}).</p>
      <p>Please review and sign it online — it takes about two minutes:</p>
      <p><a href="${signUrl}" style="color: #c85a3a; font-weight: 600;">Review &amp; sign your rental agreement</a></p>
      <p>Once you sign, you'll receive a copy for your records, and we'll countersign and send the final version.</p>
      <p>Questions? Just reply to this email or call ${'978-387-1573'}.</p>
      <p style="margin-top: 28px;">Allie O&rsquo;Brien<br/>Stay Cape Ann &middot; Rising Tide Property Management</p>
      ${AFFILIATION_FOOT_HTML}
    </div>
  `;
  const text =
    `Hi ${greeting},\n\n` +
    `Here is the rental agreement for your stay at ${a.property_address}, ${a.property_city} (${stayLine}).\n\n` +
    `Please review and sign it online:\n${signUrl}\n\n` +
    `Once you sign, you'll receive a copy for your records, and we'll countersign and send the final version.\n\n` +
    `Questions? Just reply to this email or call 978-387-1573.\n\n` +
    `Allie O'Brien\nStay Cape Ann · Rising Tide Property Management\n\n` +
    `${AFFILIATION_FOOT_TEXT}\n`;

  const ok = await sendTransactionalViaResend({
    to: a.guest_email,
    cc: ALLIE_CC,
    fromName: FROM_NAME,
    fromEmail: FROM_EMAIL,
    subject: `Your rental agreement for ${a.property_address}`,
    html,
    text,
  });
  return ok ? { ok: true } : { ok: false, reason: 'resend send failed' };
}

/** Guest just signed — send them the signed copy. */
export async function sendAgreementSignedCopyEmail(args: {
  agreement: GuestAgreementRow;
  origin: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const { agreement: a, origin } = args;
  if (!a.guest_email) return { ok: false, reason: 'no guest_email on agreement' };

  let pdf: Buffer;
  try {
    pdf = await fetchAgreementPdf({ agreementId: a.id, token: a.signing_token, origin });
  } catch (err) {
    console.error(
      `[agreement-email] PDF fetch failed (signed copy) for ${a.id}:`,
      err instanceof Error ? err.message : String(err),
    );
    return { ok: false, reason: 'pdf fetch failed' };
  }

  const greeting = firstName(a.guest_name);
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 15px; line-height: 1.6; color: #1e2e34; max-width: 560px;">
      <p>Hi ${greeting},</p>
      <p>Thanks for signing the rental agreement for <strong>${a.property_address}</strong>. Attached is a copy showing your signature on file.</p>
      <p>We'll countersign shortly and send back the fully executed version for your records.</p>
      <p>We're looking forward to hosting you.</p>
      <p style="margin-top: 28px;">Allie O&rsquo;Brien<br/>Stay Cape Ann &middot; Rising Tide Property Management</p>
      ${AFFILIATION_FOOT_HTML}
    </div>
  `;
  const text =
    `Hi ${greeting},\n\n` +
    `Thanks for signing the rental agreement for ${a.property_address}. Attached is a copy showing your signature on file.\n\n` +
    `We'll countersign shortly and send back the fully executed version for your records.\n\n` +
    `We're looking forward to hosting you.\n\n` +
    `Allie O'Brien\nStay Cape Ann · Rising Tide Property Management\n\n` +
    `${AFFILIATION_FOOT_TEXT}\n`;

  const ok = await sendTransactionalViaResend({
    to: a.guest_email,
    cc: ALLIE_CC,
    fromName: FROM_NAME,
    fromEmail: FROM_EMAIL,
    subject: `Your signed rental agreement for ${a.property_address}`,
    html,
    text,
    attachments: [
      { filename: agreementPdfFilename(a.property_address, a.guest_name), content: pdf.toString('base64') },
    ],
  });
  return ok ? { ok: true } : { ok: false, reason: 'resend send failed' };
}

/** Internal alert: a guest signed, a countersign is waiting in Helm. */
export async function sendAgreementStaffAlert(args: {
  agreement: GuestAgreementRow;
  origin: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const { agreement: a, origin } = args;
  if (STAFF_NOTIFY.length === 0) return { ok: false, reason: 'no staff recipients configured' };

  const helmUrl = `${origin}/guests/agreements/${a.id}`;
  const signerName = a.guest_signed_name || a.guest_name;
  const signedAtPretty = a.guest_signed_at
    ? new Date(a.guest_signed_at).toLocaleString('en-US', {
        dateStyle: 'long',
        timeStyle: 'short',
        timeZone: 'America/New_York',
      })
    : 'just now';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 15px; line-height: 1.6; color: #1e2e34; max-width: 560px;">
      <p><strong>${signerName}</strong> signed the rental agreement for <strong>${a.property_address}</strong> (${fmtAgreementDate(a.stay_start)} &ndash; ${fmtAgreementDate(a.stay_end)}, ${fmtAgreementMoney(a.rental_fee)}).</p>
      <p>Signed ${signedAtPretty}.</p>
      <p>Open the agreement in Helm to countersign:</p>
      <p><a href="${helmUrl}" style="color: #c85a3a; font-weight: 600;">${helmUrl}</a></p>
      <p style="margin-top: 28px; color: #506068; font-size: 13px;">A copy of the signed PDF was emailed to the guest; the fully-executed PDF goes out once you countersign.</p>
    </div>
  `;
  const text =
    `${signerName} signed the rental agreement for ${a.property_address} ` +
    `(${fmtAgreementDate(a.stay_start)} - ${fmtAgreementDate(a.stay_end)}, ${fmtAgreementMoney(a.rental_fee)}).\n` +
    `Signed ${signedAtPretty}.\n\n` +
    `Open the agreement in Helm to countersign:\n${helmUrl}\n\n` +
    `A copy of the signed PDF was emailed to the guest; the fully-executed PDF goes out once you countersign.\n`;

  const results = await Promise.all(
    STAFF_NOTIFY.map((to) =>
      sendTransactionalViaResend({
        to,
        fromName: 'Stay Cape Ann (Helm)',
        fromEmail: FROM_EMAIL,
        subject: `${signerName} signed: ${a.property_address}`,
        html,
        text,
      }),
    ),
  );
  return results.some((r) => !r)
    ? { ok: false, reason: 'one or more staff notifications failed' }
    : { ok: true };
}

/** Staff countersigned — send the guest the fully-executed PDF. */
export async function sendAgreementExecutedEmail(args: {
  agreement: GuestAgreementRow;
  origin: string;
  /** Pre-fetched executed PDF (countersign renders once, reuses the
   *  buffer for this email + the Drive archive). */
  pdf?: Buffer;
}): Promise<{ ok: boolean; reason?: string }> {
  const { agreement: a, origin } = args;
  if (!a.guest_email) return { ok: false, reason: 'no guest_email on agreement' };

  let pdf: Buffer;
  if (args.pdf) {
    pdf = args.pdf;
  } else {
    try {
      pdf = await fetchAgreementPdf({ agreementId: a.id, token: a.signing_token, origin });
    } catch (err) {
      console.error(
        `[agreement-email] PDF fetch failed (executed) for ${a.id}:`,
        err instanceof Error ? err.message : String(err),
      );
      return { ok: false, reason: 'pdf fetch failed' };
    }
  }

  const greeting = firstName(a.guest_name);
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 15px; line-height: 1.6; color: #1e2e34; max-width: 560px;">
      <p>Hi ${greeting},</p>
      <p>Your rental agreement for <strong>${a.property_address}</strong> is now fully executed. Attached is the final signed copy for your records.</p>
      <p>We'll be in touch before check-in on ${fmtAgreementDate(a.stay_start)} with arrival details. See you soon.</p>
      <p style="margin-top: 28px;">Allie O&rsquo;Brien<br/>Stay Cape Ann &middot; Rising Tide Property Management</p>
      ${AFFILIATION_FOOT_HTML}
    </div>
  `;
  const text =
    `Hi ${greeting},\n\n` +
    `Your rental agreement for ${a.property_address} is now fully executed. Attached is the final signed copy for your records.\n\n` +
    `We'll be in touch before check-in on ${fmtAgreementDate(a.stay_start)} with arrival details. See you soon.\n\n` +
    `Allie O'Brien\nStay Cape Ann · Rising Tide Property Management\n\n` +
    `${AFFILIATION_FOOT_TEXT}\n`;

  const ok = await sendTransactionalViaResend({
    to: a.guest_email,
    cc: ALLIE_CC,
    fromName: FROM_NAME,
    fromEmail: FROM_EMAIL,
    subject: `Fully executed: rental agreement for ${a.property_address}`,
    html,
    text,
    attachments: [
      { filename: agreementPdfFilename(a.property_address, a.guest_name), content: pdf.toString('base64') },
    ],
  });
  return ok ? { ok: true } : { ok: false, reason: 'resend send failed' };
}
