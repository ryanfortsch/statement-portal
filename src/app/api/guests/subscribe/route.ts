/**
 * Public subscribe endpoint, called from staycapeann.com (and any future
 * signup surface). Cross-origin POST.
 *
 * Request shape:
 *   { email: string, first_name?: string, last_name?: string,
 *     source?: string, tags?: string[], hp?: string }
 *
 * `hp` is a honeypot field; if it's set, we 200 silently and drop the
 * submission. Real signup forms should leave it empty (CSS-hide it).
 *
 * The endpoint is idempotent on email:
 *   - new email → insert as 'subscribed', push to Resend, fire welcome
 *   - existing 'subscribed' → no-op, returns ok
 *   - existing 'unsubscribed' → resubscribe (they're explicitly opting back in)
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase, isConfigured } from '@/lib/supabase';
import { isProxyEmail } from '@/lib/guests-types';
import { pushContactToResend, sendTransactionalViaResend } from '@/lib/resend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_ORIGINS = [
  'https://staycapeann.com',
  'https://www.staycapeann.com',
  'http://localhost:3000',
  'http://localhost:3001',
];

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}

type Body = {
  email?: string;
  first_name?: string;
  last_name?: string;
  source?: string;
  tags?: string[];
  hp?: string;
};

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  const headers = corsHeaders(origin);

  if (!isConfigured) {
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503, headers });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400, headers });
  }

  // Honeypot: silently 200 spam bots.
  if (body.hp && body.hp.trim().length > 0) {
    return NextResponse.json({ ok: true }, { headers });
  }

  const email = (body.email || '').trim().toLowerCase();
  if (!email || !isPlausibleEmail(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400, headers });
  }

  const firstName = (body.first_name || '').trim() || null;
  const lastName = (body.last_name || '').trim() || null;
  const sourceLabel = (body.source || 'staycapeann_signup').trim();
  const incomingTags = (body.tags ?? []).filter((t) => typeof t === 'string').slice(0, 10);

  const tags = [...incomingTags];
  if (isProxyEmail(email)) tags.push('proxy_email');

  // Look up by email first to decide insert vs. resubscribe.
  const { data: existing } = await supabase
    .from('audience_contacts')
    .select('id, status, resend_contact_id, tags')
    .eq('email', email)
    .maybeSingle();

  let contactId: string | null = existing?.id ?? null;
  let resendContactId: string | null = existing?.resend_contact_id ?? null;
  let action: 'inserted' | 'resubscribed' | 'noop' = 'inserted';

  if (existing) {
    // Merge incoming tags with existing (dedup).
    const merged = Array.from(new Set([...(existing.tags ?? []), ...tags]));

    if (existing.status === 'subscribed') {
      // Touch tags only.
      await supabase
        .from('audience_contacts')
        .update({ tags: merged })
        .eq('id', existing.id);
      action = 'noop';
    } else {
      await supabase
        .from('audience_contacts')
        .update({
          status: 'subscribed',
          subscribed_at: new Date().toISOString(),
          unsubscribed_at: null,
          unsubscribe_reason: null,
          marketing_consent: true,
          tags: merged,
          first_name: firstName ?? undefined,
          last_name: lastName ?? undefined,
        })
        .eq('id', existing.id);
      action = 'resubscribed';
    }
  } else {
    const { data, error } = await supabase
      .from('audience_contacts')
      .insert({
        email,
        first_name: firstName,
        last_name: lastName,
        status: 'subscribed',
        subscribed_at: new Date().toISOString(),
        source: sourceLabel.startsWith('staycapeann') ? 'staycapeann_signup' : 'manual',
        source_detail: sourceLabel,
        tags,
        marketing_consent: true,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[audience/subscribe] insert failed', error);
      return NextResponse.json({ error: 'insert_failed' }, { status: 500, headers });
    }
    contactId = data.id;
  }

  // Best-effort Resend mirror. Failures don't block the local insert.
  if (contactId && !isProxyEmail(email)) {
    try {
      const id = await pushContactToResend({ email, firstName, lastName });
      if (id && id !== resendContactId) {
        resendContactId = id;
        await supabase
          .from('audience_contacts')
          .update({ resend_contact_id: id, resend_synced_at: new Date().toISOString() })
          .eq('id', contactId);
      }
    } catch (err) {
      console.error('[audience/subscribe] resend sync failed', err);
    }
  }

  await supabase.from('audience_events').insert({
    contact_id: contactId,
    event_type: action === 'resubscribed' ? 'resubscribed' : 'subscribed',
    metadata: { source: sourceLabel, origin, action },
  });

  // Welcome email on fresh signup. Skip on resubscribe (they know us).
  if (action === 'inserted' && !isProxyEmail(email)) {
    try {
      await sendTransactionalViaResend({
        to: email,
        subject: 'Welcome to Rising Tide',
        html: welcomeHtml({ firstName }),
        text: welcomeText({ firstName }),
      });
    } catch (err) {
      console.error('[audience/subscribe] welcome send failed', err);
    }
  }

  return NextResponse.json({ ok: true, action }, { headers });
}

function isPlausibleEmail(email: string): boolean {
  // Loose check; real validation happens on Resend's side at send time.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320;
}

function welcomeHtml({ firstName }: { firstName: string | null }): string {
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi there,';
  return `<!doctype html>
<html>
  <body style="font-family: Georgia, 'Times New Roman', serif; color:#1e2e34; background:#faf7f1; padding:32px; max-width:560px; margin:0 auto;">
    <p style="font-size:16px; line-height:1.6;">${greeting}</p>
    <p style="font-size:16px; line-height:1.6;">
      Welcome to the Rising Tide list. We'll send the occasional note from Cape Ann — what's open, what's new, the kind of thing we'd tell a friend visiting for the weekend.
    </p>
    <p style="font-size:16px; line-height:1.6;">
      No fluff. Easy to unsubscribe. Glad you're here.
    </p>
    <p style="font-size:16px; line-height:1.6; margin-top:32px;">
      &mdash; The Rising Tide team<br />
      <a href="https://staycapeann.com" style="color:#c85a3a; text-decoration:none;">staycapeann.com</a>
    </p>
  </body>
</html>`;
}

function welcomeText({ firstName }: { firstName: string | null }): string {
  const greeting = firstName ? `Hi ${firstName},` : 'Hi there,';
  return `${greeting}

Welcome to the Rising Tide list. We'll send the occasional note from Cape Ann — what's open, what's new, the kind of thing we'd tell a friend visiting for the weekend.

No fluff. Easy to unsubscribe. Glad you're here.

— The Rising Tide team
https://staycapeann.com
`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
