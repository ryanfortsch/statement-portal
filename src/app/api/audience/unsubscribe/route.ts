/**
 * Public unsubscribe endpoint, hit from the link in every campaign email.
 *
 * URL: /api/audience/unsubscribe?t=<signed-token>
 *
 * Verifies the HMAC token, flips the contact to status='unsubscribed',
 * logs an event, and renders a small confirmation page. No auth required;
 * the signature on the token is the proof of authorization.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { verifyUnsubscribeToken } from '@/lib/audience-unsubscribe-token';
import { unsubscribeContactInResend } from '@/lib/resend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('t') || '';
  const payload = verifyUnsubscribeToken(token);

  if (!payload) {
    return new NextResponse(renderPage('That link looks expired or invalid. Reach out at hello@staycapeann.com if you want help.', false), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // Resolve the contact + flip status.
  const { data: contact } = await supabase
    .from('audience_contacts')
    .select('id, email, status, resend_contact_id')
    .eq('id', payload.contact_id)
    .maybeSingle();

  if (!contact) {
    return new NextResponse(renderPage('We could not find that subscription. It may already be removed.', false), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  if (contact.status !== 'unsubscribed') {
    await supabase
      .from('audience_contacts')
      .update({
        status: 'unsubscribed',
        unsubscribed_at: new Date().toISOString(),
        unsubscribe_reason: 'one-click email link',
      })
      .eq('id', contact.id);

    if (contact.resend_contact_id) {
      try {
        await unsubscribeContactInResend(contact.resend_contact_id);
      } catch (err) {
        console.error('[audience/unsubscribe] resend mirror failed', err);
      }
    }

    await supabase.from('audience_events').insert({
      contact_id: contact.id,
      campaign_id: payload.campaign_id ?? null,
      event_type: 'unsubscribed',
      metadata: { source: 'one_click_email' },
    });
  }

  return new NextResponse(
    renderPage(
      `${contact.email} has been removed from the list. Sorry to see you go. Always welcome back.`,
      true,
    ),
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

function renderPage(message: string, ok: boolean): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Unsubscribe &middot; Rising Tide</title>
    <style>
      body { margin:0; padding:0; background:#faf7f1; color:#1e2e34; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; line-height:1.6; min-height:100vh; display:flex; align-items:center; justify-content:center; }
      main { max-width:480px; padding:32px; text-align:center; }
      h1 { font-family: Georgia, 'Times New Roman', serif; font-weight:300; font-size:36px; line-height:1.1; letter-spacing:-0.02em; margin:0 0 16px; }
      p { font-size:16px; color:#1e2e34; margin:0 0 24px; }
      .eyebrow { font-size:11px; letter-spacing:0.22em; text-transform:uppercase; color:#506068; margin-bottom:20px; font-weight:500; }
      a.btn { display:inline-block; background:#1e2e34; color:#faf7f1; padding:12px 24px; text-decoration:none; font-size:11px; letter-spacing:0.18em; text-transform:uppercase; font-weight:600; }
      .accent { color:${ok ? '#2d6b50' : '#c85a3a'}; font-style:italic; }
    </style>
  </head>
  <body>
    <main>
      <div class="eyebrow">Rising Tide</div>
      <h1>${ok ? '<span class="accent">All set.</span>' : '<span class="accent">Hmm.</span>'}</h1>
      <p>${escapeHtml(message)}</p>
      ${ok ? '<a class="btn" href="https://staycapeann.com">Stay Cape Ann &rarr;</a>' : ''}
    </main>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
