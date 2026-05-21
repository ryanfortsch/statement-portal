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
 *
 * Also passes the projection's onboarding_token. /api/projection-pdf
 * authorizes an anonymous request for type=contract ONLY when it carries
 * a matching token — and a NextAuth session cookie does NOT propagate
 * through this server-to-server fetch (countersign / executed-email /
 * Drive-archive all call this from the server with no cookie). Without
 * the token the call 401s, which silently broke the executed-email
 * attachment and the Drive archive. The token is the same one the public
 * /contract/<token> signing flow uses, so it's the right credential here.
 */
export async function fetchContractPdf(args: {
  projectionId: string;
  origin: string;
  token?: string | null;
}): Promise<Buffer> {
  const tokenParam = args.token ? `&token=${encodeURIComponent(args.token)}` : '';
  const url = `${args.origin}/api/projection-pdf?id=${encodeURIComponent(args.projectionId)}&type=contract${tokenParam}`;
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

// Internal staff who get the "owner just signed, countersign now"
// alert. Both run the business and both need eyes on the next-step
// queue (otherwise a countersign sits for a day before anyone
// notices). Override via STAFF_NOTIFY_EMAILS env var if the roster
// changes.
const STAFF_NOTIFY = (process.env.STAFF_NOTIFY_EMAILS || 'allie@risingtidestr.com,dotti@risingtidestr.com')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean);

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
    pdf = await fetchContractPdf({ projectionId: projection.id, origin, token: projection.onboarding_token });
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
    subject: `Your signed management contract for ${projection.property_address}`,
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
  /** Pre-fetched executed PDF. When provided, the internal render is
   *  skipped — countersignContract fetches the PDF once and reuses the
   *  same buffer for both this email and the Drive archive. */
  pdf?: Buffer;
}): Promise<{ ok: boolean; reason?: string }> {
  const { projection, origin } = args;
  const to = projection.prospect_email;
  if (!to) return { ok: false, reason: 'no prospect_email on projection' };

  let pdf: Buffer;
  if (args.pdf) {
    pdf = args.pdf;
  } else {
    try {
      pdf = await fetchContractPdf({ projectionId: projection.id, origin, token: projection.onboarding_token });
    } catch (err) {
      console.error(
        `[contract-email] PDF fetch failed (executed) for ${projection.id} at origin ${origin}:`,
        err instanceof Error ? err.message : String(err),
      );
      return { ok: false, reason: 'pdf fetch failed' };
    }
  }

  const filename = projectionPdfFilename(projection.property_address, 'contract');
  const greeting = firstName(projection.prospect_name);
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 15px; line-height: 1.6; color: #1e2e34; max-width: 560px;">
      <p>Hi ${greeting},</p>
      <p>The management contract is now fully executed. Attached is the final signed copy for your records.</p>
      <p>Welcome aboard. We're glad to be working together on ${projection.property_address}.</p>
      <p>Questions? Reply to this email or call (978) 865-2387.</p>
      <p style="margin-top: 28px;">Allie O&rsquo;Brien<br/>Rising Tide</p>
    </div>
  `;
  const text =
    `Hi ${greeting},\n\n` +
    `The management contract is now fully executed. Attached is the final signed copy for your records.\n\n` +
    `Welcome aboard. We're glad to be working together on ${projection.property_address}.\n\n` +
    `Questions? Reply to this email or call (978) 865-2387.\n\n` +
    `Allie O'Brien\nRising Tide\n`;

  const ok = await sendTransactionalViaResend({
    to,
    cc: ALLIE_CC,
    fromName: FROM_NAME,
    fromEmail: FROM_EMAIL,
    subject: `Fully executed: management contract for ${projection.property_address}`,
    html,
    text,
    attachments: [{ filename, content: pdf.toString('base64') }],
  });

  return ok ? { ok: true } : { ok: false, reason: 'resend send failed' };
}

/**
 * Internal staff alert: an owner just signed and a countersign is
 * pending. Plain email, no PDF attached (staff can pull the signed
 * copy from Helm), goes to allie@ + dotti@ by default (configurable
 * via STAFF_NOTIFY_EMAILS). The CTA is the projection detail page in
 * Helm where countersigning happens.
 *
 * This closes the loop that was previously invisible: the owner
 * confirmation email CC'd Allie on a message addressed to the
 * client, but that's not a clear "you have work to do" prompt, so
 * countersigns were sitting unsigned until a manual check.
 */
export async function sendCountersignNotification(args: {
  projection: ProjectionRow;
  origin: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const { projection, origin } = args;
  if (STAFF_NOTIFY.length === 0) {
    return { ok: false, reason: 'no staff recipients configured' };
  }
  const helmUrl = `${origin}/projections/${projection.id}`;
  const signerName = projection.contract_signed_name || projection.prospect_name || 'the owner';
  const signedAtPretty = projection.contract_signed_at
    ? new Date(projection.contract_signed_at).toLocaleString('en-US', {
        dateStyle: 'long',
        timeStyle: 'short',
        timeZone: 'America/New_York',
      })
    : 'just now';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; font-size: 15px; line-height: 1.6; color: #1e2e34; max-width: 560px;">
      <p><strong>${signerName}</strong> signed the management contract for <strong>${projection.property_address}</strong>.</p>
      <p>Signed ${signedAtPretty}.</p>
      <p>Open the prospect in Helm to countersign:</p>
      <p><a href="${helmUrl}" style="color: #c85a3a; font-weight: 600;">${helmUrl}</a></p>
      <p style="margin-top: 28px; color: #506068; font-size: 13px;">A copy of the partially-signed PDF was emailed to the owner; the fully-executed PDF will go out once you countersign.</p>
    </div>
  `;
  const text =
    `${signerName} signed the management contract for ${projection.property_address}.\n` +
    `Signed ${signedAtPretty}.\n\n` +
    `Open the prospect in Helm to countersign:\n${helmUrl}\n\n` +
    `A copy of the partially-signed PDF was emailed to the owner; the fully-executed PDF will go out once you countersign.\n`;

  // Send to each staff member as TO (not CC) so the email reads as
  // "this is for you." Resend handles the parallel sends; we
  // aggregate any failure into a single ok/reason.
  const results = await Promise.all(
    STAFF_NOTIFY.map((to) =>
      sendTransactionalViaResend({
        to,
        fromName: FROM_NAME,
        fromEmail: FROM_EMAIL,
        subject: `${signerName} signed: ${projection.property_address}`,
        html,
        text,
      }),
    ),
  );
  const anyFailed = results.some((r) => !r);
  return anyFailed
    ? { ok: false, reason: 'one or more staff notifications failed' }
    : { ok: true };
}
