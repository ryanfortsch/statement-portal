/**
 * Shared Gmail draft creation with attachment support.
 *
 * Lifted from /api/draft-email (the statement workflow) so new surfaces —
 * the work-order emails first — can create review-in-Gmail drafts without
 * cloning the MIME machinery a fifth time. The four existing draft routes
 * keep their local copies (no mechanical sweep); new callers import this.
 *
 * Mailbox: prefers Dotti's token (GMAIL_REFRESH_TOKEN_DOTTI, optional
 * GMAIL_CLIENT_ID_DOTTI / GMAIL_CLIENT_SECRET_DOTTI — the same per-person
 * pattern import-inquiries uses) so her drafts land in HER Drafts folder;
 * falls back to the bare GMAIL_REFRESH_TOKEN (Allie's mailbox, where the
 * statement drafts already live and get reviewed). The From: header is
 * cosmetic until the mailbox verifies it as a send-as alias — same caveat
 * as SEND_FROM in lib/properties.ts.
 */

import 'server-only';

export type GmailAttachment = { filename: string; contentType: string; content: Buffer };

type TokenPick = { clientId: string; clientSecret: string; refreshToken: string; mailbox: 'dotti' | 'shared' };

function pickToken(preferDotti: boolean): TokenPick | null {
  const sharedId = process.env.GMAIL_CLIENT_ID || '';
  const sharedSecret = process.env.GMAIL_CLIENT_SECRET || '';
  if (preferDotti && process.env.GMAIL_REFRESH_TOKEN_DOTTI) {
    return {
      clientId: process.env.GMAIL_CLIENT_ID_DOTTI || sharedId,
      clientSecret: process.env.GMAIL_CLIENT_SECRET_DOTTI || sharedSecret,
      refreshToken: process.env.GMAIL_REFRESH_TOKEN_DOTTI,
      mailbox: 'dotti',
    };
  }
  if (sharedId && sharedSecret && process.env.GMAIL_REFRESH_TOKEN) {
    return { clientId: sharedId, clientSecret: sharedSecret, refreshToken: process.env.GMAIL_REFRESH_TOKEN, mailbox: 'shared' };
  }
  return null;
}

async function getAccessToken(pick: TokenPick): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: pick.clientId,
      client_secret: pick.clientSecret,
      refresh_token: pick.refreshToken,
      grant_type: 'refresh_token',
    }),
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
  | { ok: true; draftId: string; draftUrl: string; mailbox: 'dotti' | 'shared' }
  | { ok: false; error: string };

/** Create a Gmail draft for human review-and-send. Never sends. */
export async function createGmailDraft(args: {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  attachments?: GmailAttachment[];
  /** Land in Dotti's mailbox when her token is configured (default true). */
  preferDotti?: boolean;
}): Promise<GmailDraftResult> {
  const pick = pickToken(args.preferDotti ?? true);
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
  return {
    ok: true,
    draftId: draft.id,
    draftUrl: `https://mail.google.com/mail/u/0/#drafts/${draft.id}`,
    mailbox: pick.mailbox,
  };
}
