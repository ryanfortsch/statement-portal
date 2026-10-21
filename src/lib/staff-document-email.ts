import { sendTransactionalViaResend } from '@/lib/resend';
import { dutyEmails } from '@/lib/team-recipients';
import { staffDocumentFilename, type StaffDocumentRow } from '@/lib/staff-documents';
import { staffDocumentEnvelope, staffDocumentFromEmail } from '@/lib/staff-document-envelope';

/**
 * Emails for staff documents (offer letters). Mirrors agreement-email.ts:
 * the signing link, a note to the owners once it is signed, and the fully
 * signed copy to the signer. Every one speaks as the countersigner (see
 * staff-document-envelope.ts): his name, his reply-to, a copy to him.
 */

const FROM_EMAIL = staffDocumentFromEmail();

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] || full;
}

const WRAP_OPEN =
  '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Inter, sans-serif; font-size: 15px; line-height: 1.6; color: #1e2e34; max-width: 560px;">';

/** Who countersigns staff documents: the `countersign` duty in team.ts. */
export function countersignerEmails(): string[] {
  return dutyEmails('countersign');
}

/** The words of the signing email, for sending and for the preview on the page. */
export function signingEmailText(doc: Pick<StaffDocumentRow, 'recipient_name' | 'title'>, url: string, signOff: string): string {
  return (
    `Hi ${firstName(doc.recipient_name)},\n\n` +
    `Your ${doc.title} is ready to read and sign online:\n${url}\n\n` +
    `${signOff}\nRising Tide\n`
  );
}

/** An owner sends the recipient their signing link. */
export async function sendSigningLinkEmail(args: {
  doc: StaffDocumentRow;
  origin: string;
}): Promise<boolean> {
  const { doc, origin } = args;
  const url = `${origin}/sign/${doc.token}`;
  const env = staffDocumentEnvelope(FROM_EMAIL);
  const from = env.signOff;
  const html = `${WRAP_OPEN}
      <p>Hi ${esc(firstName(doc.recipient_name))},</p>
      <p>Your <strong>${esc(doc.title)}</strong> is ready to read and sign online. It takes a couple of minutes:</p>
      <p><a href="${url}" style="color: #c85a3a; font-weight: 600;">Read and sign</a></p>
      <p style="margin-top: 28px;">${esc(from)}<br/>Rising Tide</p>
    </div>`;
  const text = signingEmailText(doc, url, from);
  return sendTransactionalViaResend({
    to: doc.recipient_email,
    cc: env.cc,
    fromName: env.fromName,
    fromEmail: env.fromEmail,
    replyTo: env.replyTo ?? undefined,
    subject: `Please sign: ${doc.title}`,
    html,
    text,
  });
}

/** Internal: the recipient signed, a countersign waits in Helm. */
export async function sendSignedNotice(args: { doc: StaffDocumentRow; origin: string }): Promise<boolean> {
  const { doc, origin } = args;
  const to = countersignerEmails();
  if (to.length === 0) return false;
  const url = `${origin}/staff-documents/${doc.id}`;
  const html = `${WRAP_OPEN}
      <p>${esc(doc.recipient_name)} signed the <strong>${esc(doc.title)}</strong>.</p>
      <p><a href="${url}" style="color: #c85a3a; font-weight: 600;">Countersign in Helm</a></p>
    </div>`;
  const text = `${doc.recipient_name} signed the ${doc.title}.\n\nCountersign in Helm: ${url}\n`;
  return sendTransactionalViaResend({
    to: to[0],
    cc: to.slice(1),
    fromName: 'Helm',
    fromEmail: FROM_EMAIL,
    subject: `Signed: ${doc.title}, ${doc.recipient_name}`,
    html,
    text,
  });
}

/** The fully signed copy to the signer, the countersigner on copy. */
export async function sendExecutedCopyEmail(args: {
  doc: StaffDocumentRow;
  pdf: Buffer;
}): Promise<boolean> {
  const { doc, pdf } = args;
  const env = staffDocumentEnvelope(FROM_EMAIL);
  const from = env.signOff;
  const html = `${WRAP_OPEN}
      <p>Hi ${esc(firstName(doc.recipient_name))},</p>
      <p>Attached is your fully signed <strong>${esc(doc.title)}</strong> for your records.</p>
      <p>Thank you.</p>
      <p style="margin-top: 28px;">${esc(from)}<br/>Rising Tide</p>
    </div>`;
  const text =
    `Hi ${firstName(doc.recipient_name)},\n\n` +
    `Attached is your fully signed ${doc.title} for your records.\n\n` +
    `Thank you.\n\n${from}\nRising Tide\n`;
  return sendTransactionalViaResend({
    to: doc.recipient_email,
    cc: env.cc,
    replyTo: env.replyTo ?? undefined,
    fromName: env.fromName,
    fromEmail: env.fromEmail,
    subject: `Fully signed: ${doc.title}`,
    html,
    text,
    attachments: [
      {
        filename: staffDocumentFilename(doc, doc.countersigned_at?.slice(0, 10)),
        content: pdf.toString('base64'),
      },
    ],
    timeoutMs: 20_000,
  });
}
