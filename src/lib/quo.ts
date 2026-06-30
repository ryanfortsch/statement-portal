/**
 * Quo (formerly OpenPhone) API client + webhook helpers.
 *
 * Quo is Rising Tide's phone/SMS service. The API is openphone.com under
 * the hood (host stayed put; brand rebranded). All paths still live at
 * https://api.openphone.com/v1/*.
 *
 * Auth: API key via `Authorization` header (no Bearer prefix).
 * Webhooks: `openphone-signature` header, HMAC-SHA256 over
 *   `<timestamp>.<JSON.stringify(parsedBody)>` using a base64-decoded
 *   signing key. Format: `hmac;1;<timestamp>;<base64-digest>`.
 *   Reference: https://support.quo.com/core-concepts/integrations/webhooks
 */

import crypto from 'node:crypto';

const API_HOST = 'https://api.openphone.com/v1';

export type QuoMessage = {
  id: string;
  to: string[];
  from: string;
  text: string | null;
  phoneNumberId: string;
  direction: 'incoming' | 'outgoing';
  userId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type QuoCall = {
  id: string;
  phoneNumberId: string;
  userId: string | null;
  // REST list-calls returns `participants: string[]`; webhook events
  // omit that and ship `from`/`to` instead. Both shapes are accepted via
  // callOtherParty().
  participants?: string[];
  from?: string;
  to?: string;
  direction: 'incoming' | 'outgoing';
  status: string;
  duration: number | null;
  createdAt: string;
  answeredAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  answeredBy: string | null;
  initiatedBy: string | null;
  callRoute: string | null;
  forwardedFrom: string | null;
  forwardedTo: string | null;
  aiHandled: boolean | null;
};

export function callOtherParty(
  call: Pick<QuoCall, 'direction' | 'from' | 'to' | 'participants'>,
): string {
  if (call.direction === 'incoming') {
    return call.from ?? call.participants?.[0] ?? '';
  }
  return call.to ?? call.participants?.[0] ?? '';
}

export type QuoPhoneNumber = {
  id: string;
  number: string;
  name: string | null;
  formattedNumber: string;
  symbol: string | null;
  users: string[];
  groupId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type QuoListResponse<T> = {
  data: T[];
  totalItems: number;
  nextPageToken: string | null;
};

// Webhook event types we care about. Full list: call.ringing,
// call.completed, call.recording.completed, call.summary.completed,
// call.transcript.completed, message.received, message.delivered.
export type QuoWebhookEventType =
  | 'message.received'
  | 'message.delivered'
  | 'call.completed'
  | 'call.summary.completed'
  | 'call.recording.completed'
  | 'call.transcript.completed';

export type QuoWebhookEvent<T = unknown> = {
  id: string;
  type: QuoWebhookEventType;
  apiVersion: string;
  createdAt: string;
  data: { object: T };
};

// ── REST client ─────────────────────────────────────────────────────

function apiKey(): string {
  const k = process.env.QUO_API_KEY || '';
  if (!k) throw new Error('QUO_API_KEY is not set');
  return k;
}

async function get<T>(path: string, params: Record<string, string | number | string[] | undefined>): Promise<T> {
  const qs = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val === undefined) continue;
    if (Array.isArray(val)) {
      for (const v of val) qs.append(key, v);
    } else {
      qs.append(key, String(val));
    }
  }
  const url = `${API_HOST}${path}?${qs.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: apiKey() },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Quo ${path} failed (${res.status}): ${body}`);
  }
  return res.json() as Promise<T>;
}

export async function listPhoneNumbers(): Promise<QuoPhoneNumber[]> {
  const res = await get<QuoListResponse<QuoPhoneNumber>>('/phone-numbers', {});
  return res.data;
}

// ── Contacts ────────────────────────────────────────────────────────
// The Quo address book. Standard fields nest under `defaultFields`; emails
// and phoneNumbers are arrays of { name?, value }. With no externalIds the
// list endpoint returns all org contacts. NOTE: Quo's API has historically
// only guaranteed contacts created/associated through the API: the first
// reconcile run reports how many actually come back so we know whether the
// app address book is reachable.
export type QuoContact = {
  id: string;
  externalId?: string | null;
  source?: string | null;
  defaultFields?: {
    firstName?: string | null;
    lastName?: string | null;
    company?: string | null;
    role?: string | null;
    emails?: Array<{ name?: string | null; value?: string | null }> | null;
    phoneNumbers?: Array<{ name?: string | null; value?: string | null }> | null;
  } | null;
  createdAt?: string;
  updatedAt?: string;
};

// Quo's API caps maxResults at 50 on every list endpoint. Asking for
// more returns a 400 ("Expected integer to be less or equal to 50"),
// which is what broke the CRM "Sync Quo" button. Page size is 50; the
// pageToken loops below fetch everything regardless.
const QUO_MAX_PAGE = 50;

export async function listContacts(p?: { maxResults?: number; pageToken?: string }): Promise<QuoListResponse<QuoContact>> {
  return get('/contacts', {
    maxResults: Math.min(p?.maxResults ?? QUO_MAX_PAGE, QUO_MAX_PAGE),
    pageToken: p?.pageToken,
  });
}

/** Page through the whole Quo address book. Capped at 100 pages (~5000
 *  contacts at 50/page) so a pagination bug can't loop forever. */
export async function listAllContacts(): Promise<QuoContact[]> {
  const out: QuoContact[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const res = await listContacts({ maxResults: QUO_MAX_PAGE, pageToken });
    out.push(...(res.data ?? []));
    if (!res.nextPageToken) break;
    pageToken = res.nextPageToken;
  }
  return out;
}

/** Flatten a Quo contact to the fields we reconcile on: a display name, its
 *  email addresses, its phone numbers, and the company. */
export function quoContactFields(c: QuoContact): {
  name: string;
  emails: string[];
  phones: string[];
  company: string | null;
} {
  const d = c.defaultFields ?? {};
  const name = [d.firstName, d.lastName].filter(Boolean).join(' ').trim();
  const emails = (d.emails ?? []).map((e) => (e?.value ?? '').trim()).filter(Boolean);
  const phones = (d.phoneNumbers ?? []).map((p) => (p?.value ?? '').trim()).filter(Boolean);
  return { name, emails, phones, company: (d.company ?? '').trim() || null };
}

export type ListMessagesParams = {
  phoneNumberId: string;
  participants: string[];
  maxResults?: number;
  createdAfter?: string;
  createdBefore?: string;
  pageToken?: string;
};

export async function listMessages(p: ListMessagesParams): Promise<QuoListResponse<QuoMessage>> {
  return get('/messages', {
    phoneNumberId: p.phoneNumberId,
    participants: p.participants,
    maxResults: Math.min(p.maxResults ?? QUO_MAX_PAGE, QUO_MAX_PAGE),
    createdAfter: p.createdAfter,
    createdBefore: p.createdBefore,
    pageToken: p.pageToken,
  });
}

export type ListCallsParams = ListMessagesParams;

export async function listCalls(p: ListCallsParams): Promise<QuoListResponse<QuoCall>> {
  return get('/calls', {
    phoneNumberId: p.phoneNumberId,
    participants: p.participants,
    maxResults: Math.min(p.maxResults ?? QUO_MAX_PAGE, QUO_MAX_PAGE),
    createdAfter: p.createdAfter,
    createdBefore: p.createdBefore,
    pageToken: p.pageToken,
  });
}

export type SendMessageParams = {
  from: string;
  to: string;
  content: string;
};

// POST /v1/messages: Quo's outbound SMS endpoint. `from` is the E.164
// of one of our Quo numbers (use the env-pinned QUO_FROM_NUMBER or pick
// the first from listPhoneNumbers()); `to` is the recipient E.164.
export async function sendMessage(p: SendMessageParams): Promise<QuoMessage> {
  const res = await fetch(`${API_HOST}/messages`, {
    method: 'POST',
    headers: {
      Authorization: apiKey(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: p.from, to: [p.to], content: p.content }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Quo send failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { data: QuoMessage };
  return data.data;
}

// ── Webhook signature verification ─────────────────────────────────
//
// Per Quo docs: header value format is
//   hmac;1;<timestamp-ms>;<base64-hmac-sha256-digest>
// signed string is `<timestamp>.<JSON.stringify(parsedBody)>`,
// secret is base64-encoded.

const REPLAY_WINDOW_MS = 5 * 60 * 1000;

export type SignatureCheck =
  | { ok: true }
  | { ok: false; reason: string };

export function verifyWebhookSignature(
  parsedBody: unknown,
  headerValue: string | null,
  secret: string,
  now: number = Date.now(),
): SignatureCheck {
  if (!headerValue) return { ok: false, reason: 'missing openphone-signature header' };
  if (!secret) return { ok: false, reason: 'QUO_WEBHOOK_SECRET not set' };

  const parts = headerValue.split(';');
  if (parts.length !== 4) return { ok: false, reason: 'malformed signature header' };
  const [scheme, version, timestampStr, providedDigest] = parts;
  if (scheme !== 'hmac' || version !== '1') {
    return { ok: false, reason: `unsupported signature scheme: ${scheme};${version}` };
  }

  const timestamp = parseInt(timestampStr, 10);
  if (!Number.isFinite(timestamp)) return { ok: false, reason: 'invalid timestamp' };
  if (Math.abs(now - timestamp) > REPLAY_WINDOW_MS) {
    return { ok: false, reason: 'timestamp outside replay window' };
  }

  const signedData = `${timestampStr}.${JSON.stringify(parsedBody)}`;
  const keyBinary = Buffer.from(secret, 'base64');
  const computed = crypto
    .createHmac('sha256', keyBinary)
    .update(signedData, 'utf8')
    .digest('base64');

  // Timing-safe compare. Bail early on length mismatch since
  // timingSafeEqual throws on mismatched lengths, and that throw
  // distinguishes itself from a genuine digest mismatch.
  if (computed.length !== providedDigest.length) {
    return { ok: false, reason: 'digest length mismatch' };
  }
  const same = crypto.timingSafeEqual(
    Buffer.from(computed, 'utf8'),
    Buffer.from(providedDigest, 'utf8'),
  );
  return same ? { ok: true } : { ok: false, reason: 'digest mismatch' };
}

// ── Phone normalization ────────────────────────────────────────────
// Inbound webhooks give phones in E.164 already (`+15551234567`); local
// records (cleaner_phones, contacts.phone) may not be normalized. Make
// matching tolerant by stripping non-digits and right-anchoring on the
// last 10 digits (US/CA assumption, fine for Rising Tide).

export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length === 10) return digits;
  return digits;
}

export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return na.length > 0 && na === nb;
}
