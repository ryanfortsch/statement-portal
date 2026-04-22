import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { PROPERTIES, ALWAYS_CC, SEND_FROM } from '@/lib/properties';
import { renderEmail, type EmailTemplate } from '@/lib/email-templates';

/**
 * POST /api/draft-email
 * Body: { property_id, month, template?, funds_sent_date? }
 *
 * Creates a Gmail draft in the mailbox the Gmail OAuth token is authenticated
 * against (currently allie@risingtidestr.com). Caller passes the statement
 * month + template; this route renders the body from the shared template
 * module, constructs an RFC 2822 MIME message, and POSTs to Gmail's /drafts
 * endpoint. On success it also stamps `close_tasks.email_drafted_at` so the
 * checkbox on the dashboard updates in-place.
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
    throw new Error('Gmail OAuth env vars not configured (GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN)');
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
  return data.access_token;
}

function monthLabel(iso: string): string {
  const d = new Date(iso + '-01T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Base64-URL encoding (RFC 4648 §5). Gmail's drafts endpoint requires this. */
function base64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input;
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Encode a header value so non-ASCII characters survive transit. */
function encodeHeader(value: string): string {
  // If value is pure ASCII, leave it alone. Otherwise use RFC 2047 B-encoding.
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=`;
}

function buildMimeMessage(args: {
  from: string;       // "Allie Marsden <allie@risingtidestr.com>"
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
}): string {
  const { from, to, cc, subject, body } = args;
  const headers = [
    `From: ${from}`,
    `To: ${to.join(', ')}`,
  ];
  if (cc && cc.length > 0) headers.push(`Cc: ${cc.join(', ')}`);
  headers.push(`Subject: ${encodeHeader(subject)}`);
  headers.push('MIME-Version: 1.0');
  headers.push('Content-Type: text/plain; charset=UTF-8');
  headers.push('Content-Transfer-Encoding: 8bit');
  return headers.join('\r\n') + '\r\n\r\n' + body;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const propertyId: string = body.property_id || '';
    const month: string = body.month || '';
    const template: EmailTemplate = body.template || 'monthly';
    const fundsSentIso: string = body.funds_sent_date || '';
    const periodId: string | undefined = body.period_id;

    if (!propertyId || !month) {
      return NextResponse.json({ error: 'property_id and month are required' }, { status: 400 });
    }

    const prop = PROPERTIES[propertyId];
    if (!prop) {
      return NextResponse.json({ error: `Unknown property: ${propertyId}` }, { status: 400 });
    }
    if (prop.owner_emails.length === 0) {
      return NextResponse.json({
        error: `No owner email on file for ${prop.name}. Add it to src/lib/properties.ts.`,
      }, { status: 400 });
    }

    const { subject, body: emailBody } = renderEmail({
      greeting: prop.owner_greeting,
      monthName: monthLabel(month),
      propertyShort: prop.name,
      fundsSentIso,
      template,
    });

    const mime = buildMimeMessage({
      from: `${SEND_FROM.name} <${SEND_FROM.email}>`,
      to: prop.owner_emails,
      cc: ALWAYS_CC,
      subject,
      body: emailBody,
    });

    const accessToken = await getGmailAccessToken();

    const draftRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: { raw: base64url(mime) },
      }),
    });

    if (!draftRes.ok) {
      const errText = await draftRes.text();
      // 403 with insufficient scope is the most likely failure mode.
      const hint = draftRes.status === 403 && /insufficient/i.test(errText)
        ? ' The Gmail OAuth token probably lacks gmail.compose scope. Re-authorize the Gmail OAuth app adding that scope and regenerate GMAIL_REFRESH_TOKEN.'
        : '';
      return NextResponse.json({
        error: `Gmail draft creation failed (${draftRes.status}): ${errText}${hint}`,
      }, { status: 502 });
    }

    const draft = await draftRes.json();
    // Gmail's API doesn't return a direct web URL for the draft. Constructing
    // a mailbox URL by draft ID works in the browser: opens the drafts folder
    // and focuses the one we just made.
    const draftUrl = `https://mail.google.com/mail/u/0/#drafts/${draft.id}`;

    // Stamp close_tasks if we have a period_id. Failure here shouldn't fail
    // the whole request; the draft itself is created.
    if (periodId) {
      try {
        const sb = getSupabase();
        const nowIso = new Date().toISOString();
        const { data: existing } = await sb
          .from('close_tasks')
          .select('*')
          .eq('period_id', periodId)
          .eq('property_id', propertyId)
          .maybeSingle();

        const row = {
          period_id: periodId,
          property_id: propertyId,
          email_template: template,
          email_drafted_at: nowIso,
          email_sent_at: existing?.email_sent_at || null,
          owner_transfer_done_at: existing?.owner_transfer_done_at || null,
          mgmt_sweep_done_at: existing?.mgmt_sweep_done_at || null,
          notes: existing?.notes || null,
        };
        await sb.from('close_tasks').upsert(row, { onConflict: 'period_id,property_id' });
      } catch (persistErr) {
        console.error('draft-email: close_tasks upsert failed', persistErr);
      }
    }

    return NextResponse.json({
      success: true,
      draft_id: draft.id,
      draft_url: draftUrl,
      subject,
      recipients: prop.owner_emails,
    });
  } catch (err) {
    console.error('draft-email error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
