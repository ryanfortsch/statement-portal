import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { authorizeCron } from '@/lib/cron-auth';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * POST or GET /api/cron/sync-gmail-replies
 *
 * Captures email conversations with known CRM contacts into
 * contact_touches. For each contact email, searches EVERY configured
 * mailbox (Allie + Ryan) in BOTH directions — the contact writing to us
 * (inbound) and us writing to the contact (outbound) — over a
 * configurable window.
 *
 * Why both mailboxes + both directions: owner conversations live in
 * email (owners barely use the phone line), and most of that traffic is
 * us reaching out, sent from either Allie's or Ryan's box. The old
 * version only read Allie's inbox, inbound-only, on a rolling forward
 * window, so contact_touches stayed empty even for active relationships.
 *
 * Triggered hourly by Vercel cron (24h window) and manually via the
 * "Sync Replies" button on /crm. Pass ?days=N for a one-time historical
 * backfill (e.g. ?days=365). Idempotent: dedup is on the RFC822
 * Message-ID (global across mailboxes) scoped per contact, so
 * re-running and overlapping windows are safe.
 *
 * Auth: optional CRON_SECRET in the Authorization header; manual UI
 * calls pass x-helm-manual-sync: 1.
 */

type Mailbox = { name: string; refreshToken: string; clientId: string; clientSecret: string };

/**
 * Same mailbox configuration as /api/sync-prospect-mail: Allie is the
 * default token, Ryan is optional, each falls back to the shared OAuth
 * client. Boxes without a refresh token are filtered out, so partial
 * setup is fine.
 */
const MAILBOXES: Mailbox[] = [
  {
    name: 'Allie',
    refreshToken: process.env.GMAIL_REFRESH_TOKEN || process.env.GMAIL_REFRESH_TOKEN_ALLIE || '',
    clientId: process.env.GMAIL_CLIENT_ID || '',
    clientSecret: process.env.GMAIL_CLIENT_SECRET || '',
  },
  {
    name: 'Ryan',
    refreshToken: process.env.GMAIL_REFRESH_TOKEN_RYAN || '',
    clientId: process.env.GMAIL_CLIENT_ID_RYAN || process.env.GMAIL_CLIENT_ID || '',
    clientSecret: process.env.GMAIL_CLIENT_SECRET_RYAN || process.env.GMAIL_CLIENT_SECRET || '',
  },
].filter((m) => m.refreshToken && m.clientId && m.clientSecret);

let _sb: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (_sb) return _sb;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw new Error('Supabase not configured');
  _sb = createClient(url, key);
  return _sb;
}

async function getAccessToken(mb: Mailbox): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: mb.clientId,
      client_secret: mb.clientSecret,
      refresh_token: mb.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    throw new Error(`Gmail token refresh failed for ${mb.name}: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.access_token as string;
}

type GmailMessageStub = { id: string };
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
  internalDate: string; // ms epoch as string
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

/** Pull the bare address out of a "Name <addr@x.y>" or bare-address header. */
function parseEmail(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/<([^>]+)>/);
  const raw = match ? match[1] : value;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.includes('@') ? trimmed : null;
}

function decodeBase64Url(s: string): string {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return Buffer.from(norm, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

/** First text/plain part, falling back to stripped text/html. */
function extractBody(payload: GmailPayload): string {
  function walk(node: GmailPayload): string | null {
    if (node.mimeType === 'text/plain' && node.body?.data) return decodeBase64Url(node.body.data);
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

/** Strip quoted reply context so the touch note focuses on what was said. */
function stripQuotedReply(body: string): string {
  const cuts = [
    /\nOn .+wrote:\n/,
    /\n-{2,}\s*Original Message\s*-{2,}/i,
    /\nFrom:.+\nSent:.+\nTo:/,
    /\n>+/,
  ];
  for (const re of cuts) {
    const m = body.match(re);
    if (m && m.index != null && m.index > 20) return body.slice(0, m.index).trim();
  }
  return body.trim();
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n).trim()}…` : s;
}

/** Paginated Gmail search returning up to `cap` message ids for query `q`. */
async function searchMessageIds(token: string, q: string, cap: number): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    url.searchParams.set('q', q);
    url.searchParams.set('maxResults', String(Math.min(100, cap - ids.length)));
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Gmail list failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { messages?: GmailMessageStub[]; nextPageToken?: string };
    for (const m of data.messages ?? []) ids.push(m.id);
    pageToken = data.nextPageToken;
  } while (pageToken && ids.length < cap);
  return ids;
}

type SyncResult = {
  mailboxes: string[];
  contacts: number;
  scanned: number;
  inserted: number;
  skipped: number;
  errors: Array<{ messageId: string; error: string }>;
};

async function syncContactEmails(args: { window: string; perContactCap: number }): Promise<SyncResult> {
  const sb = getSupabase();

  // Reverse index: lower-cased email -> contact_id.
  const { data: contacts, error: contactErr } = await sb.from('contacts').select('id, emails');
  if (contactErr) throw new Error(`Contacts lookup failed: ${contactErr.message}`);
  const emailToContactId = new Map<string, string>();
  for (const c of (contacts ?? []) as Array<{ id: string; emails: string[] | null }>) {
    for (const e of c.emails ?? []) {
      const norm = e.trim().toLowerCase();
      if (norm) emailToContactId.set(norm, c.id);
    }
  }

  const result: SyncResult = {
    mailboxes: MAILBOXES.map((m) => m.name),
    contacts: emailToContactId.size,
    scanned: 0,
    inserted: 0,
    skipped: 0,
    errors: [],
  };
  if (emailToContactId.size === 0 || MAILBOXES.length === 0) return result;

  for (const mb of MAILBOXES) {
    let token: string;
    try {
      token = await getAccessToken(mb);
    } catch (e) {
      result.errors.push({ messageId: `mailbox:${mb.name}`, error: e instanceof Error ? e.message : String(e) });
      continue;
    }

    for (const [email, contactId] of emailToContactId) {
      let ids: string[];
      try {
        const q = `(from:${email} OR to:${email}) ${args.window}`;
        ids = await searchMessageIds(token, q, args.perContactCap);
      } catch (e) {
        result.errors.push({ messageId: `search:${mb.name}:${email}`, error: e instanceof Error ? e.message : String(e) });
        continue;
      }

      for (const id of ids) {
        result.scanned += 1;
        try {
          const msgRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (!msgRes.ok) {
            result.errors.push({ messageId: id, error: `fetch ${msgRes.status}` });
            continue;
          }
          const msg = (await msgRes.json()) as GmailMessage;
          const headers = msg.payload?.headers;
          const fromEmail = parseEmail(getHeader(headers, 'From'));

          // Direction: the contact sent it -> inbound; anyone else on a
          // thread that includes this contact -> outbound (our side).
          const direction = fromEmail === email ? 'inbound' : 'outbound';

          const subject = (getHeader(headers, 'Subject') ?? '(no subject)')
            .replace(/^(re|fwd):\s*/i, '')
            .trim() || '(no subject)';
          const body = stripQuotedReply(extractBody(msg.payload));
          const touchedAt = new Date(Number(msg.internalDate)).toISOString();

          // Dedup key: prefer the global RFC822 Message-ID so the same
          // email seen in both Allie's and Ryan's box collapses to one
          // touch. Scoped per contact so an email to two different
          // contacts logs against each. Falls back to the per-mailbox
          // Gmail id if the header is missing.
          const rfcId = getHeader(headers, 'Message-ID') || getHeader(headers, 'Message-Id');
          const dedupKey = `${(rfcId || `${mb.name}:${id}`).trim()}::${contactId}`;

          const { error: insertErr } = await sb.from('contact_touches').insert({
            contact_id: contactId,
            touched_at: touchedAt,
            channel: 'email',
            direction,
            summary: truncate(subject, 280),
            notes: body ? truncate(body, 4000) : null,
            by_email: 'system@helm',
            gmail_message_id: dedupKey,
          });

          if (insertErr) {
            if (insertErr.code === '23505') result.skipped += 1;
            else result.errors.push({ messageId: id, error: insertErr.message });
          } else {
            result.inserted += 1;
          }
        } catch (e) {
          result.errors.push({ messageId: id, error: e instanceof Error ? e.message : String(e) });
        }
      }
    }
  }

  return result;
}

export async function GET(request: NextRequest) {
  return handle(request);
}
export async function POST(request: NextRequest) {
  return handle(request);
}

async function handle(request: NextRequest) {
  // Cron auth: Vercel Cron bearer, or a signed-in Helm user (manual trigger).
  const denied = await authorizeCron(request);
  if (denied) return denied;

  const url = new URL(request.url);
  // ?days=N selects a backfill window (1..730); otherwise the hourly
  // forward window in hours (1..72, default 24). Backfill scans more per
  // contact since a year of mail is deeper than a day's.
  const daysParam = Number(url.searchParams.get('days'));
  const backfill = Number.isFinite(daysParam) && daysParam > 0;
  const window = backfill
    ? `newer_than:${Math.min(730, Math.floor(daysParam))}d`
    : `newer_than:${Math.max(1, Math.min(72, Number(url.searchParams.get('hours')) || 24))}h`;
  const perContactCap = backfill ? 200 : 25;

  try {
    const result = await syncContactEmails({ window, perContactCap });
    // Keep the /today triage cache warm (Allie's unread inbox).
    let triageSummary: import('@/lib/daily-brief').SyncEmailsSummary | { skipped: string } = { skipped: 'not_attempted' };
    try {
      const { syncUnreadEmails } = await import('@/lib/daily-brief');
      triageSummary = await syncUnreadEmails();
    } catch (err) {
      console.error('[cron/sync-gmail-replies] triage sync failed', err);
    }
    await getSupabase()
      .from('sync_status')
      .upsert({ source: 'gmail-replies', last_synced_at: new Date().toISOString() }, { onConflict: 'source' });
    return NextResponse.json({ ok: true, window, ...result, triage: triageSummary });
  } catch (err) {
    console.error('[cron/sync-gmail-replies]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
