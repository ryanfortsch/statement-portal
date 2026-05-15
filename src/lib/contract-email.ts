/**
 * Transactional emails for the contract signing flow.
 *
 * Two emails fire in sequence:
 *   1. After the owner submits their typed signature at /contract/<token>,
 *      `sendOwnerSignedEmail` sends them a copy of the partially-signed
 *      contract (owner row signed, PM row blank) with a "we'll countersign
 *      shortly" note. Allie is CC'd.
 *   2. After Allie countersigns from /projections/<id>, `sendExecutedEmail`
 *      sends the fully-executed PDF (both rows signed) with a "welcome
 *      aboard" note. Allie is CC'd.
 *
 * Both render the PDF on-demand by navigating Puppeteer to the existing
 * contract preview route (which now reads contract_signed_at /
 * contract_countersigned_at and renders the signature block accordingly).
 * Failures are logged but don't throw — the signing/countersigning action
 * should record the DB state even if the email fails, so the signature
 * isn't lost on a transient Resend outage.
 */
import { projectionPdfFilename } from '@/lib/projection-pdf';
import { sendTransactionalViaResend } from '@/lib/resend';
import type { ProjectionRow } from '@/lib/projections-types';

/**
 * Fetch the contract PDF by calling the existing /api/projection-pdf
 * endpoint via HTTP. This sidesteps a Vercel function-bundling issue
 * where the chromium binary used by Puppeteer was traced into the API
 * route's deployment package but NOT into the server action's function,
 * causing the inline renderProjectionPdf call from submitContractSignature
 * to fail at runtime with a confusing "PDF render failed" error. The
 * API route ALREADY has the binary bundled (since it explicitly
 * declares `export const runtime = 'nodejs'; export const maxDuration
 * = 60;` and has been in use by the Download PDF button for months),
 * so reusing it is the most reliable path.
 *
 * Passes the Vercel Deployment Protection bypass header so production
 * preview deployments are reachable when this is called from inside a
 * server action (same pattern the inline renderProjectionPdf uses).
 */
async function fetchContractPdf(args: {
  projectionId: string;
  origin: string;
}): Promise<Buffer> {
  const url = `${args.origin}/api/projection-pdf?id=${encodeURIComponent(args.projectionId)}&type=contract`;
  const headers: Record<string, string> = {};
  const bypass = process.env.VERCEL_PROTECTION_BYPASS;
  if (bypass) {
    headers['x-vercel-protection-bypass'] = bypass;
    headers['x-vercel-set-bypass-cookie'] = 'true';
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`projection-pdf fetch ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}

const FROM_NAME = 'Rising Tide';
// Reuse the existing RESEND_FROM_EMAIL env var (already configured for
// the marketing pipeline). Falls back to allie@ for safety if missing.
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'allie@risingtidestr.com';
const ALLIE_CC = 'allie@risingtidestr.com';

function firstName(name: string | null | undefined): string {
  if (!name) return 'there';
  return name.trim().split(/[, ]/)[0] || 'there';
}

/**
 * Owner just signed. Send them a copy of the partially-signed contract
 * with a "we'll countersign shortly" message.
 */
export async function sendOwnerSignedEmail(args: {
  projection: ProjectionRow;
  origin: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const { projection, origin } = args;
  const to = projection.prospect_email;
  if (!to) return { ok: false, reason: 'no prospect_email on projection' };

  let pdf: Buffer;
  try {
    pdf = await fetchContractPdf({ projectionId: projection.id, origin });
  } catch (err) {
    console.error(
      `[contract-email] PDF fetch failed (owner-signed) for ${projection.id} at origin ${origin}:`,
      err instanceof Error ? err.message : String(err),
    );
    return { ok: false, reason: 'pdf fetch failed' };
  }

  const filename = projectionPdfFilename(projection.property_address, 'contract');
  const greeting = firstName(projection.prospect_name);
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 15px; line-height: 1.6; color: #1e2e34; max-width: 560px;">
      <p>Hi ${greeting},</p>
      <p>Thanks for signing the management contract. Attached is a copy showing your signature on file.</p>
      <p>I'll countersign within one business day and send back the fully executed version once both signatures are in place.</p>
      <p>Questions in the meantime? Reply to this email or call (978) 865-2387.</p>
      <p style="margin-top: 28px;">Allie O&rsquo;Brien<br/>Rising Tide</p>
    </div>
  `;
  const text =
    `Hi ${greeting},\n\n` +
    `Thanks for signing the management contract. Attached is a copy showing your signature on file.\n\n` +
    `I'll countersign within one business day and send back the fully executed version once both signatures are in place.\n\n` +
    `Questions in the meantime? Reply to this email or call (978) 865-2387.\n\n` +
    `Allie O'Brien\nRising Tide\n`;

  const ok = await sendTransactionalViaResend({
    to,
    cc: ALLIE_CC,
    fromName: FROM_NAME,
    fromEmail: FROM_EMAIL,
    subject: `Your signed management contract — ${projection.property_address}`,
    html,
    text,
    attachments: [{ filename, content: pdf.toString('base64') }],
  });

  return ok ? { ok: true } : { ok: false, reason: 'resend send failed' };
}

/**
 * Allie just countersigned. Send the fully-executed contract to the
 * owner with a welcome note.
 */
export async function sendExecutedEmail(args: {
  projection: ProjectionRow;
  origin: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const { projection, origin } = args;
  const to = projection.prospect_email;
  if (!to) return { ok: false, reason: 'no prospect_email on projection' };

  let pdf: Buffer;
  try {
    pdf = await fetchContractPdf({ projectionId: projection.id, origin });
  } catch (err) {
    console.error(
      `[contract-email] PDF fetch failed (executed) for ${projection.id} at origin ${origin}:`,
      err instanceof Error ? err.message : String(err),
    );
    return { ok: false, reason: 'pdf fetch failed' };
  }

  const filename = projectionPdfFilename(projection.property_address, 'contract');
  const greeting = firstName(projection.prospect_name);
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 15px; line-height: 1.6; color: #1e2e34; max-width: 560px;">
      <p>Hi ${greeting},</p>
      <p>The management contract is now fully executed. Attached is the final signed copy for your records.</p>
      <p>Welcome aboard — we're glad to be working together on ${projection.property_address}.</p>
      <p>Questions? Reply to this email or call (978) 865-2387.</p>
      <p style="margin-top: 28px;">Allie O&rsquo;Brien<br/>Rising Tide</p>
    </div>
  `;
  const text =
    `Hi ${greeting},\n\n` +
    `The management contract is now fully executed. Attached is the final signed copy for your records.\n\n` +
    `Welcome aboard — we're glad to be working together on ${projection.property_address}.\n\n` +
    `Questions? Reply to this email or call (978) 865-2387.\n\n` +
    `Allie O'Brien\nRising Tide\n`;

  const ok = await sendTransactionalViaResend({
    to,
    cc: ALLIE_CC,
    fromName: FROM_NAME,
    fromEmail: FROM_EMAIL,
    subject: `Fully executed: management contract — ${projection.property_address}`,
    html,
    text,
    attachments: [{ filename, content: pdf.toString('base64') }],
  });

  return ok ? { ok: true } : { ok: false, reason: 'resend send failed' };
}
