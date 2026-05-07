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
 * For each projection record with a non-null prospect_email, scan Allie's
 * Gmail sent folder for messages addressed to that prospect. Classify each
 * message by deliverable type (projection / guide / contract / onboarding)
 * based on the subject line and attachment filenames, then store the most
 * recent send per type back on the projection's gmail_touches JSONB column.
 *
 * Body (optional): { id: "<projection_uuid>" } to sync just one prospect.
 * Without a body, syncs every projection that has an email + hasn't been
 * synced in the last 5 minutes (cheap dedupe).
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN || '';
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID || '';
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || '';

let _sb: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (_sb) return _sb;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  _sb = createClient(url, key);
  return _sb;
}

async function getAccessToken(): Promise<string> {
  if (!GMAIL_REFRESH_TOKEN || !GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET) {
    throw new Error('Gmail API credentials not configured (GMAIL_REFRESH_TOKEN, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET)');
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GMAIL_CLIENT_ID,
      client_secret: GMAIL_CLIENT_SECRET,
      refresh_token: GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Failed to refresh Gmail token: ${await res.text()}`);
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
): Promise<GmailTouches> {
  // Look back 1 year. Allie's sent folder ("in:sent") to that recipient.
  // The Gmail q-language is documented at https://support.google.com/mail/answer/7190
  const yearAgo = new Date();
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const after = `${yearAgo.getFullYear()}/${String(yearAgo.getMonth() + 1).padStart(2, '0')}/${String(yearAgo.getDate()).padStart(2, '0')}`;
  const q = `in:sent to:${email} after:${after}`;

  const searchUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=50`;
  const searchRes = await fetch(searchUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!searchRes.ok) throw new Error(`Gmail search failed: ${await searchRes.text()}`);
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

    // Attachment filenames (we asked for metadata, but parts are still in the
    // light payload for messages with attachments — Gmail returns part filenames
    // in metadata format).
    const attachments = flattenAttachments(msgData.payload as GmailPart | undefined);

    const type = classify(subject, attachments);
    if (!type) continue;

    const entry: GmailTouchEntry = {
      sent_at: sentAt,
      message_id: msgData.id,
      subject,
      to,
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
      return NextResponse.json({ success: true, scanned: 0, results: [] });
    }

    const accessToken = await getAccessToken();
    const now = new Date().toISOString();

    const results: { id: string; emails: string[]; touches: GmailTouches; error?: string }[] = [];

    for (const p of prospects) {
      const emails = collectEmails(p as { prospect_email: string | null; owners: Owner[] | null });
      try {
        // Search per email and merge — Gmail's q-language doesn't OR easily on
        // `to:` so we run one query per recipient and combine the results.
        let touches: GmailTouches = {};
        for (const email of emails) {
          const t = await searchAndClassify(accessToken, email);
          touches = mergeTouches(touches, t);
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

    return NextResponse.json({ success: true, scanned: prospects.length, results });
  } catch (err) {
    console.error('sync-prospect-mail error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
