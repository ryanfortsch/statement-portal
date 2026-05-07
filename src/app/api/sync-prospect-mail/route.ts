import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import type {
  GmailTouches,
  GmailTouchType,
  GmailTouchEntry,
  Owner,
} from '@/lib/projections-types';

/**
 * POST /api/sync-prospect-mail
 *
 * For each projection record, scan every configured Gmail mailbox's sent
 * folder for messages addressed to any of the prospect's owners' emails.
 * Classify each match by deliverable type (projection / guide / contract /
 * onboarding) using subject keywords + attachment filenames, then store the
 * most recent send per type back on the projection's gmail_touches JSONB.
 *
 * Mailboxes: configured via env vars. Allie is the default
 * (GMAIL_REFRESH_TOKEN); Ryan is optional (GMAIL_REFRESH_TOKEN_RYAN). Add
 * more by extending the MAILBOXES array. Mailboxes with no refresh token
 * are silently skipped, so partial setup is fine.
 *
 * Body (optional): { id: "<projection_uuid>" } to sync just one prospect.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

type Mailbox = {
  name: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
};

/**
 * Configured Gmail mailboxes. Each scan touches every mailbox with a non-empty
 * refresh token; the rest are skipped. To add a new mailbox, push another
 * entry that points at its env vars.
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
    // Per-user OAuth client overrides if the OAuth app isn't shared across
    // mailboxes; default to the same shared client + secret as Allie.
    clientId: process.env.GMAIL_CLIENT_ID_RYAN || process.env.GMAIL_CLIENT_ID || '',
    clientSecret: process.env.GMAIL_CLIENT_SECRET_RYAN || process.env.GMAIL_CLIENT_SECRET || '',
  },
].filter((m) => m.refreshToken && m.clientId && m.clientSecret);

let _sb: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (_sb) return _sb;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
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
  if (!res.ok) throw new Error(`Failed to refresh ${mb.name}'s Gmail token: ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

type GmailHeader = { name: string; value: string };
type GmailPart = { filename?: string; mimeType?: string; parts?: GmailPart[] };
type GmailMessageMeta = {
  id: string;
  internalDate: string; // ms epoch as string
  payload?: { headers?: GmailHeader[]; parts?: GmailPart[] };
};

function flattenAttachments(part: GmailPart | undefined): string[] {
  if (!part) return [];
  const out: string[] = [];
  if (part.filename && part.filename.length > 0) out.push(part.filename);
  for (const child of part.parts || []) out.push(...flattenAttachments(child));
  return out;
}

/**
 * Look at the subject line + any attachment filenames and decide which
 * deliverable this email represents. Returns null if it doesn't look like one
 * of the four prospect deliverables (we don't store "other" in gmail_touches).
 */
function classify(subject: string, attachments: string[]): GmailTouchType | null {
  const blob = `${subject} ${attachments.join(' ')}`.toLowerCase();
  if (blob.includes('partnership guide')) return 'guide';
  if (blob.includes('onboarding')) return 'onboarding';
  // "contract" check before "projection" so "Contract & Projection" attachments
  // resolve to contract first; the loop processes one match per message anyway.
  if (blob.includes('contract') || blob.includes('management agreement')) return 'contract';
  if (blob.includes('projection') || blob.includes('revenue estimate')) return 'projection';
  return null;
}

async function searchAndClassify(
  accessToken: string,
  email: string,
  fromUser: string,
): Promise<GmailTouches> {
  // Look back 1 year of sent mail to that recipient.
  // Gmail q-language: https://support.google.com/mail/answer/7190
  const yearAgo = new Date();
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const after = `${yearAgo.getFullYear()}/${String(yearAgo.getMonth() + 1).padStart(2, '0')}/${String(yearAgo.getDate()).padStart(2, '0')}`;
  const q = `in:sent to:${email} after:${after}`;

  const searchUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=50`;
  const searchRes = await fetch(searchUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!searchRes.ok) throw new Error(`${fromUser} Gmail search failed: ${await searchRes.text()}`);
  const searchData = await searchRes.json();
  const messages = (searchData.messages || []) as { id: string }[];

  const touches: GmailTouches = {};

  for (const m of messages) {
    const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=To&metadataHeaders=Date`;
    const msgRes = await fetch(msgUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!msgRes.ok) continue;
    const msgData = (await msgRes.json()) as GmailMessageMeta;

    const headers = msgData.payload?.headers || [];
    const subject = headers.find((h) => h.name === 'Subject')?.value || '';
    const to = headers.find((h) => h.name === 'To')?.value || email;
    const sentMs = Number(msgData.internalDate || 0);
    const sentAt = sentMs ? new Date(sentMs).toISOString() : new Date().toISOString();

    const attachments = flattenAttachments(msgData.payload as GmailPart | undefined);
    const type = classify(subject, attachments);
    if (!type) continue;

    const entry: GmailTouchEntry = {
      sent_at: sentAt,
      message_id: msgData.id,
      subject,
      to,
      from_user: fromUser,
    };

    // Latest send wins
    const existing = touches[type];
    if (!existing || new Date(entry.sent_at) > new Date(existing.sent_at)) {
      touches[type] = entry;
    }
  }

  return touches;
}

/** Collect every email from a prospect record (legacy scalar + every owner). */
function collectEmails(p: { prospect_email: string | null; owners: Owner[] | null }): string[] {
  const set = new Set<string>();
  if (p.prospect_email) set.add(p.prospect_email.trim().toLowerCase());
  for (const o of p.owners || []) {
    if (o.email) set.add(o.email.trim().toLowerCase());
  }
  return Array.from(set).filter(Boolean);
}

/** Merge two GmailTouches maps, keeping the latest send per type. */
function mergeTouches(a: GmailTouches, b: GmailTouches): GmailTouches {
  const out: GmailTouches = { ...a };
  for (const k of Object.keys(b) as GmailTouchType[]) {
    const existing = out[k];
    const incoming = b[k]!;
    if (!existing || new Date(incoming.sent_at) > new Date(existing.sent_at)) {
      out[k] = incoming;
    }
  }
  return out;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const onlyId: string | undefined = body?.id;

    const sb = getSupabase();
    let query = sb
      .from('projections')
      .select('id, prospect_email, owners, gmail_synced_at');
    if (onlyId) query = query.eq('id', onlyId);

    const { data: rawProspects, error: pErr } = await query;
    if (pErr) throw new Error(pErr.message);
    const prospects = (rawProspects ?? []).filter((p) => {
      const emails = collectEmails(p as { prospect_email: string | null; owners: Owner[] | null });
      return emails.length > 0;
    });
    if (prospects.length === 0) {
      return NextResponse.json({ success: true, scanned: 0, mailboxes: [], results: [] });
    }
    if (MAILBOXES.length === 0) {
      return NextResponse.json(
        { error: 'No Gmail mailboxes configured. Set GMAIL_REFRESH_TOKEN (Allie) and/or GMAIL_REFRESH_TOKEN_RYAN.' },
        { status: 500 },
      );
    }

    // Refresh access tokens once per mailbox up front; reuse across prospects.
    const mailboxTokens: { mailbox: Mailbox; accessToken: string; error?: string }[] = [];
    for (const mb of MAILBOXES) {
      try {
        mailboxTokens.push({ mailbox: mb, accessToken: await getAccessToken(mb) });
      } catch (err) {
        mailboxTokens.push({
          mailbox: mb,
          accessToken: '',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const live = mailboxTokens.filter((m) => m.accessToken);
    if (live.length === 0) {
      return NextResponse.json(
        { error: 'All configured Gmail mailboxes failed to authenticate.', mailboxes: mailboxTokens.map((m) => ({ name: m.mailbox.name, error: m.error })) },
        { status: 500 },
      );
    }

    const now = new Date().toISOString();

    const results: { id: string; emails: string[]; touches: GmailTouches; error?: string }[] = [];

    for (const p of prospects) {
      const emails = collectEmails(p as { prospect_email: string | null; owners: Owner[] | null });
      try {
        // Per prospect: every owner email × every live mailbox. Merge results.
        // Gmail's q-language doesn't OR easily on `to:` so we run one query
        // per (recipient, mailbox) combination.
        let touches: GmailTouches = {};
        for (const email of emails) {
          for (const m of live) {
            const t = await searchAndClassify(m.accessToken, email, m.mailbox.name);
            touches = mergeTouches(touches, t);
          }
        }
        await sb
          .from('projections')
          .update({
            gmail_touches: Object.keys(touches).length > 0 ? touches : null,
            gmail_synced_at: now,
          })
          .eq('id', (p as { id: string }).id);
        results.push({ id: (p as { id: string }).id, emails, touches });
      } catch (err) {
        results.push({
          id: (p as { id: string }).id,
          emails,
          touches: {},
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json({
      success: true,
      scanned: prospects.length,
      mailboxes: mailboxTokens.map((m) => ({
        name: m.mailbox.name,
        ok: !!m.accessToken,
        error: m.error,
      })),
      results,
    });
  } catch (err) {
    console.error('sync-prospect-mail error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
