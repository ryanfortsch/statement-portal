/**
 * One-click unsubscribe tokens.
 *
 * Each campaign send embeds a per-contact URL like:
 *   https://statements.risingtidestr.com/api/guests/unsubscribe?t=<token>
 *
 * The token is a base64url-encoded JSON payload + HMAC-SHA256 signature.
 * Payload: { contact_id, campaign_id?, exp }. Signature scoped by
 * AUDIENCE_UNSUBSCRIBE_SECRET so tokens can't be forged or tampered with.
 *
 * No expiry by default (links should keep working forever, that's the
 * polite thing). Set `expSeconds` for any flow that needs short-lived
 * tokens.
 */

import crypto from 'node:crypto';

type TokenPayload = {
  contact_id: string;
  campaign_id?: string | null;
  exp?: number; // unix seconds
};

function getSecret(): Buffer {
  const s = process.env.AUDIENCE_UNSUBSCRIBE_SECRET || process.env.AUTH_SECRET || '';
  if (!s) throw new Error('AUDIENCE_UNSUBSCRIBE_SECRET (or AUTH_SECRET) must be set');
  return Buffer.from(s, 'utf8');
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4;
  const padded = pad ? s + '='.repeat(4 - pad) : s;
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function createUnsubscribeToken(
  contactId: string,
  campaignId?: string | null,
  expSeconds?: number,
): string {
  const payload: TokenPayload = {
    contact_id: contactId,
    campaign_id: campaignId ?? undefined,
  };
  if (expSeconds) payload.exp = Math.floor(Date.now() / 1000) + expSeconds;

  const json = JSON.stringify(payload);
  const body = b64urlEncode(Buffer.from(json, 'utf8'));
  const sig = b64urlEncode(crypto.createHmac('sha256', getSecret()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyUnsubscribeToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [body, sig] = parts;
  const expected = b64urlEncode(crypto.createHmac('sha256', getSecret()).update(body).digest());
  if (!timingSafeEqStr(sig, expected)) return null;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString('utf8')) as TokenPayload;
  } catch {
    return null;
  }

  if (payload.exp && Date.now() / 1000 > payload.exp) return null;
  if (!payload.contact_id) return null;
  return payload;
}

function timingSafeEqStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function unsubscribeUrl(
  contactId: string,
  campaignId?: string | null,
): string {
  const base =
    process.env.NEXT_PUBLIC_HELM_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'https://helm.risingtidestr.com';
  const t = createUnsubscribeToken(contactId, campaignId);
  return `${base}/api/guests/unsubscribe?t=${encodeURIComponent(t)}`;
}
