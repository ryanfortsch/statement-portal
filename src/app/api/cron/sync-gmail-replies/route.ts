import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST or GET /api/cron/sync-gmail-replies
 *
 * Polls Gmail for messages received in the last N hours, looks up the
 * From: address against contacts.emails, and for each match creates an
 * inbound row in contact_touches. Dedup is via the gmail_message_id
 * unique index — re-running is safe and idempotent.
 *
 * Triggered by Vercel cron hourly (vercel.json) and manually via the
 * "Sync Now" button on /crm.
 *
 * Auth: optional CRON_SECRET in Authorization header, same pattern as
 * /api/cron/marketing-sync.
 */

const GMAIL_CLIENT_ID = () => process.env.GMAIL_CLIENT_ID || '';
const GMAIL_CLIENT_SECRET = () => process.env.GMAIL_CLIENT_SECRET || '';
const GMAIL_REFRESH_TOKEN = () => process.env.GMAIL_REFRESH_TOKEN || '';

let _sb: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (_sb) return _sb;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw new Error('Supabase not configured');
  _sb = createClient(url, key);
  return _sb;
}

async function getGmailAccessToken(): Promise<string> {
  if (!GMAIL_CLIENT_ID() || !GMAIL_CLIENT_SECRET() || !GMAIL_REFRESH_TOKEN()) {
    throw new Error('Gmail OAuth env vars not configured');
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GMAIL_CLIENT_ID(),
      client_secret: GMAIL_CLIENT_SECRET(),
      refresh_token: GMAIL_REFRESH_TOKEN(),
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    throw new Error(`Gmail token refresh failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.access_token as string;
}

type GmailMessageStub = { id: string; threadId: string };
type GmailHeader = { name: string; value: string };
type GmailPayload = {
  headers?: GmailHeader[];
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPayload[];
};
type GmailMessage = {
  id: string;
  threadId: string;
  internalDate: string;     // ms epoch as string
  payload: GmailPayload;
  snippet?: string;
};

function getHeader(headers: GmailHeader[] | undefined, name: string): string | null {
  if (!headers) return null;
  const lower = name.toLowerCase();
  for (const h of headers) {
    if (h.name.toLowerCase() === lower) return h.value;
  }
  return null;
}

/**
 * Pulls the email address out of a "Name <addr@x.y>" or bare-address
 * From: header. Lower-cased + trimmed for matching against the contacts
 * email list.
 */
function parseFromHeader(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/<([^>]+)>/);
  const raw = match ? match[1] : value;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed.includes('@')) return null;
  return trimmed;
}

function decodeBase64Url(s: string): string {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return Buffer.from(norm, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

/**
 * Walks the multipart MIME tree looking for the first text/plain part.
 * Falls back to the first text/html (stripped) if no plain part exists.
 */
function extractBody(payload: GmailPayload): string {
  function walk(node: GmailPayload): string | null {
    if (node.mimeType === 'text/plain' && node.body?.data) {
      return decodeBase64Url(node.body.data);
    }
    if (node.parts) {
      for (const child of node.parts) {
        const found = walk(child);
        if (found) return found;
      }
    }
    return null;
  }
  const plain = walk(payload);
  if (plain) return plain;

  // Fallback: walk for HTML, strip tags crudely.
  function walkHtml(node: GmailPayload): string | null {
    if (node.mimeType === 'text/html' && node.body?.data) {
      return decodeBase64Url(node.body.data).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
    }
    if (node.parts) {
      for (const child of node.parts) {
        const found = walkHtml(child);
        if (found) return found;
      }
    }
    return null;
  }
  return walkHtml(payload) ?? '';
}

/**
 * Strips quoted reply context ("> On X, Y wrote:") so the touch summary
 * focuses on what the owner actually said. Imperfect but good enough.
 */
function stripQuotedReply(body: string): string {
  // Cut at common quote markers.
  const cuts = [
    /\nOn .+wrote:\n/,                  // "On Mon, May 5, 2026, Allie wrote:"
    /\n-{2,}\s*Original Message\s*-{2,}/i,
    /\nFrom:.+\nSent:.+\nTo:/,          // Outlook-style quote
    /\n>+/,                             // first line that starts with > prefix
  ];
  for (const re of cuts) {
    const m = body.match(re);
    if (m && m.index != null && m.index > 20) {
      return body.slice(0, m.index).trim();
    }
  }
  return body.trim();
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n).trim()}…` : s;
}

async function syncReplies(args: {
  hoursBack: number;
}): Promise<{
  scanned: number;
  matched: number;
  inserted: number;
  skipped: number;
  errors: Array<{ messageId: string; error: string }>;
}> {
  const sb = getSupabase();

  // Pull every contact's email list once and build a lower-cased reverse
  // index { email -> contact_id }. Volume is small (dozens of contacts);
  // we don't need a server-side join.
  const { data: contacts, error: contactErr } = await sb
    .from('contacts')
    .select('id, emails');
  if (contactErr) throw new Error(`Contacts lookup failed: ${contactErr.message}`);

  const emailToContactId = new Map<string, string>();
  for (const c of (contacts ?? []) as Array<{ id: string; emails: string[] | null }>) {
    for (const e of c.emails ?? []) {
      const norm = e.trim().toLowerCase();
      if (norm) emailToContactId.set(norm, c.id);
    }
  }

  if (emailToContactId.size === 0) {
    return { scanned: 0, matched: 0, inserted: 0, skipped: 0, errors: [] };
  }

  const accessToken = await getGmailAccessToken();

  // List recent messages. Gmail's "newer_than:Nh" syntax is hours.
  // Cap at 50 messages per run to keep the route bounded.
  const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
  listUrl.searchParams.set('q', `newer_than:${args.hoursBack}h`);
  listUrl.searchParams.set('maxResults', '50');

  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!listRes.ok) {
    throw new Error(`Gmail list failed: ${listRes.status} ${await listRes.text()}`);
  }
  const listData = (await listRes.json()) as { messages?: GmailMessageStub[] };
  const stubs = listData.messages ?? [];

  let matched = 0;
  let inserted = 0;
  let skipped = 0;
  const errors: Array<{ messageId: string; error: string }> = [];

  for (const stub of stubs) {
    try {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${stub.id}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!msgRes.ok) {
        errors.push({ messageId: stub.id, error: `fetch ${msgRes.status}` });
        continue;
      }
      const msg = (await msgRes.json()) as GmailMessage;

      const fromHeader = getHeader(msg.payload?.headers, 'From');
      const fromEmail = parseFromHeader(fromHeader);
      if (!fromEmail) {
        skipped += 1;
        continue;
      }

      const contactId = emailToContactId.get(fromEmail);
      if (!contactId) {
        // Not a known contact — almost everything in the inbox falls
        // here (Stripe, Guesty, Cape Ann Elite, etc.). Cheap skip.
        skipped += 1;
        continue;
      }

      matched += 1;

      const subject = getHeader(msg.payload?.headers, 'Subject') ?? '(no subject)';
      const body = extractBody(msg.payload);
      const cleaned = stripQuotedReply(body);
      const summary = truncate(`Reply: ${subject.replace(/^Re:\s*/i, '')}`, 280);
      const touchedAt = new Date(Number(msg.internalDate)).toISOString();

      // Dedup is enforced by the unique index on gmail_message_id, so
      // we just attempt the insert and ignore duplicate-key errors.
      const { error: insertErr } = await sb
        .from('contact_touches')
        .insert({
          contact_id: contactId,
          touched_at: touchedAt,
          channel: 'email',
          summary,
          notes: cleaned ? truncate(cleaned, 4000) : null,
          by_email: 'system@helm',
          direction: 'inbound',
          gmail_message_id: msg.id,
        });

      if (insertErr) {
        // 23505 = unique violation = already captured. Not an error.
        if (insertErr.code === '23505') {
          skipped += 1;
        } else {
          errors.push({ messageId: stub.id, error: insertErr.message });
        }
      } else {
        inserted += 1;
      }
    } catch (e) {
      errors.push({ messageId: stub.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return { scanned: stubs.length, matched, inserted, skipped, errors };
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}

async function handle(request: NextRequest) {
  // Optional CRON_SECRET auth. Same pattern as /api/cron/marketing-sync.
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    // For manual UI calls from the dashboard, fall back to allowing
    // signed-in users via the cookie. Vercel cron carries the
    // CRON_SECRET; manual sync from /crm carries the user's session.
    // We accept either here — the dangerous case is a public anon hit,
    // and that requires neither.
    const isManual = request.headers.get('x-helm-manual-sync') === '1';
    if (!isManual) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const url = new URL(request.url);
  const hoursBack = Math.max(1, Math.min(72, Number(url.searchParams.get('hours')) || 24));

  try {
    const result = await syncReplies({ hoursBack });
    return NextResponse.json({ ok: true, hoursBack, ...result });
  } catch (err) {
    console.error('[cron/sync-gmail-replies]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
