import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ALWAYS_CC, SEND_FROM } from '@/lib/properties';
import { renderOnboardingInviteEmail } from '@/lib/onboarding-invite-email';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * POST /api/draft-onboarding-email
 * Body: { property_id, origin? }
 *
 * Creates a Gmail draft (in the mailbox the Gmail OAuth token authenticates,
 * currently allie@risingtidestr.com) inviting the owner to fill in the
 * property's onboarding form. Mints the property's onboarding token if it
 * doesn't have one yet, then drafts a friendly note carrying the public form
 * URL. It NEVER sends: the operator reviews and sends from Gmail, mirroring
 * the owner-statement draft flow in /api/draft-email.
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

/** Base64-URL encoding (RFC 4648 §5). Gmail's drafts endpoint requires this. */
function base64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Encode a header value so non-ASCII characters survive transit (RFC 2047). */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=`;
}

/**
 * Plain-text body to an HTML alternative preserving paragraph layout, so
 * mobile Gmail doesn't reflow long lines. The onboarding URL is turned into a
 * real anchor so it's tappable. Same rationale as the statement draft route.
 */
function plainToHtml(body: string): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const linkify = (html: string) =>
    html.replace(/(https?:\/\/[^\s<]+)/g, (m) => `<a href="${m}">${m}</a>`);
  const paragraphs = body.split(/\n\n+/).map((p) => p.replace(/^\n+|\n+$/g, ''));
  const htmlParas = paragraphs
    .filter((p) => p.length > 0)
    .map((p) => `<p style="margin:0 0 1em 0;">${linkify(escape(p)).replace(/\n/g, '<br>')}</p>`);
  return `<!DOCTYPE html><html><body>${htmlParas.join('')}</body></html>`;
}

function buildMimeMessage(args: {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
}): string {
  const { from, to, cc, subject, body } = args;
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

  headers.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
  return headers.join('\r\n') + '\r\n\r\n' + altPart + '\r\n';
}

/** Return the property's onboarding token, minting + persisting one if absent.
 * Mirrors ensurePropertyOnboardingToken (service-role: properties is RLS-locked
 * so an anon update would silently no-op and hand back a dead link). */
async function ensureToken(sb: SupabaseClient, propertyId: string): Promise<string> {
  const { data: existing, error } = await sb
    .from('properties')
    .select('onboarding_token')
    .eq('id', propertyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!existing) throw new Error('Property not found');
  const current = (existing as { onboarding_token: string | null }).onboarding_token;
  if (current) return current;

  const token = randomBytes(16).toString('hex');
  const { error: updateErr } = await sb
    .from('properties')
    .update({ onboarding_token: token })
    .eq('id', propertyId);
  if (updateErr) throw new Error(updateErr.message);
  return token;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const propertyId: string = (body.property_id || '').trim();
    const originIn: string = (body.origin || '').trim().replace(/\/$/, '');
    if (!propertyId) {
      return NextResponse.json({ error: 'property_id is required' }, { status: 400 });
    }

    const sb = getSupabase();
    const { data: prop, error: propErr } = await sb
      .from('properties')
      .select('id, name, owner_greeting, owner_full, owner_emails')
      .eq('id', propertyId)
      .maybeSingle();
    if (propErr) return NextResponse.json({ error: propErr.message }, { status: 500 });
    if (!prop) return NextResponse.json({ error: `Unknown property: ${propertyId}` }, { status: 400 });

    const ownerEmails: string[] = Array.isArray((prop as { owner_emails: string[] | null }).owner_emails)
      ? ((prop as { owner_emails: string[] }).owner_emails).filter(Boolean)
      : [];
    if (ownerEmails.length === 0) {
      return NextResponse.json(
        { error: `No owner email on file for ${(prop as { name: string }).name}. Add it in the Owner section first.` },
        { status: 400 },
      );
    }

    const token = await ensureToken(sb, propertyId);
    const origin = originIn || request.nextUrl.origin;
    const onboardingUrl = `${origin}/onboarding/${token}`;

    const { subject, body: emailBody } = renderOnboardingInviteEmail({
      greeting: (prop as { owner_greeting: string | null }).owner_greeting || '',
      propertyShort: (prop as { name: string }).name,
      onboardingUrl,
    });

    const mime = buildMimeMessage({
      from: `${SEND_FROM.name} <${SEND_FROM.email}>`,
      to: ownerEmails,
      cc: ALWAYS_CC,
      subject,
      body: emailBody,
    });

    const accessToken = await getGmailAccessToken();
    const draftRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { raw: base64url(mime) } }),
    });

    if (!draftRes.ok) {
      const errText = await draftRes.text();
      const hint =
        draftRes.status === 403 && /insufficient/i.test(errText)
          ? ' The Gmail OAuth token probably lacks gmail.compose scope. Re-authorize and regenerate GMAIL_REFRESH_TOKEN.'
          : '';
      return NextResponse.json(
        { error: `Gmail draft creation failed (${draftRes.status}): ${errText}${hint}` },
        { status: 502 },
      );
    }

    const draft = await draftRes.json();
    const draftUrl = `https://mail.google.com/mail/u/0/#drafts/${draft.id}`;

    return NextResponse.json({
      success: true,
      draft_id: draft.id,
      draft_url: draftUrl,
      subject,
      recipients: ownerEmails,
      onboarding_url: onboardingUrl,
    });
  } catch (err) {
    console.error('draft-onboarding-email error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
