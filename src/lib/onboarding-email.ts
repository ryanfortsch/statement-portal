/**
 * Staff-alert email for onboarding form submissions.
 *
 * When an owner submits the public /onboarding/<token> form, a notification
 * fires to the onboarding@risingtidestr.com group address (which fans out
 * to Allie, Dotti, and Ryan via Google Groups). The body includes a quick
 * summary of the answers — enough to triage from the inbox — plus a Helm
 * link to view the full submission and act on it.
 *
 * Unlike the contract emails, this one:
 *   - Has no PDF attachment (the data is structured, not a document)
 *   - Goes TO the group rather than CC'ing it (this is an internal alert,
 *     not a customer-facing message)
 *   - Includes a Helm link, since only staff read this email
 *
 * Failures are logged but non-fatal. The submission is already persisted
 * to the DB before the email fires; a transient Resend outage shouldn't
 * lose the owner's data.
 */
import { sendTransactionalViaResend } from '@/lib/resend';
import type { OnboardingData } from '@/lib/projections-types';

const FROM_NAME = 'Rising Tide';
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@risingtidestr.com';
// The group address — same one used as From — so Reply All on this
// notification goes back to the team, not to whoever happens to be
// signed in to send-as.
const TO_GROUP = 'onboarding@risingtidestr.com';

/**
 * Pick the highlights from OnboardingData for the email body. Full data
 * is on the Helm page; this is a triage summary, not a complete copy.
 */
function summaryRows(data: OnboardingData): Array<[string, string]> {
  const rows: Array<[string, string | undefined]> = [
    ['Owner', data.full_name],
    ['Email', data.email],
    ['Phone', data.phone],
    ['Preferred contact', data.preferred_contact],
    ['Property', data.property_address],
    ['Type', data.property_type],
    ['Bedrooms / Bathrooms', [data.bedrooms, data.bathrooms].filter(Boolean).join(' / ')],
    ['Currently listed', data.currently_listed],
    ['Smart lock', [data.smart_lock_brand, data.smart_lock_code].filter(Boolean).join(' · ')],
    ['Known issues', data.known_issues],
    // Which guest-guide sections the owner wrote. The prose itself is
    // long-form; the pipeline already placed it on the Welcome Home
    // guide, so the email just flags what came in.
    ['Home guide answers', ([
      ['parking', data.guide_parking],
      ['climate', data.guide_climate],
      ['bathrooms', data.guide_bathrooms],
      ['kitchen', data.guide_kitchen],
      ['amenities', data.guide_amenities],
    ] as const)
      .filter(([, v]) => (v ?? '').trim().length > 0)
      .map(([k]) => k)
      .join(', ')],
  ];
  return rows
    .map<[string, string]>(([k, v]) => [k, (v ?? '').trim()])
    .filter(([, v]) => v.length > 0);
}

/**
 * Counts the populated fields so the email shows progress like
 * "27 of 36 fields filled". Helps staff see at a glance whether the
 * owner filled out everything or only the top sections.
 */
function fieldCounts(data: OnboardingData): { filled: number; total: number } {
  const keys = Object.keys(data) as Array<keyof OnboardingData>;
  const filled = keys.filter((k) => {
    const v = data[k];
    return typeof v === 'string' && v.trim().length > 0;
  }).length;
  // Approximate "total" from the OnboardingData shape — the form has
  // ~43 optional fields total (counted from the type definition).
  return { filled, total: 43 };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendOnboardingSubmittedEmail(args: {
  propertyAddress: string;
  ownerName: string | null;
  data: OnboardingData;
  helmUrl: string; // absolute URL to the projection / property page
}): Promise<{ ok: boolean; reason?: string }> {
  const { propertyAddress, ownerName, data, helmUrl } = args;
  const summary = summaryRows(data);
  const { filled, total } = fieldCounts(data);
  const ownerLabel = ownerName || data.full_name || '(unknown)';

  const summaryHtml = summary
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#506068;font-size:12px;letter-spacing:0.04em;text-transform:uppercase;vertical-align:top;white-space:nowrap;">${escapeHtml(k)}</td><td style="padding:4px 0;color:#1e2e34;font-size:14px;vertical-align:top;">${escapeHtml(v)}</td></tr>`,
    )
    .join('');

  const summaryText = summary.map(([k, v]) => `${k}: ${v}`).join('\n');

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;font-size:15px;line-height:1.6;color:#1e2e34;max-width:640px;">
      <p style="margin:0 0 8px;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#c85a3a;font-weight:600;">Onboarding submitted</p>
      <h2 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:300;color:#1e2e34;letter-spacing:-0.01em;">${escapeHtml(propertyAddress)}</h2>
      <p style="margin:0 0 20px;color:#506068;font-size:13px;">
        ${escapeHtml(ownerLabel)} just completed the onboarding intake form
        (${filled} of ${total} fields filled). Quick summary below; the full
        answers are on the projection page.
      </p>
      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 24px;">${summaryHtml}</table>
      <p style="margin:0;">
        <a href="${escapeHtml(helmUrl)}" style="display:inline-block;background:#1e2e34;color:#faf7f1;font-size:12px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;padding:12px 18px;text-decoration:none;">Open in Rising Tide STR &rarr;</a>
      </p>
    </div>
  `;

  const text =
    `Onboarding submitted — ${propertyAddress}\n\n` +
    `${ownerLabel} just completed the onboarding intake form ` +
    `(${filled} of ${total} fields filled).\n\n` +
    `${summaryText}\n\n` +
    `Open in Rising Tide STR: ${helmUrl}\n`;

  const ok = await sendTransactionalViaResend({
    to: TO_GROUP,
    fromName: FROM_NAME,
    fromEmail: FROM_EMAIL,
    subject: `Onboarding submitted: ${propertyAddress}`,
    html,
    text,
  });

  return ok ? { ok: true } : { ok: false, reason: 'resend send failed' };
}
