/**
 * Shared Gmail draft creation with attachment support.
 *
 * Lifted from /api/draft-email (the statement workflow) so new surfaces —
 * the work-order emails first — can create review-in-Gmail drafts without
 * cloning the MIME machinery a fifth time. The four existing draft routes
 * keep their local copies (no mechanical sweep); new callers import this.
 *
 * Mailboxes: the bare GMAIL_REFRESH_TOKEN (the shared mailbox where the
 * statement drafts live) plus one optional token per person,
 * GMAIL_REFRESH_TOKEN_<DOTTI|RYAN|ALLIE> with optional GMAIL_CLIENT_ID_<X> /
 * GMAIL_CLIENT_SECRET_<X> (the per-person pattern import-inquiries uses).
 * The caller names the mailbox; `sessionMailbox` finds the one that IS the
 * signed-in person's, so a work order or an owner email drafts where its
 * sender can see it. The From: header is cosmetic until the mailbox
 * verifies it as a send-as alias, the same caveat as SEND_FROM in
 * lib/properties.ts.
 */

import 'server-only';
import { gmailUrl } from '@/lib/gmail-links';

export type GmailAttachment = { filename: string; contentType: string; content: Buffer };

/** A Gmail token Helm holds: the shared one, or one person's own. */
export type MailboxKey = 'shared' | 'dotti' | 'ryan' | 'allie';
const PERSONAL_MAILBOXES: readonly Exclude<MailboxKey, 'shared'>[] = ['dotti', 'ryan', 'allie'];

type TokenPick = { clientId: string; clientSecret: string; refreshToken: string; mailbox: MailboxKey };

function tokenFor(key: MailboxKey): TokenPick | null {
  const sharedId = process.env.GMAIL_CLIENT_ID || '';
  const sharedSecret = process.env.GMAIL_CLIENT_SECRET || '';
  if (key === 'shared') {
    const refreshToken = process.env.GMAIL_REFRESH_TOKEN || '';
    return sharedId && sharedSecret && refreshToken ? { clientId: sharedId, clientSecret: sharedSecret, refreshToken, mailbox: 'shared' } : null;
  }
  const suffix = key.toUpperCase();
  const refreshToken = process.env[`GMAIL_REFRESH_TOKEN_${suffix}`] || '';
  const clientId = process.env[`GMAIL_CLIENT_ID_${suffix}`] || sharedId;
  const clientSecret = process.env[`GMAIL_CLIENT_SECRET_${suffix}`] || sharedSecret;
  return refreshToken && clientId && clientSecret ? { clientId, clientSecret, refreshToken, mailbox: key } : null;
}

/**
 * Which Workspace address a token opens, asked of Gmail itself
 * (users/me/profile) and cached for six hours per token. Every Gmail link
 * Helm renders carries this address (`gmailUrl`) and renders only for the
 * session that owns it (`canOpenMailbox`). Null when the token is not
 * configured or Gmail cannot say, in which case no link is offered to
 * anyone rather than a link to the wrong mailbox.
 */
const PROFILE_TTL_MS = 6 * 60 * 60 * 1000;
/** A page that asks whose mailbox a session has waits at most this long. */
const PROFILE_TIMEOUT_MS = 4000;
const profileCache = new Map<MailboxKey, { address: string; at: number }>();

export async function gmailMailbox(kind: MailboxKey): Promise<string | null> {
  const pick = tokenFor(kind);
  if (!pick) return null;
  const hit = profileCache.get(pick.mailbox);
  if (hit && Date.now() - hit.at < PROFILE_TTL_MS) return hit.address;
  try {
    const accessToken = await getAccessToken(pick, PROFILE_TIMEOUT_MS);
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(PROFILE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { emailAddress?: string };
    const address = data.emailAddress?.trim().toLowerCase() || null;
    if (address) profileCache.set(pick.mailbox, { address, at: Date.now() });
    return address;
  } catch {
    return null;
  }
}

/**
 * The token that IS this person's own mailbox, or null. A token counts only
 * when Gmail says its address is the session's (users/me/profile), never by
 * the env var's name, so a draft "in your Gmail" is one the sender can open.
 * The person's own GMAIL_REFRESH_TOKEN_<NAME> is asked first, then the rest.
 * Null means Helm holds no Gmail for them: the surfaces offer Copy instead
 * of creating a draft in someone else's mailbox.
 */
export async function sessionMailbox(sessionEmail: string | null | undefined): Promise<{ key: MailboxKey; address: string } | null> {
  const email = (sessionEmail || '').trim().toLowerCase();
  if (!email) return null;
  const local = email.split('@')[0];
  const keys: MailboxKey[] = [
    ...PERSONAL_MAILBOXES.filter((k) => k === local),
    ...PERSONAL_MAILBOXES.filter((k) => k !== local),
    'shared',
  ];
  for (const key of keys) {
    if (!tokenFor(key)) continue;
    const address = await gmailMailbox(key);
    if (address && address === email) return { key, address };
  }
  return null;
}

async function getAccessToken(pick: TokenPick, timeoutMs?: number): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: pick.clientId,
      client_secret: pick.clientSecret,
      refresh_token: pick.refreshToken,
      grant_type: 'refresh_token',
    }),
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
  });
  if (!res.ok) throw new Error(`Gmail token refresh failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

/** Base64-URL encoding (RFC 4648 §5). Gmail's drafts endpoint requires this. */
function base64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** RFC 2047 B-encoding for non-ASCII header values. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=`;
}

/** Chunk a base64 string into 76-char lines per RFC 2045. */
function wrapBase64(s: string, width = 76): string {
  const lines: string[] = [];
  for (let i = 0; i < s.length; i += width) lines.push(s.slice(i, i + width));
  return lines.join('\r\n');
}

/** Plain text → minimal HTML part so mobile Gmail doesn't reflow long
 *  lines (same rationale as the statement drafts, minus the money-bolding). */
function plainToHtml(body: string): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const paragraphs = body.split(/\n\n+/).map((p) => p.replace(/^\n+|\n+$/g, ''));
  const htmlParas = paragraphs
    .filter((p) => p.length > 0)
    .map((p) => `<p style="margin:0 0 1em 0;">${escape(p).replace(/\n/g, '<br>')}</p>`);
  return `<!DOCTYPE html><html><body>${htmlParas.join('')}</body></html>`;
}

function buildMimeMessage(args: {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  attachments?: GmailAttachment[];
}): string {
  const { from, to, cc, subject, body } = args;
  const attachments = args.attachments ?? [];
  const headers = [`From: ${from}`, `To: ${to.join(', ')}`];
  if (cc && cc.length > 0) headers.push(`Cc: ${cc.join(', ')}`);
  headers.push(`Subject: ${encodeHeader(subject)}`);
  headers.push('MIME-Version: 1.0');

  const altBoundary = `rt_alt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const html = plainToHtml(body);
  const bodyCrlf = body.replace(/\r?\n/g, '\r\n');
  const altPart = [
    `--${altBoundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    bodyCrlf,
    `--${altBoundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    html,
    `--${altBoundary}--`,
  ].join('\r\n');

  if (attachments.length === 0) {
    headers.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    return headers.join('\r\n') + '\r\n\r\n' + altPart + '\r\n';
  }

  const mixedBoundary = `rt_boundary_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);

  const bodyPart = [
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    '',
    altPart,
  ].join('\r\n');

  const attachmentParts = attachments.map((attachment) =>
    [
      `--${mixedBoundary}`,
      `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      '',
      wrapBase64(attachment.content.toString('base64')),
    ].join('\r\n'),
  );

  return [headers.join('\r\n'), '', bodyPart, ...attachmentParts, `--${mixedBoundary}--`, ''].join('\r\n');
}

export type GmailDraftResult =
  | { ok: true; draftId: string; draftUrl: string; mailbox: MailboxKey; mailboxAddress: string | null }
  | { ok: false; error: string };

/** Create a Gmail draft for human review-and-send, in the named mailbox.
 *  Never sends. */
export async function createGmailDraft(args: {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  attachments?: GmailAttachment[];
  /** Whose Gmail the draft lands in: usually sessionMailbox(...).key. */
  mailbox: MailboxKey;
}): Promise<GmailDraftResult> {
  const pick = tokenFor(args.mailbox);
  if (!pick) return { ok: false, error: 'Gmail OAuth env vars not configured' };

  let accessToken: string;
  try {
    accessToken = await getAccessToken(pick);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const mime = buildMimeMessage(args);
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { raw: base64url(mime) } }),
  });
  if (!res.ok) {
    const errText = await res.text();
    const hint =
      res.status === 403 && /insufficient/i.test(errText)
        ? ' The Gmail OAuth token probably lacks gmail.compose scope.'
        : '';
    return { ok: false, error: `Gmail draft creation failed (${res.status}): ${errText.slice(0, 300)}${hint}` };
  }
  const draft = (await res.json()) as { id: string };
  // The link names the mailbox the draft is in; the caller shows it only to
  // the session that owns that mailbox (canOpenMailbox).
  const mailboxAddress = await gmailMailbox(pick.mailbox);
  return {
    ok: true,
    draftId: draft.id,
    draftUrl: gmailUrl(mailboxAddress, `drafts/${draft.id}`),
    mailbox: pick.mailbox,
    mailboxAddress,
  };
}
