/**
 * Thin wrapper around the Resend HTTP API for the Guests module.
 *
 * We intentionally avoid the `resend` npm package so we don't pull a new
 * dependency for what amounts to four endpoints. The fetch shape is stable
 * and well-documented at https://resend.com/docs/api-reference.
 *
 * No-op behavior: when RESEND_API_KEY or RESEND_AUDIENCE_ID is missing, all
 * functions return null and log a warning. This lets dev / staging work
 * without configuring Resend, and lets a half-configured prod deploy fail
 * gracefully (the contact still lands in our DB; sync just doesn't happen).
 */

const RESEND_API = 'https://api.resend.com';

export const isResendConfigured = !!process.env.RESEND_API_KEY && !!process.env.RESEND_AUDIENCE_ID;

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

export type ResendContact = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  unsubscribed?: boolean;
};

/**
 * Create or update a contact in the configured Resend audience.
 * Returns the Resend contact id, or null if Resend isn't configured.
 */
export async function pushContactToResend(args: {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  unsubscribed?: boolean;
}): Promise<string | null> {
  if (!isResendConfigured) {
    console.warn('[resend] not configured; skipping pushContactToResend for', args.email);
    return null;
  }

  const audienceId = process.env.RESEND_AUDIENCE_ID!;
  const url = `${RESEND_API}/audiences/${audienceId}/contacts`;

  const body = {
    email: args.email,
    first_name: args.firstName || undefined,
    last_name: args.lastName || undefined,
    unsubscribed: !!args.unsubscribed,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.error('[resend] pushContact failed', res.status, txt);
    return null;
  }

  const data = (await res.json()) as { id?: string; data?: { id?: string } };
  return data.id || data.data?.id || null;
}

/**
 * Mark a contact as unsubscribed in Resend. Used when someone opts out
 * via Helm directly (vs. clicking Resend's hosted unsubscribe link).
 */
export async function unsubscribeContactInResend(
  resendContactId: string
): Promise<boolean> {
  if (!isResendConfigured) return false;
  const audienceId = process.env.RESEND_AUDIENCE_ID!;
  const url = `${RESEND_API}/audiences/${audienceId}/contacts/${resendContactId}`;

  const res = await fetch(url, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ unsubscribed: true }),
  });

  return res.ok;
}

/**
 * Send a broadcast (campaign) to a Resend audience. Returns the broadcast id.
 *
 * Phase 1 just creates + sends in one call. Later we'll split create/send so
 * the composer can preview a draft before firing.
 */
export async function sendBroadcastViaResend(args: {
  name: string;
  subject: string;
  fromName: string;
  fromEmail: string;
  html: string;
  text?: string;
}): Promise<string | null> {
  if (!isResendConfigured) {
    console.warn('[resend] not configured; skipping sendBroadcast for', args.name);
    return null;
  }

  const audienceId = process.env.RESEND_AUDIENCE_ID!;

  const createRes = await fetch(`${RESEND_API}/broadcasts`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      audience_id: audienceId,
      name: args.name,
      from: `${args.fromName} <${args.fromEmail}>`,
      subject: args.subject,
      html: args.html,
      text: args.text,
    }),
  });

  if (!createRes.ok) {
    const txt = await createRes.text().catch(() => '');
    console.error('[resend] create broadcast failed', createRes.status, txt);
    return null;
  }

  const created = (await createRes.json()) as { id?: string; data?: { id?: string } };
  const broadcastId = created.id || created.data?.id;
  if (!broadcastId) return null;

  const sendRes = await fetch(`${RESEND_API}/broadcasts/${broadcastId}/send`, {
    method: 'POST',
    headers: authHeaders(),
  });

  if (!sendRes.ok) {
    const txt = await sendRes.text().catch(() => '');
    console.error('[resend] send broadcast failed', sendRes.status, txt);
    return broadcastId; // created but didn't fire
  }

  return broadcastId;
}

/**
 * Send a single transactional email (welcome, confirmation, etc.).
 */
export async function sendTransactionalViaResend(args: {
  to: string;
  subject: string;
  fromName?: string;
  fromEmail?: string;
  html: string;
  text?: string;
}): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) return false;

  const fromName = args.fromName || 'Rising Tide';
  const fromEmail = args.fromEmail || process.env.RESEND_FROM_EMAIL || '';
  if (!fromEmail) return false;

  const res = await fetch(`${RESEND_API}/emails`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: [args.to],
      subject: args.subject,
      html: args.html,
      text: args.text,
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.error('[resend] sendTransactional failed', res.status, txt);
    return false;
  }
  return true;
}
