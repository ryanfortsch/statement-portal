/**
 * Public subscribe endpoint, called from staycapeann.com (and any future
 * signup surface). Cross-origin POST.
 *
 * Request shape:
 *   { email: string, first_name?: string, last_name?: string,
 *     source?: string, tags?: string[], hp?: string,
 *     skip_welcome?: boolean, marketing_consent?: boolean }
 *
 * `hp` is a honeypot field; if it's set, we 200 silently and drop the
 * submission. Real signup forms should leave it empty (CSS-hide it).
 *
 * `skip_welcome` suppresses the generic welcome email for surfaces that
 * send their own confirmation (the New England Wins entry page sends
 * "You're in" from staycapeann.com, so a second welcome would read as
 * noise). The contact is still inserted, tagged and mirrored to Resend.
 *
 * The write itself is subscribeAudienceContact (src/lib/audience-subscribe.ts),
 * shared with the guest app's stay link. Idempotent on email:
 *   - new email → insert as 'subscribed', push to Resend, fire welcome
 *   - existing 'subscribed' → no-op, returns ok
 *   - existing 'unsubscribed' → resubscribe (they're explicitly opting back in)
 */

import { NextRequest, NextResponse } from 'next/server';
import { isServiceConfigured as isConfigured } from '@/lib/supabase-admin';
import { isPlausibleEmail, subscribeAudienceContact } from '@/lib/audience-subscribe';

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
  skip_welcome?: boolean;
  marketing_consent?: boolean;
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

  const result = await subscribeAudienceContact({
    email,
    firstName: body.first_name,
    lastName: body.last_name,
    sourceLabel: (body.source || 'staycapeann_signup').trim(),
    tags: (body.tags ?? []).filter((t) => typeof t === 'string').slice(0, 10),
    skipWelcome: body.skip_welcome === true,
    marketingConsent: body.marketing_consent !== false,
    eventMetadata: { origin },
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500, headers });
  }
  return NextResponse.json({ ok: true, action: result.action }, { headers });
}
